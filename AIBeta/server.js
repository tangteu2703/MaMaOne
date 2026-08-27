// ==========================================
// WEB DASHBOARD SERVER (Express + WebSocket)
// Port: 3000 | Web UI: http://localhost:3000
// ==========================================
require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const logger = require('./src/logger');
const config = require('./config/config');
const { runPipeline } = require('./pipeline');
const { loadAndSplitStory, saveStoryToFile, getEpisodesProgress } = require('./src/story/storyReader');
const { generateAIVideoPipeline } = require('./src/aiGenerator/constructionGenerator');
const { generateAIVideoMotionPipeline, checkComfyUIStatus } = require('./src/aiGenerator/comfyUIMotionGenerator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(config.paths.output));
app.use('/downloads', express.static(config.paths.downloads));

// Trạng thái hệ thống
let systemState = {
  isRunning: false,
  currentStep: 'Idle',
  stepNumber: 0,
  totalSteps: 5,
  currentVideo: null,
  stats: {
    processedToday: 0,
    successToday: 0,
    failedToday: 0,
    lastRunTime: null,
  },
  videoHistory: [],
};

// WebSocket Broadcast
function broadcast(type, data) {
  const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  });
}

// Lắng nghe log event từ logger để push real-time lên Dashboard
logger.emitter.on('log', (logEntry) => {
  broadcast('log', logEntry);
});

let activeProgress = null;

// Lắng nghe progress event từ pipeline để push % real-time
logger.emitter.on('progress', (progressData) => {
  activeProgress = progressData;
  systemState.currentStep = progressData.stepName;
  systemState.stepNumber = progressData.step;
  broadcast('progress', progressData);
});

// WS Connection
wss.on('connection', (ws) => {
  logger.info('Dashboard', 'Client Web Dashboard đã kết nối!');
  // Gửi trạng thái ban đầu + log lịch sử + active progress cho client mới
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      state: systemState,
      recentLogs: logger.getRecentLogs(),
      config: getConfigData(),
      activeProgress: activeProgress,
    }
  }));
});


// REST APIs
function getConfigData() {
  return {
    apifyToken: process.env.APIFY_API_TOKEN || '',
    geminiKey: process.env.GEMINI_API_KEY || '',
    hashtags: process.env.HASHTAGS || 'satisfying,building,construction,craft,woodworking,lego,diy',
    maxVideos: process.env.MAX_VIDEOS_PER_RUN || '3',
    minViews: process.env.MIN_VIEW_COUNT || '10000',
    voiceName: process.env.VOICE_NAME || 'vi-VN-HoaiMyNeural',
    storyTitle: process.env.STORY_TITLE || 'Câu Chuyện Của Tôi',
    wordsPerEpisode: process.env.WORDS_PER_EPISODE || '200',
    musicVolume: process.env.MUSIC_VOLUME || '0.40',
  };
}

// 1. Get Status
app.get('/api/status', (req, res) => {
  res.json({ success: true, state: systemState });
});

// 2. Get Config
app.get('/api/config', (req, res) => {
  res.json({ success: true, config: getConfigData() });
});

