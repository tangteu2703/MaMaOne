// ==========================================
// WEB DASHBOARD SERVER (Express + WebSocket)
// Port: 3000 | Web UI: http://localhost:3000
// ==========================================
require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const axios = require('axios');
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
    wordsPerEpisode: process.env.WORDS_PER_EPISODE || '10000',
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

// ==========================================
// STUDIO APIs — Stories, Audio, Video
// ==========================================

const { splitStoryIntoEpisodes, generateEpisodeMetadata } = require('./src/story/storyReader');
const { generateVoice } = require('./src/tts/voiceGenerator');

// Đường dẫn thư mục studio
const STORIES_DIR  = path.join(__dirname, 'workspace', 'stories');
const AUDIO_DIR    = path.join(__dirname, 'workspace', 'audio');
const VIDEO_BG_DIR = path.join(__dirname, 'workspace', 'downloads');
const MUSIC_DIR    = path.join(__dirname, 'workspace', 'music');
const OUTPUT_DIR   = path.join(__dirname, 'workspace', 'output');

// Đảm bảo thư mục tồn tại
[STORIES_DIR, AUDIO_DIR, VIDEO_BG_DIR, MUSIC_DIR, OUTPUT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Serve thư mục audio
app.use('/audio', express.static(AUDIO_DIR));
app.use('/music', express.static(MUSIC_DIR));

// Helper: đọc danh sách truyện từ stories dir
function listAllStories() {
  if (!fs.existsSync(STORIES_DIR)) return [];
  const jsonFiles = fs.readdirSync(STORIES_DIR).filter(f => f.endsWith('.json') && !f.includes('_progress'));
  return jsonFiles.map(jf => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(STORIES_DIR, jf), 'utf8'));
      const txtFile = path.join(STORIES_DIR, jf.replace('.json', '.txt'));
      const content = fs.existsSync(txtFile) ? fs.readFileSync(txtFile, 'utf8') : '';
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      const id = jf.replace('.json', '');
      const progressFile = path.join(STORIES_DIR, `${id}_progress.json`);
      const progress = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, 'utf8')) : null;
      return {
        id,
        title: meta.originalTitle || meta.title || id,
        wordCount,
        charCount: content.length,
        createdAt: meta.createdAt || null,
        episodesRendered: progress ? Object.keys(progress).length : 0,
      };
    } catch { return null; }
  }).filter(Boolean);
}

// GET /api/stories — Danh sách tất cả truyện
app.get('/api/stories', (req, res) => {
  try {
    res.json({ success: true, stories: listAllStories() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stories/:id — Chi tiết một truyện + phân tập
app.get('/api/stories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const txtFile = path.join(STORIES_DIR, `${id}.txt`);
    const metaFile = path.join(STORIES_DIR, `${id}.json`);
    if (!fs.existsSync(txtFile)) return res.status(404).json({ success: false, error: 'Không tìm thấy truyện' });
    const content = fs.readFileSync(txtFile, 'utf8');
    const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    // Ưu tiên: query param → meta đã lưu → 10000 (mặc định truyện dài)
    const queryWpe = parseInt(req.query.wordsPerEpisode);
    const wordsPerEp = (!isNaN(queryWpe) && queryWpe > 0) ? queryWpe : (meta.wordsPerEpisode || 10000);
    const episodes = splitStoryIntoEpisodes(content, wordsPerEp);
    res.json({
      success: true,
      id,
      title: meta.originalTitle || meta.title || id,
      genre: meta.genre || '',
      description: meta.description || '',
      content,
      wordCount: content.split(/\s+/).filter(Boolean).length,
      wordsPerEpisode: wordsPerEp,
      episodes: episodes.map(ep => ({
        index: ep.index,
        title: ep.title,
        content: ep.content,
        wordCount: ep.wordCount,
        estimatedDurationSeconds: ep.estimatedDurationSeconds,
        preview: ep.content.substring(0, 150) + '...',
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// POST /api/fetch-url — Lấy nội dung truyện từ URL
app.post('/api/fetch-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'Thiếu URL' });
    const https = url.startsWith('https') ? require('https') : require('http');
    const rawUrl = new URL(url);
    const options = {
      hostname: rawUrl.hostname,
      path: rawUrl.pathname + rawUrl.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    };
    const data = await new Promise((resolve, reject) => {
      const req2 = https.get(options, (r) => {
        let body = '';
        r.on('data', c => body += c);
        r.on('end', () => resolve(body));
      });
      req2.on('error', reject);
      req2.setTimeout(10000, () => { req2.destroy(); reject(new Error('Timeout')); });
    });
    // Strip HTML tags, get text content
    const text = data
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\s{3,}/g, '\n\n')
      .trim();
    // Try to extract title from <title> tag
    const titleMatch = data.match(/<title[^>]*>([^<]{3,100})<\/title>/i);
    const title = titleMatch ? titleMatch[1].split(/[|\-–]/)[0].trim() : '';
    if (text.length < 200) return res.status(400).json({ success: false, error: 'Nội dung quá ngắn hoặc trang không thể đọc được' });
    res.json({ success: true, content: text, title });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Danh sách model Gemini hỗ trợ
const GEMINI_MODELS = [
  { id: 'gemini-2.5-pro',           label: 'Gemini 2.5 Pro ✨',       note: 'Mạnh nhất — Cần Pro/Ultra' },
  { id: 'gemini-2.5-flash',         label: 'Gemini 2.5 Flash ⚡',     note: 'Nhanh + chất lượng cao' },
  { id: 'gemini-2.0-flash',         label: 'Gemini 2.0 Flash',         note: 'Miễn phí, ổn định' },
  { id: 'gemini-1.5-pro-latest',    label: 'Gemini 1.5 Pro',           note: 'Pro, dài hơi tốt' },
  { id: 'gemini-1.5-flash-latest',  label: 'Gemini 1.5 Flash',         note: 'Miễn phí cơ bản' },
];

// GET /api/ai-models — Danh sách model Gemini
app.get('/api/ai-models', (req, res) => {
  res.json({ success: true, models: GEMINI_MODELS });
});

// Helper: Gọi Gemini API với prompt
async function callGeminiAPI(apiKey, systemPrompt, targetWords = 1000, temperature = 0.92, model = 'gemini-2.5-pro') {
  const https = require('https');
  const maxTokens = Math.min(Math.round(targetWords * 3.5), 65536);
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: systemPrompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      topP: 0.95,
      topK: 64,
    },
  });
  const body = await new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const r = new URL(url);
    const req2 = https.request({
      hostname: r.hostname, path: r.pathname + r.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res2) => {
      let data = ''; res2.on('data', c => data += c); res2.on('end', () => resolve(data));
    });
    req2.on('error', reject);
    req2.setTimeout(60000, () => { req2.destroy(); reject(new Error('Gemini API Timeout sau 60s')); });
    req2.write(payload); req2.end();
  });
  const parsed = JSON.parse(body);
  if (parsed.error) throw new Error(parsed.error.message || 'Gemini API Error');
  return parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Helper: Xây dựng system prompt theo thể loại & phong cách
function buildStoryPrompt({ prompt, genre, targetWords, style, characters, setting, chapterNum, totalChapters, previousSummary }) {
  const genreGuide = {
    'Ngôn tình': 'Tập trung vào cảm xúc lãng mạn, tình yêu ngọt ngào và những khoảnh khắc đánh tim người đọc. Miêu tả nội tâm nhân vật sâu sắc.',
    'Kiếm hiệp': 'Thế giới võ lâm với các môn phái, chiêu thức võ công độc đáo. Có hành động gay cấn, ân nghĩa giang hồ, anh hùng hào kiệt.',
    'Tiên hiệp': 'Tu luyện thành tiên, đột phá cảnh giới, thu thập linh vật. Xây dựng thế giới tu tiên hùng vĩ với pháp thuật và thần thú.',
    'Trinh thám': 'Bí ẩn cần được giải mã, manh mối ẩn giấu, tình tiết twist bất ngờ. Nhân vật thám tử thông minh, suy luận logic chặt chẽ.',
    'Kinh dị': 'Không khí rùng rợn, yếu tố siêu nhiên đáng sợ. Xây dựng tension từng chương, cảm giác hãi hùng và bất an liên tục.',
    'Hài hước': 'Tình huống dở khóc dở cười, nhân vật ngốc nghếch đáng yêu, thoại hài hước tự nhiên. Không khí nhẹ nhàng, vui tươi.',
    'Lịch sử': 'Bối cảnh lịch sử Việt Nam hoặc Đông Á chân thực. Nhân vật có chiều sâu lịch sử, sự kiện đan xen lịch sử thực tế.',
    '': 'Viết theo phong cách tự nhiên, cân bằng giữa hành động và cảm xúc.',
  };
  const styleGuide = {
    'dramatic': 'Văn phong kịch tính, cao trào liên tục, câu văn ngắn gọn, mạnh mẽ.',
    'poetic': 'Văn phong thơ văn, giàu hình ảnh, ẩn dụ đẹp, cảm xúc tinh tế.',
    'fast-paced': 'Nhịp độ nhanh, hành động liên tục, đối thoại súc tích, không dài dòng.',
    'detailed': 'Miêu tả chi tiết tỉ mỉ, khắc họa bối cảnh và nội tâm sâu sắc.',
    'classic': 'Văn phong cổ điển, trang trọng, ngôn từ tinh tế, phong cách truyện truyền thống.',
    '': 'Văn phong tự nhiên, cân bằng.',
  };

  const chapterInfo = (totalChapters > 1)
    ? `\n📖 ĐÂY LÀ TẬP ${chapterNum}/${totalChapters} của bộ truyện.`
    : '';

  const prevContext = previousSummary
    ? `\n\n📌 TÓM TẮT CÁC TẬP TRƯỚC (để đảm bảo tính liên tục):\n${previousSummary}\n\nHãy tiếp tục câu chuyện một cách tự nhiên từ đây.`
    : '';

  const charInfo = characters ? `\n👤 NHÂN VẬT CHÍNH: ${characters}` : '';
  const settingInfo = setting ? `\n🏞️ BỐI CẢNH: ${setting}` : '';

  const isFirstChapter = !previousSummary;
  const titleLine = isFirstChapter
    ? `Dòng đầu tiên PHẢI là: TIÊU ĐỀ: [tên truyện hấp dẫn]\n`
    : `Dòng đầu tiên PHẢI là: TẬP ${chapterNum}: [tiêu đề tập này]\n`;

  return `Bạn là một nhà văn Việt Nam tài năng, chuyên viết truyện ${genre || 'hấp dẫn'}.

${genreGuide[genre] || genreGuide['']}
${styleGuide[style] || styleGuide['']}
${chapterInfo}${charInfo}${settingInfo}${prevContext}

📝 YÊU CẦU:
- Viết khoảng ${targetWords} từ (quan trọng: phải đủ độ dài)
- ${titleLine}- Nội dung phải HOÀN CHỈNH, có mở đầu - diễn biến - kết thúc (hoặc cliffhanger nếu có tập sau)
- Không thêm ghi chú, giải thích ngoài truyện
- Văn phong tiếng Việt tự nhiên, cuốn hút${totalChapters > 1 && chapterNum < totalChapters ? '\n- Kết tập bằng một tình huống hấp dẫn (cliffhanger) để người đọc muốn đọc tiếp' : ''}

💡 Ý TƯỞNG / CHỦ ĐỀ: ${prompt}

Bắt đầu viết ngay:`;
}

// POST /api/ai-story — Tạo truyện/tập mới bằng Gemini AI (nâng cấp)
app.post('/api/ai-story', async (req, res) => {
  try {
    const { prompt, targetWords, genre, style, characters, setting, totalChapters, chapterNum, previousSummary, model } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: 'Thiếu prompt/chủ đề truyện' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'Chưa cấu hình GEMINI_API_KEY trong .env' });

    const words = Math.min(parseInt(targetWords) || 1000, 8000);
    const chapNum = parseInt(chapterNum) || 1;
    const totalChaps = parseInt(totalChapters) || 1;
    const selectedModel = model || 'gemini-2.5-pro';

    const systemPrompt = buildStoryPrompt({
      prompt, genre: genre || '', targetWords: words, style: style || '',
      characters: characters || '', setting: setting || '',
      chapterNum: chapNum, totalChapters: totalChaps,
      previousSummary: previousSummary || null,
    });

    logger.info('Studio', `AI Story: Tập ${chapNum}/${totalChaps} | "${prompt.substring(0,40)}..." | ${words} từ | ${genre||'auto'} | Model: ${selectedModel}`);
    const rawText = await callGeminiAPI(apiKey, systemPrompt, words, 0.92, selectedModel);
    if (!rawText) return res.status(500).json({ success: false, error: 'Gemini không trả về nội dung' });

    // Tách tiêu đề từ dòng đầu
    const lines = rawText.split('\n');
    let title = '';
    let content = rawText;
    const firstLine = lines[0] || '';
    if (firstLine.startsWith('TIÊU ĐỀ:')) {
      title = firstLine.replace('TIÊU ĐỀ:', '').trim();
      content = lines.slice(1).join('\n').trim();
    } else if (firstLine.match(/^TẬP \d+:/i)) {
      title = firstLine.replace(/^TẬP \d+:/i, '').trim();
      content = lines.slice(1).join('\n').trim();
    }

    const wordCount = content.split(/\s+/).filter(Boolean).length;
    logger.success('Studio', `AI Story: Tạo xong tập ${chapNum} — ${wordCount} từ`);
    res.json({ success: true, content, title, wordCount, chapterNum: chapNum });
  } catch (err) {
    logger.error('Studio', `AI Story Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-story/continue — Tạo tóm tắt bối cảnh cho tập tiếp theo
app.post('/api/ai-story/summarize', async (req, res) => {
  try {
    const { content, title } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Thiếu nội dung' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'Chưa cấu hình GEMINI_API_KEY' });

    const summaryPrompt = `Hãy tóm tắt ngắn gọn nội dung chính của tập truyện sau trong 150-200 từ. 
Tập trung vào: nhân vật chính, sự kiện quan trọng, trạng thái hiện tại của nhân vật, và điểm dừng câu chuyện.
Chỉ trả về bản tóm tắt, không thêm tiêu đề hay giải thích.

Nội dung tập truyện:
${content.substring(0, 3000)}`;

    const summary = await callGeminiAPI(apiKey, summaryPrompt, 200, 0.5);
    res.json({ success: true, summary: summary.trim() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/stories', (req, res) => {
  try {
    const { title, content, genre, description, wordsPerEpisode } = req.body;
    if (!content || content.trim().length < 50) {
      return res.status(400).json({ success: false, error: 'Nội dung truyện quá ngắn!' });
    }
    const { saveStoryToFile } = require('./src/story/storyReader');
    const savedPath = saveStoryToFile(content, title || 'Truyện Mới');
    const safeId = path.basename(savedPath, '.txt');
    // Lưu thêm meta genre, description, wordsPerEpisode
    const metaFile = savedPath.replace('.txt', '.json');
    const existingMeta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    const wpeToSave = parseInt(wordsPerEpisode) || 10000;
    fs.writeFileSync(metaFile, JSON.stringify({
      ...existingMeta,
      genre: genre || '',
      description: description || '',
      wordsPerEpisode: wpeToSave,
      createdAt: existingMeta.createdAt || new Date().toISOString(),
    }, null, 2));
    const episodes = splitStoryIntoEpisodes(content, wpeToSave);
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    logger.success('Studio', `Đã lưu truyện: "${title}" (${wordCount} từ, ${episodes.length} tập)`);
    res.json({ success: true, id: safeId, title, wordCount, episodeCount: episodes.length, wordsPerEpisode: wpeToSave, message: `Đã lưu truyện "${title}" (${episodes.length} tập)` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/stories/:id
app.delete('/api/stories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const txtFile = path.join(STORIES_DIR, `${id}.txt`);
    const metaFile = path.join(STORIES_DIR, `${id}.json`);
    const progressFile = path.join(STORIES_DIR, `${id}_progress.json`);
    [txtFile, metaFile, progressFile].forEach(f => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {} });
    res.json({ success: true, message: 'Đã xóa truyện' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/stories/:id/ai-append — Dùng AI viết tiếp & ghép vào file truyện đã có
app.post('/api/stories/:id/ai-append', async (req, res) => {
  try {
    const { id } = req.params;
    const { model, targetWords, genre, extraPrompt, lastContext, chapterNum } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'Chưa cấu hình GEMINI_API_KEY' });

    const txtFile = path.join(STORIES_DIR, `${id}.txt`);
    const metaFile = path.join(STORIES_DIR, `${id}.json`);
    if (!fs.existsSync(txtFile)) return res.status(404).json({ success: false, error: 'Không tìm thấy truyện' });

    const existingContent = fs.readFileSync(txtFile, 'utf8');
    const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    const storyTitle = meta.originalTitle || meta.title || id;
    const words = Math.min(parseInt(targetWords) || 1000, 8000);
    const chapNum = parseInt(chapterNum) || 2;
    const selectedModel = model || 'gemini-2.5-pro';

    // Lấy 800 từ cuối làm context (ưu tiên lastContext từ client)
    const contextText = lastContext || existingContent.split(/\s+/).slice(-800).join(' ');

    const continuePromptText = `${extraPrompt || `Viết tiếp câu chuyện "${storyTitle}" từ chỗ đã dừng. Đây là phần ${chapNum}.`}`;

    const systemPrompt = `Bạn là một nhà văn Việt Nam tài năng.
${genre ? `Thể loại: ${genre}.` : ''}

📌 NỘI DUNG CUỐI CÙA TRUYỆN (để đảm bảo tính liên tục):
"${contextText}"

📝 YÊU CẦU:
- Viết khoảng ${words} từ tiếp theo
- Dòng đầu tiên PHẢI là: PHẦN ${chapNum}: [tiêu đề đoạn này]
- Tiếp nối tự nhiên từ nội dung đã có, không tóm tắt lại
- Kết bằng cliffhanger để người đọc muốn đọc tiếp
- Không thêm ghi chú hay giải thích ngoài truyện
- Văn phong tiếng Việt tự nhiên, cuốn hút

💡 ${continuePromptText}

Bắt đầu viết ngay:`;

    logger.info('Studio', `AI Append: "${storyTitle}" phần ${chapNum} | ${words} từ | ${selectedModel}`);
    const rawText = await callGeminiAPI(apiKey, systemPrompt, words, 0.92, selectedModel);
    if (!rawText) return res.status(500).json({ success: false, error: 'Gemini không trả về nội dung' });

    // Thêm separator + nội dung mới vào file
    const separator = `\n\n${'═'.repeat(50)}\n\n`;
    const appendContent = separator + rawText.trim();
    fs.appendFileSync(txtFile, appendContent, 'utf8');

    const newTotalContent = existingContent + appendContent;
    const addedWords = rawText.split(/\s+/).filter(Boolean).length;
    const totalWords = newTotalContent.split(/\s+/).filter(Boolean).length;

    logger.success('Studio', `AI Append xong: +${addedWords} từ → tổng ${totalWords} từ`);
    res.json({ success: true, addedWords, totalWords, chapterNum: chapNum });
  } catch (err) {
    logger.error('Studio', `AI Append Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});


// Trạng thái render audio đang chạy
const audioRenderJobs = {};

// POST /api/render-audio — Render audio một hoặc nhiều tập
app.post('/api/render-audio', async (req, res) => {
  try {
    const { storyId, episodes, voiceName, rate, pitch, volume, wordsPerEpisode, engine, speed, preset, zerottsUrl } = req.body;
    const txtFile = path.join(STORIES_DIR, `${storyId}.txt`);
    if (!fs.existsSync(txtFile)) return res.status(404).json({ success: false, error: 'Không tìm thấy truyện' });
    const content = fs.readFileSync(txtFile, 'utf8');
    const metaFile = path.join(STORIES_DIR, `${storyId}.json`);
    const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    const storyTitle = meta.originalTitle || meta.title || storyId;
    // Chia tập từ file .txt gốc theo wordsPerEpisode của truyện
    const storyWpe = parseInt(wordsPerEpisode) || meta.wordsPerEpisode || 10000;
    const allEpisodes = splitStoryIntoEpisodes(content, storyWpe);
    const episodesToRender = episodes && episodes.length > 0
      ? allEpisodes.filter(ep => episodes.includes(ep.index))
      : allEpisodes;

    // Cập nhật voice config nếu có
    if (voiceName) process.env.VOICE_NAME = voiceName;

    const jobId = `${storyId}_${Date.now()}`;
    audioRenderJobs[jobId] = { status: 'running', total: episodesToRender.length, done: 0, results: [] };

    res.json({ success: true, jobId, total: episodesToRender.length, message: `Bắt đầu render ${episodesToRender.length} tập audio...` });

    // Render async
    (async () => {
      for (const ep of episodesToRender) {
        const safeTitle = storyTitle.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 30);
        const audioFileName = `${safeTitle}_Tap${ep.index}.mp3`;
        const audioPath = path.join(AUDIO_DIR, audioFileName);
        try {
          logger.info('Studio', `Render audio: ${audioFileName} (${ep.wordCount} từ | engine: ${engine || 'edgetts'})...`);
          // Ghi script ra file tạm
          const tempId = `studio_${storyId}_ep${ep.index}`;

          // Override VOICE_NAME via env
          if (voiceName) process.env.VOICE_NAME = voiceName;

          // Tạo stream cho ZeroTTS nếu dùng engine zerotts
          let streamId = null;
          let streamUrl = null;
          const currentZtUrl = zerottsUrl || process.env.ZEROTTS_URL || 'http://localhost:7860';
          if (engine === 'zerotts') {
            try {
              const sRes = await axios.post(`${currentZtUrl}/api/tts/create-stream`, {}, { timeout: 5000 });
              if (sRes.data && sRes.data.streamId) {
                streamId = sRes.data.streamId;
                streamUrl = `/api/zerotts-stream/${streamId}`;
                broadcast('audio_stream_started', {
                  jobId,
                  episodeIndex: ep.index,
                  episodeTitle: ep.title || `Tập ${ep.index}`,
                  streamId,
                  streamUrl,
                  engine: 'zerotts'
                });
                logger.info('Studio', `  Live stream ready: ${streamUrl}`);
              }
            } catch (sErr) {
              logger.warn('Studio', `  Không thể tạo live stream: ${sErr.message}`);
            }
          }

          // Tính rate string đúng định dạng edge-tts: UI gửi số % tăng thêm (ví dụ 33 = +33% ≈ 1.6x)
          const rateStr = (rate !== undefined && rate !== null && rate !== 0)
            ? (rate > 0 ? `+${rate}%` : `${rate}%`)
            : '+0%';
          logger.info('Studio', `Rate: ${rateStr} (raw: ${rate})`);
          await generateVoice(tempId, ep.content, rateStr, ({ chunk, totalChunks, elapsedMs }) => {
            broadcast('audio_chunk_progress', { jobId, episodeIndex: ep.index, chunk, totalChunks, elapsedMs });
            logger.info('Studio', `  Chunk ${chunk}/${totalChunks} OK (${elapsedMs}ms)`);
          }, { engine, voiceName, speed, preset, zerottsUrl, streamId });

          // Copy từ audio cache sang thư mục audio studio
          const tempAudioPath = path.join(__dirname, 'workspace', 'audio', `${tempId}.mp3`);
          if (fs.existsSync(tempAudioPath) && tempAudioPath !== audioPath) {
            fs.copyFileSync(tempAudioPath, audioPath);
          }

          const fileSize = fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0;
          // Ước tính duration thực tế từ kích thước file MP3 (bitrate 128kbps = 16KB/s)
          const realDurationSeconds = fileSize > 1000 ? Math.round(fileSize / (128 * 128)) : ep.estimatedDurationSeconds;
          const result = {
            episodeIndex: ep.index,
            episodeTitle: ep.title,
            filename: audioFileName,
            url: `/audio/${audioFileName}`,
            wordCount: ep.wordCount,
            estimatedDuration: ep.estimatedDurationSeconds,
            durationSeconds: realDurationSeconds,
            fileSizeKB: Math.round(fileSize / 1024),
            status: fileSize > 1000 ? 'done' : 'error',
          };
          audioRenderJobs[jobId].results.push(result);
          audioRenderJobs[jobId].done++;
          broadcast('audio_render_progress', { jobId, ...result, done: audioRenderJobs[jobId].done, total: audioRenderJobs[jobId].total });
          logger.success('Studio', `✅ Audio: ${audioFileName} (${Math.round(fileSize/1024)} KB)`);
        } catch (err) {
          logger.error('Studio', `Lỗi render audio tập ${ep.index}: ${err.message}`);
          audioRenderJobs[jobId].results.push({ episodeIndex: ep.index, status: 'error', error: err.message });
          audioRenderJobs[jobId].done++;
          broadcast('audio_render_progress', { jobId, episodeIndex: ep.index, status: 'error', done: audioRenderJobs[jobId].done, total: audioRenderJobs[jobId].total });
        }
      }
      audioRenderJobs[jobId].status = 'done';
      broadcast('audio_render_complete', { jobId, results: audioRenderJobs[jobId].results });

      logger.success('Studio', `✅ Hoàn thành render ${episodesToRender.length} tập audio!`);
    })();

  } catch (err) {
    logger.error('Studio', `Lỗi render audio: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/render-audio/status/:jobId
app.get('/api/render-audio/status/:jobId', (req, res) => {
  const job = audioRenderJobs[req.params.jobId];
  if (!job) return res.status(404).json({ success: false, error: 'Job không tồn tại' });
  res.json({ success: true, ...job });
});

// GET /api/voice-preview/zerotts/:name — Xem thử giọng ZeroTTS
app.get('/api/voice-preview/zerotts/:name', async (req, res) => {
  const { name } = req.params;
  const currentZtUrl = process.env.ZEROTTS_URL || 'http://localhost:7860';
  try {
    const streamRes = await axios.get(`${currentZtUrl}/api/voices/${encodeURIComponent(name)}/preview`, {
      responseType: 'stream',
      timeout: 10000,
    });
    res.setHeader('Content-Type', 'audio/wav');
    streamRes.data.pipe(res);
  } catch (err) {
    res.status(404).json({ success: false, error: 'Không tìm thấy mẫu giọng ZeroTTS' });
  }
});

// GET /api/voice-preview/edgetts/:name — Mẫu giọng Edge-TTS
app.get('/api/voice-preview/edgetts/:name', async (req, res) => {
  const { name } = req.params;
  const previewDir = path.join(AUDIO_DIR, 'previews');
  fs.mkdirSync(previewDir, { recursive: true });
  const previewFile = path.join(previewDir, `${name}.mp3`);
  if (fs.existsSync(previewFile) && fs.statSync(previewFile).size > 1000) {
    return res.sendFile(previewFile);
  }
  const voiceTitle = name.includes('NamMinh') ? 'Nam Minh' : 'Hoài My';
  const sampleText = `Xin chào! Đây là giọng đọc mẫu ${voiceTitle} trên AIBeta Studio.`;
  try {
    const { execFile } = require('child_process');
    const tempTxt = previewFile.replace('.mp3', '.txt');
    fs.writeFileSync(tempTxt, sampleText, 'utf8');
    execFile(config.paths.edgeTts, ['--voice', name, '--file', tempTxt, '--write-media', previewFile], { timeout: 15000 }, (err) => {
      try { fs.unlinkSync(tempTxt); } catch {}
      if (!err && fs.existsSync(previewFile)) {
        res.sendFile(previewFile);
      } else {
        res.status(500).json({ success: false, error: 'Không thể tạo mẫu giọng Edge-TTS' });
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/zerotts-stream/:sid — Proxy luồng phát audio trực tiếp từ ZeroTTS
app.get('/api/zerotts-stream/:sid', async (req, res) => {
  const { sid } = req.params;
  const currentZtUrl = process.env.ZEROTTS_URL || 'http://localhost:7860';
  try {
    const streamRes = await axios.get(`${currentZtUrl}/zerotts/stream/${sid}.wav`, {
      responseType: 'stream',
      timeout: 600000,
    });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'none');
    streamRes.data.pipe(res);
  } catch (err) {
    res.status(404).end();
  }
});

// GET /api/audio-files — Danh sách file audio đã render
app.get('/api/audio-files', (req, res) => {
  try {
    if (!fs.existsSync(AUDIO_DIR)) return res.json({ success: true, files: [] });
    const files = fs.readdirSync(AUDIO_DIR)
      .filter(f => f.endsWith('.mp3') && !f.startsWith('studio_'))
      .map(f => {
        const stat = fs.statSync(path.join(AUDIO_DIR, f));
        return {
          filename: f,
          url: `/audio/${f}`,
          fileSizeKB: Math.round(stat.size / 1024),
          createdAt: stat.ctime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/audio-files/all — Xóa toàn bộ file audio
app.delete('/api/audio-files/all', (req, res) => {
  try {
    if (!fs.existsSync(AUDIO_DIR)) return res.json({ success: true, deleted: 0 });
    const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3') && !f.startsWith('studio_'));
    files.forEach(f => fs.unlinkSync(path.join(AUDIO_DIR, f)));
    res.json({ success: true, deleted: files.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/audio-files/:filename — Xóa một file audio
app.delete('/api/audio-files/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // tránh path traversal
    const filepath = path.join(AUDIO_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, error: 'File không tồn tại' });
    fs.unlinkSync(filepath);
    res.json({ success: true, deleted: filename });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/video-bg-files — Danh sách video nền + nhạc nền
app.get('/api/video-bg-files', (req, res) => {
  try {
    const videoBgs = fs.existsSync(VIDEO_BG_DIR)
      ? fs.readdirSync(VIDEO_BG_DIR)
          .filter(f => /\.(mp4|mov|avi|mkv)$/i.test(f))
          .map(f => {
            const stat = fs.statSync(path.join(VIDEO_BG_DIR, f));
            return { filename: f, url: `/downloads/${f}`, sizeMB: (stat.size / 1024 / 1024).toFixed(1) };
          })
      : [];
    const musicFiles = fs.existsSync(MUSIC_DIR)
      ? fs.readdirSync(MUSIC_DIR)
          .filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f))
          .map(f => {
            const stat = fs.statSync(path.join(MUSIC_DIR, f));
            return { filename: f, url: `/music/${f}`, sizeMB: (stat.size / 1024 / 1024).toFixed(1) };
          })
      : [];
    res.json({ success: true, videos: videoBgs, music: musicFiles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Render video jobs
const videoRenderJobs = {};

// POST /api/render-video — Ghép video từ audio + video nền + nhạc nền
app.post('/api/render-video', async (req, res) => {
  try {
    const { mappings, musicVolume, outputFormat } = req.body;
    // mappings = [{ audioFile, videoBgFile, musicFile, outputName }]
    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ success: false, error: 'Thiếu thông tin ghép video' });
    }
    const jobId = `video_${Date.now()}`;
    videoRenderJobs[jobId] = { status: 'running', total: mappings.length, done: 0, results: [] };
    res.json({ success: true, jobId, total: mappings.length, message: `Bắt đầu ghép ${mappings.length} video...` });

    // Ghép async
    (async () => {
      const { exec: execCmd } = require('child_process');
      const util = require('util');
      const execAsync = util.promisify(execCmd);

      for (const mapping of mappings) {
        const { audioFile, videoBgFile, musicFile, outputName } = mapping;
        const audioPath = path.join(AUDIO_DIR, audioFile);
        const videoBgPath = path.join(VIDEO_BG_DIR, videoBgFile);
        const musicPath = musicFile ? path.join(MUSIC_DIR, musicFile) : null;
        const outName = outputName || `output_${Date.now()}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outName);
        const volMusic = parseFloat(musicVolume) || 0.3;

        try {
          if (!fs.existsSync(audioPath)) throw new Error(`Audio không tồn tại: ${audioFile}`);
          if (!fs.existsSync(videoBgPath)) throw new Error(`Video nền không tồn tại: ${videoBgFile}`);

          let ffmpegCmd;
          if (musicPath && fs.existsSync(musicPath)) {
            // Ghép: video nền + audio truyện + nhạc nền (mix)
            ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoBgPath}" -i "${audioPath}" -stream_loop -1 -i "${musicPath}" ` +
              `-filter_complex "[1:a]volume=1.0[voice];[2:a]volume=${volMusic}[music];[voice][music]amix=inputs=2:duration=first[aout]" ` +
              `-map 0:v -map "[aout]" -shortest -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k "${outputPath}"`;
          } else {
            // Ghép: video nền + audio truyện (không nhạc nền)
            ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoBgPath}" -i "${audioPath}" ` +
              `-map 0:v -map 1:a -shortest -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k "${outputPath}"`;
          }

          logger.info('Studio', `FFmpeg ghép video: ${outName}...`);
          await execAsync(ffmpegCmd, { timeout: 300000 });

          const fileSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
          const result = {
            outputName: outName,
            url: `/output/${outName}`,
            fileSizeMB: (fileSize / 1024 / 1024).toFixed(2),
            status: fileSize > 10000 ? 'done' : 'error',
            audioFile,
            videoBgFile,
          };
          videoRenderJobs[jobId].results.push(result);
          videoRenderJobs[jobId].done++;
          broadcast('video_render_progress', { jobId, ...result, done: videoRenderJobs[jobId].done, total: videoRenderJobs[jobId].total });
          logger.success('Studio', `✅ Video ghép xong: ${outName} (${result.fileSizeMB} MB)`);
        } catch (err) {
          logger.error('Studio', `Lỗi ghép video ${outName}: ${err.message}`);
          videoRenderJobs[jobId].results.push({ outputName: outName, status: 'error', error: err.message });
          videoRenderJobs[jobId].done++;
          broadcast('video_render_progress', { jobId, outputName: outName, status: 'error', done: videoRenderJobs[jobId].done, total: videoRenderJobs[jobId].total });
        }
      }
      videoRenderJobs[jobId].status = 'done';
      broadcast('video_render_complete', { jobId, results: videoRenderJobs[jobId].results });
      logger.success('Studio', `✅ Hoàn thành ghép ${mappings.length} video!`);
    })();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/output-videos — Danh sách video output hoàn chỉnh
app.get('/api/output-videos', (req, res) => {
  try {
    if (!fs.existsSync(OUTPUT_DIR)) return res.json({ success: true, files: [] });
    const files = fs.readdirSync(OUTPUT_DIR)
      .filter(f => /\.(mp4|mov)$/i.test(f))
      .map(f => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, f));
        return {
          filename: f,
          url: `/output/${f}`,
          fileSizeMB: (stat.size / 1024 / 1024).toFixed(2),
          createdAt: stat.ctime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload video nền
app.post('/api/upload-video-bg', express.raw({ type: ['video/*'], limit: '500mb' }), (req, res) => {
  try {
    const filename = req.headers['x-filename'] || `video_${Date.now()}.mp4`;
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(VIDEO_BG_DIR, safeFilename);
    fs.writeFileSync(destPath, req.body);
    res.json({ success: true, filename: safeFilename, url: `/downloads/${safeFilename}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload nhạc nền
app.post('/api/upload-music', express.raw({ type: ['audio/*'], limit: '100mb' }), (req, res) => {
  try {
    const filename = req.headers['x-filename'] || `music_${Date.now()}.mp3`;
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = path.join(MUSIC_DIR, safeFilename);
    fs.writeFileSync(destPath, req.body);
    res.json({ success: true, filename: safeFilename, url: `/music/${safeFilename}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ZeroTTS Process Manager ─────────────────────────────────────────────────
const { spawn } = require('child_process');
const ZEROTTS_DIR = path.join(__dirname, '..', 'ZeroTTS');
const ZEROTTS_PORT = 7860;
let zerottsProcess = null;
let zerottsPid = null;

// POST /api/zerotts/start — Khởi động ZeroTTS song song
app.post('/api/zerotts/start', async (req, res) => {
  // Kiểm tra nếu đã online rồi thì không cần start lại
  try {
    const check = await axios.get(`http://localhost:${ZEROTTS_PORT}/api/tts-status`, { timeout: 2000 });
    if (check.data?.ok || check.data?.status === 'ok') {
      return res.json({ success: true, status: 'already_running', message: 'ZeroTTS đã online rồi!' });
    }
  } catch {/* chưa online — tiếp tục start */}

  // Nếu process cũ còn đó thì kill trước
  if (zerottsProcess && !zerottsProcess.killed) {
    try { zerottsProcess.kill('SIGTERM'); } catch {}
    zerottsProcess = null;
  }

  try {
    logger.info('ZeroTTS', `Khởi động ZeroTTS từ: ${ZEROTTS_DIR}`);
    zerottsProcess = spawn('cmd.exe', ['/c', 'run.bat'], {
      cwd: ZEROTTS_DIR,
      detached: false,
      windowsHide: false,
    });
    zerottsPid = zerottsProcess.pid;

    zerottsProcess.stdout?.on('data', (d) => {
      logger.info('ZeroTTS', d.toString().trim());
    });
    zerottsProcess.stderr?.on('data', (d) => {
      logger.warn('ZeroTTS', d.toString().trim());
    });
    zerottsProcess.on('exit', (code) => {
      logger.info('ZeroTTS', `Tiến trình kết thúc (code ${code})`);
      zerottsProcess = null;
      zerottsPid = null;
      broadcast('zerotts_status', { running: false });
    });

    broadcast('zerotts_status', { running: true, pid: zerottsPid });
    res.json({ success: true, status: 'starting', pid: zerottsPid, message: 'Đang khởi động ZeroTTS...' });
  } catch (err) {
    logger.error('ZeroTTS', `Lỗi khởi động: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/zerotts/status — Kiểm tra ZeroTTS có online không
app.get('/api/zerotts/status', async (req, res) => {
  const processAlive = !!(zerottsProcess && !zerottsProcess.killed);
  try {
    const r = await axios.get(`http://localhost:${ZEROTTS_PORT}/api/tts-status`, { timeout: 2500 });
    const online = !!(r.data?.ok || r.data?.status === 'ok');
    res.json({ success: true, online, processAlive, pid: zerottsPid });
  } catch {
    res.json({ success: true, online: false, processAlive, pid: zerottsPid });
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// Start Server
server.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log(`🖥️   WEB DASHBOARD SẴN SÀNG TẠI: http://localhost:${PORT}`);
  console.log('═'.repeat(60) + '\n');
  logger.success('Server', `Mở trình duyệt truy cập: http://localhost:${PORT}`);
});