// 3. Save Config
app.post('/api/config', (req, res) => {
  const { apifyToken, geminiKey, hashtags, maxVideos, minViews, voiceName, storyTitle, wordsPerEpisode, musicVolume } = req.body;
  const envPath = path.join(__dirname, '.env');

  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const updates = {
      APIFY_API_TOKEN: apifyToken,
      GEMINI_API_KEY: geminiKey,
      HASHTAGS: hashtags,
      MAX_VIDEOS_PER_RUN: maxVideos,
      MIN_VIEW_COUNT: minViews,
      VOICE_NAME: voiceName,
      STORY_TITLE: storyTitle,
      WORDS_PER_EPISODE: wordsPerEpisode,
      MUSIC_VOLUME: musicVolume,
    };

    Object.keys(updates).forEach((key) => {
      if (updates[key] !== undefined) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${updates[key]}`);
        } else {
          envContent += `\n${key}=${updates[key]}`;
        }
        process.env[key] = updates[key];
      }
    });

    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    logger.success('Dashboard', 'Cập nhật cấu hình .env thành công!');
    broadcast('config_updated', getConfigData());
    res.json({ success: true, message: 'Đã lưu cấu hình mới!' });
  } catch (error) {
    logger.error('Dashboard', `Lỗi lưu .env: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. GET Story — Lấy thông tin truyện hiện tại & danh sách tập
app.get('/api/story', (req, res) => {
  try {
    const storyData = loadAndSplitStory(null, null);
    res.json({
      success: true,
      storyTitle: storyData.title,
      totalEpisodes: storyData.totalEpisodes,
      totalWords: storyData.totalWords,
      episodes: storyData.episodes.map(ep => ({
        index: ep.index,
        title: ep.title,
        wordCount: ep.wordCount,
        estimatedDurationSeconds: ep.estimatedDurationSeconds,
        preview: ep.content.substring(0, 120) + '...',
      })),
      progress: getEpisodesProgress(storyData.title.replace(/\s+/g, '_')),
    });
  } catch (err) {
    res.json({ success: false, error: err.message, storyTitle: null, totalEpisodes: 0, episodes: [] });
  }
});

// 5. POST Story — Lưu truyện mới từ Dashboard UI (paste nội dung)
app.post('/api/story', (req, res) => {
  const { storyContent, storyTitle } = req.body;
  if (!storyContent || storyContent.trim().length < 50) {
    return res.status(400).json({ success: false, error: 'Nội dung truyện quá ngắn hoặc rỗng!' });
  }
  try {
    const title = (storyTitle || 'story').trim();
    const savedPath = saveStoryToFile(storyContent, title);

    // Cập nhật env STORY_FILE
    process.env.STORY_FILE = savedPath;
    process.env.STORY_TITLE = title;
    // Cập nhật config runtime
    config.story.storyFile = savedPath;
    config.story.activeStoryTitle = title;

    // Phân đoạn để trả về preview
    const { splitStoryIntoEpisodes } = require('./src/story/storyReader');
    const episodes = splitStoryIntoEpisodes(storyContent);

    logger.success('Dashboard', `Truyện mới: "${title}" — ${episodes.length} tập`);
    broadcast('story_updated', { storyTitle: title, totalEpisodes: episodes.length });

    res.json({
      success: true,
      message: `Đã lưu truyện "${title}" — ${episodes.length} tập sẵn sàng!`,
      storyTitle: title,
      totalEpisodes: episodes.length,
      savedPath,
    });
  } catch (err) {
    logger.error('Dashboard', `Lỗi lưu truyện: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Run Pipeline Manual Trigger
app.post('/api/run', async (req, res) => {
  const { hashtags, maxVideos, minViews, startEpisode, wordsPerEpisode, storyContent, storyTitle, force } = req.body || {};

  if (systemState.isRunning && !force) {
    return res.status(400).json({ success: false, message: 'Pipeline đang chạy rồi!' });
  }

  systemState.isRunning = true;
  systemState.currentStep = 'Khởi động Pipeline...';
  systemState.stats.lastRunTime = new Date().toLocaleTimeString('vi-VN');
  broadcast('state_change', systemState);

  res.json({ success: true, message: 'Đã kích hoạt pipeline!' });

  // Run pipeline async
  setTimeout(async () => {
    try {
      logger.info('Dashboard', 'Kích hoạt pipeline từ Web Dashboard...');
      const results = await runPipeline({
        hashtags: hashtags ? (Array.isArray(hashtags) ? hashtags : hashtags.split(',')) : undefined,
        maxEpisodes: maxVideos ? parseInt(maxVideos) : undefined,
        minViews: minViews !== undefined ? parseInt(minViews) : undefined,
        startEpisode: startEpisode ? parseInt(startEpisode) : undefined,
        wordsPerEpisode: wordsPerEpisode ? parseInt(wordsPerEpisode) : undefined,
        storyContent: storyContent || undefined,
        storyTitle: storyTitle || undefined,
      });

      const list = results || [];
      systemState.stats.processedToday += list.length;
      systemState.stats.successToday += list.filter(r => r.success).length;
      systemState.stats.failedToday += list.filter(r => !r.success).length;

      list.forEach(r => {
        systemState.videoHistory.unshift({
          id: r.videoId,
          time: new Date().toLocaleTimeString('vi-VN'),
          status: r.success ? 'success' : 'failed',
          steps: r.steps,
          error: r.error,
          script: r.scriptBody || r.script,
          title: `Tập ${r.episodeIndex || 1}`,
          videoFile: `/output/${r.outputFile || r.videoId + '_final.mp4'}`,
        });
      });


    } catch (err) {
      logger.error('Dashboard', `Lỗi chạy pipeline: ${err.message}`);
    } finally {
      systemState.isRunning = false;
      systemState.currentStep = 'Idle';
      broadcast('state_change', systemState);
      broadcast('history_update', systemState.videoHistory);
    }
  }, 500);
});

// Endpoint để reset trạng thái nếu bị kẹt
app.post('/api/reset', (req, res) => {
  systemState.isRunning = false;
  systemState.currentStep = 'Idle';
  broadcast('state_change', systemState);
  res.json({ success: true, message: 'Đã reset trạng thái hệ thống về Idle!' });
});

// 4.5. AI Video Generator Trigger (0đ - Construction & Storytelling)
// API kiểm tra trạng thái ComfyUI Local Server
app.get('/api/ai-generator/comfy-status', async (req, res) => {
  const status = await checkComfyUIStatus();
  res.json(status);
});

app.post('/api/ai-generator/generate', async (req, res) => {
  if (systemState.isRunning) {
    return res.status(400).json({ success: false, message: 'Hệ thống đang thực hiện pipeline khác!' });
  }

  const { topic, stepCount, isVertical, renderMode } = req.body || {};

  systemState.isRunning = true;
  systemState.currentStep = 'Đang khởi tạo Video AI...';
  systemState.stats.lastRunTime = new Date().toLocaleTimeString('vi-VN');
  broadcast('state_change', systemState);

  res.json({ success: true, message: 'Đã kích hoạt tạo Video AI!' });

  setTimeout(async () => {
    try {
      logger.info('Dashboard', `Bắt đầu tạo AI Motion Video chủ đề: "${topic || 'Phục chế xe cổ'}"`);
      const options = {
        topic: topic || 'Phục chế xe máy cổ hỏng từ xác xe cũ thành xe mới lộng lẫy',
        stepCount: parseInt(stepCount) || 5,
        isVertical: isVertical !== false,
      };

      const progressCb = (progressData) => {
        activeProgress = progressData;
        systemState.currentStep = progressData.stepName;
        systemState.stepNumber = progressData.step;
        broadcast('progress', progressData);
      };

      const stepImgCb = (stepImageData) => {
        broadcast('ai_image_step_created', stepImageData);
      };

      const result = await generateAIVideoMotionPipeline(options, progressCb, stepImgCb);

      systemState.stats.processedToday += 1;
      systemState.stats.successToday += 1;

      systemState.videoHistory.unshift({
        id: result.videoId,
        time: new Date().toLocaleTimeString('vi-VN') + ' ' + new Date().toLocaleDateString('vi-VN'),
        status: 'success',
        steps: { script: '✅', images: '✅', voice: '✅', video: '✅' },
        title: result.title,
        script: result.script,
        caption: result.caption,
        videoFile: result.videoUrl,
      });

      broadcast('ai_video_created', result);

    } catch (err) {
      logger.error('Dashboard', `Lỗi tạo Video AI: ${err.message}`);
      systemState.stats.failedToday += 1;
    } finally {
      systemState.isRunning = false;
      systemState.currentStep = 'Idle';
      broadcast('state_change', systemState);
      broadcast('history_update', systemState.videoHistory);
    }
  }, 500);
});

// 5. Get AI Video History List with Hashtags
app.get('/api/ai-generator/history', (req, res) => {
  res.json({
    success: true,
    outputDirectory: config.paths.output,
    history: systemState.videoHistory
  });
});

// 6. Get Processed Videos (Kho Video Output)
app.get('/api/videos', (req, res) => {
  try {
    const outputDir = config.paths.output;
    let files = [];
    if (fs.existsSync(outputDir)) {
      files = fs.readdirSync(outputDir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => {
          const stat = fs.statSync(path.join(outputDir, f));
          return {
            filename: f,
            url: `/output/${f}`,
            sizeMB: (stat.size / 1024 / 1024).toFixed(2),
            createdAt: stat.ctime.toLocaleTimeString('vi-VN') + ' ' + stat.ctime.toLocaleDateString('vi-VN')
          };
        });
    }
    res.json({ success: true, videos: files, history: systemState.videoHistory });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. Get Pipeline Files (Downloads & Outputs cho Master Table)
app.get('/api/pipeline-files', (req, res) => {
  try {
    const downloadsDir = config.paths.downloads;
    const outputDir = config.paths.output;

    const downloadFiles = fs.existsSync(downloadsDir)
      ? fs.readdirSync(downloadsDir).filter(f => f.endsWith('.mp4')).map(f => ({
          filename: f,
          url: `/downloads/${f}`,
          sizeMB: (fs.statSync(path.join(downloadsDir, f)).size / 1024 / 1024).toFixed(2),
        }))
      : [];

    const outputFiles = fs.existsSync(outputDir)
      ? fs.readdirSync(outputDir).filter(f => f.endsWith('.mp4')).map(f => ({
          filename: f,
          url: `/output/${f}`,
          sizeMB: (fs.statSync(path.join(outputDir, f)).size / 1024 / 1024).toFixed(2),
        }))
      : [];

    res.json({ success: true, downloads: downloadFiles, outputs: outputFiles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Server
server.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log(`🖥️   WEB DASHBOARD SẴN SÀNG TẠI: http://localhost:${PORT}`);
  console.log('═'.repeat(60) + '\n');
  logger.success('Server', `Mở trình duyệt truy cập: http://localhost:${PORT}`);
});
