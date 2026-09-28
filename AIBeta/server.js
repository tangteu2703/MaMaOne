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

// ==========================================
// ðŸ”‘ GEMINI KEY ROTATION MANAGER
// ==========================================
const geminiKeyManager = {
  keys: [],          // Danh sÃ¡ch API keys
  currentIndex: 0,   // Key Ä‘ang dÃ¹ng
  failCounts: {},    // Sá»‘ láº§n tháº¥t báº¡i cá»§a má»—i key
  lastRotated: null, // Thá»i gian xoay key gáº§n nháº¥t

  // Load keys tá»« env (há»— trá»£ cáº£ GEMINI_API_KEY vÃ  GEMINI_API_KEYS)
  loadKeys() {
    const multiKeys = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
    const singleKey = (process.env.GEMINI_API_KEY || '').trim();
    // Gá»™p: GEMINI_API_KEYS Æ°u tiÃªn trÆ°á»›c, rá»“i GEMINI_API_KEY
    const all = [...new Set([...multiKeys, ...(singleKey ? [singleKey] : [])])];
    this.keys = all;
    // Reset fail counts cho keys má»›i
    this.keys.forEach(k => { if (!(k in this.failCounts)) this.failCounts[k] = 0; });
    if (this.currentIndex >= this.keys.length) this.currentIndex = 0;
    return this.keys.length;
  },

  // Láº¥y key hiá»‡n táº¡i
  getCurrentKey() {
    this.loadKeys();
    if (this.keys.length === 0) return null;
    return this.keys[this.currentIndex];
  },

  // ÄÃ¡nh dáº¥u key hiá»‡n táº¡i lá»—i quota, chuyá»ƒn sang key tiáº¿p theo
  markQuotaExceeded(key) {
    this.failCounts[key] = (this.failCounts[key] || 0) + 1;
    logger.warn('GeminiKeys', `ðŸ”‘ Key [${this.currentIndex + 1}/${this.keys.length}] háº¿t quota (${key.slice(-8)}...). Äang chuyá»ƒn key...`);
    // TÃ¬m key tiáº¿p theo chÆ°a fail quÃ¡ 3 láº§n
    const startIdx = this.currentIndex;
    for (let i = 1; i <= this.keys.length; i++) {
      const nextIdx = (startIdx + i) % this.keys.length;
      const nextKey = this.keys[nextIdx];
      if ((this.failCounts[nextKey] || 0) < 3) {
        this.currentIndex = nextIdx;
        this.lastRotated = new Date().toISOString();
        logger.success('GeminiKeys', `âœ… ÄÃ£ chuyá»ƒn sang Key [${nextIdx + 1}/${this.keys.length}] (${nextKey.slice(-8)}...)`);
        return true;
      }
    }
    logger.error('GeminiKeys', 'âŒ Táº¥t cáº£ API keys Ä‘Ã£ háº¿t quota!');
    return false;
  },

  // Reset fail count (dÃ¹ng sau khi thÃªm key má»›i)
  resetFails() {
    this.failCounts = {};
    this.currentIndex = 0;
    logger.info('GeminiKeys', 'ðŸ”„ ÄÃ£ reset tráº¡ng thÃ¡i táº¥t cáº£ keys');
  },

  // Status bÃ¡o cÃ¡o
  getStatus() {
    this.loadKeys();
    return {
      total: this.keys.length,
      currentIndex: this.currentIndex,
      currentKeyHint: this.keys[this.currentIndex] ? `...${this.keys[this.currentIndex].slice(-8)}` : null,
      keys: this.keys.map((k, i) => ({
        index: i + 1,
        hint: `...${k.slice(-8)}`,
        isCurrent: i === this.currentIndex,
        failCount: this.failCounts[k] || 0,
        status: (this.failCounts[k] || 0) >= 3 ? 'exhausted' : (i === this.currentIndex ? 'active' : 'standby'),
      })),
      lastRotated: this.lastRotated,
    };
  },
};

// Model fallback chain: khi model Pro háº¿t quota â†’ thá»­ Flash â†’ thá»­ free
// ✅ Models đã xác nhận hoạt động ngày 2026-09-28:
// gemini-3.8-flash (mới nhất, Google khuyến nghị)
// gemini-flash-latest / gemini-flash-lite-latest / gemini-3.1-flash-lite
const MODEL_FALLBACK_CHAIN = {
  'gemini-3.8-flash':         ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'],
  'gemini-3.1-pro-preview':   ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'],
  'gemini-flash-latest':      ['gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'],
  'gemini-flash-lite-latest': ['gemini-flash-lite-latest'],
  'gemini-3.1-flash-lite':    ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest'],
  // Aliases model cũ → redirect sang model mới
  'gemini-2.5-flash':         ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'],
  'gemini-2.0-flash':         ['gemini-3.8-flash', 'gemini-flash-latest'],
  'gemini-1.5-pro-latest':    ['gemini-3.8-flash', 'gemini-flash-latest'],
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());

// Set charset=utf-8 cho tat ca file HTML/JS/CSS
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.url.endsWith('.html') || req.url === '/' || req.url === '') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
  } else if (req.url.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  } else if (req.url.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

// Explicit route cho / de dam bao HTML duoc serve dung charset
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/output', express.static(config.paths.output));
app.use('/downloads', express.static(config.paths.downloads));

// Tráº¡ng thÃ¡i há»‡ thá»‘ng
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

// Láº¯ng nghe log event tá»« logger Ä‘á»ƒ push real-time lÃªn Dashboard
logger.emitter.on('log', (logEntry) => {
  broadcast('log', logEntry);
});

let activeProgress = null;

// Láº¯ng nghe progress event tá»« pipeline Ä‘á»ƒ push % real-time
logger.emitter.on('progress', (progressData) => {
  activeProgress = progressData;
  systemState.currentStep = progressData.stepName;
  systemState.stepNumber = progressData.step;
  broadcast('progress', progressData);
});

// WS Connection
wss.on('connection', (ws) => {
  logger.info('Dashboard', 'Client Web Dashboard Ä‘Ã£ káº¿t ná»‘i!');
  // Gá»­i tráº¡ng thÃ¡i ban Ä‘áº§u + log lá»‹ch sá»­ + active progress cho client má»›i
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
    geminiKeys: process.env.GEMINI_API_KEYS || '',   // Multi-key: cÃ¡ch nhau báº±ng dáº¥u pháº©y
    hashtags: process.env.HASHTAGS || 'satisfying,building,construction,craft,woodworking,lego,diy',
    maxVideos: process.env.MAX_VIDEOS_PER_RUN || '3',
    minViews: process.env.MIN_VIEW_COUNT || '10000',
    voiceName: process.env.VOICE_NAME || 'vi-VN-HoaiMyNeural',
    storyTitle: process.env.STORY_TITLE || 'CÃ¢u Chuyá»‡n Cá»§a TÃ´i',
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
  const { apifyToken, geminiKey, geminiKeys, hashtags, maxVideos, minViews, voiceName, storyTitle, wordsPerEpisode, musicVolume } = req.body;
  const envPath = path.join(__dirname, '.env');

  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const updates = {
      APIFY_API_TOKEN: apifyToken,
      GEMINI_API_KEY: geminiKey,
      GEMINI_API_KEYS: geminiKeys,   // Multi-key pool
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
    // Reload key manager sau khi lÆ°u
    geminiKeyManager.resetFails();
    geminiKeyManager.loadKeys();
    logger.success('Dashboard', `Cáº­p nháº­t cáº¥u hÃ¬nh .env thÃ nh cÃ´ng! ÄÃ£ load ${geminiKeyManager.keys.length} Gemini key(s).`);
    broadcast('config_updated', getConfigData());
    res.json({ success: true, message: 'ÄÃ£ lÆ°u cáº¥u hÃ¬nh má»›i!' });
  } catch (error) {
    logger.error('Dashboard', `Lá»—i lÆ°u .env: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3b. GET /api/gemini-keys-status â€” Tráº¡ng thÃ¡i key rotation
app.get('/api/gemini-keys-status', (req, res) => {
  res.json({ success: true, status: geminiKeyManager.getStatus() });
});

// 3c. POST /api/gemini-keys-reset â€” Reset fail counts
app.post('/api/gemini-keys-reset', (req, res) => {
  geminiKeyManager.resetFails();
  geminiKeyManager.loadKeys();
  res.json({ success: true, message: `ÄÃ£ reset. ${geminiKeyManager.keys.length} key(s) sáºµn sÃ ng.` });
});

// 4. GET Story â€” Láº¥y thÃ´ng tin truyá»‡n hiá»‡n táº¡i & danh sÃ¡ch táº­p
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

// 5. POST Story â€” LÆ°u truyá»‡n má»›i tá»« Dashboard UI (paste ná»™i dung)
app.post('/api/story', (req, res) => {
  const { storyContent, storyTitle } = req.body;
  if (!storyContent || storyContent.trim().length < 50) {
    return res.status(400).json({ success: false, error: 'Ná»™i dung truyá»‡n quÃ¡ ngáº¯n hoáº·c rá»—ng!' });
  }
  try {
    const title = (storyTitle || 'story').trim();
    const savedPath = saveStoryToFile(storyContent, title);

    // Cáº­p nháº­t env STORY_FILE
    process.env.STORY_FILE = savedPath;
    process.env.STORY_TITLE = title;
    // Cáº­p nháº­t config runtime
    config.story.storyFile = savedPath;
    config.story.activeStoryTitle = title;

    // PhÃ¢n Ä‘oáº¡n Ä‘á»ƒ tráº£ vá» preview
    const { splitStoryIntoEpisodes } = require('./src/story/storyReader');
    const episodes = splitStoryIntoEpisodes(storyContent);

    logger.success('Dashboard', `Truyá»‡n má»›i: "${title}" â€” ${episodes.length} táº­p`);
    broadcast('story_updated', { storyTitle: title, totalEpisodes: episodes.length });

    res.json({
      success: true,
      message: `ÄÃ£ lÆ°u truyá»‡n "${title}" â€” ${episodes.length} táº­p sáºµn sÃ ng!`,
      storyTitle: title,
      totalEpisodes: episodes.length,
      savedPath,
    });
  } catch (err) {
    logger.error('Dashboard', `Lá»—i lÆ°u truyá»‡n: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Run Pipeline Manual Trigger
app.post('/api/run', async (req, res) => {
  const { hashtags, maxVideos, minViews, startEpisode, wordsPerEpisode, storyContent, storyTitle, force } = req.body || {};

  if (systemState.isRunning && !force) {
    return res.status(400).json({ success: false, message: 'Pipeline Ä‘ang cháº¡y rá»“i!' });
  }

  systemState.isRunning = true;
  systemState.currentStep = 'Khá»Ÿi Ä‘á»™ng Pipeline...';
  systemState.stats.lastRunTime = new Date().toLocaleTimeString('vi-VN');
  broadcast('state_change', systemState);

  res.json({ success: true, message: 'ÄÃ£ kÃ­ch hoáº¡t pipeline!' });

  // Run pipeline async
  setTimeout(async () => {
    try {
      logger.info('Dashboard', 'KÃ­ch hoáº¡t pipeline tá»« Web Dashboard...');
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
          title: `Táº­p ${r.episodeIndex || 1}`,
          videoFile: `/output/${r.outputFile || r.videoId + '_final.mp4'}`,
        });
      });


    } catch (err) {
      logger.error('Dashboard', `Lá»—i cháº¡y pipeline: ${err.message}`);
    } finally {
      systemState.isRunning = false;
      systemState.currentStep = 'Idle';
      broadcast('state_change', systemState);
      broadcast('history_update', systemState.videoHistory);
    }
  }, 500);
});

// Endpoint Ä‘á»ƒ reset tráº¡ng thÃ¡i náº¿u bá»‹ káº¹t
app.post('/api/reset', (req, res) => {
  systemState.isRunning = false;
  systemState.currentStep = 'Idle';
  broadcast('state_change', systemState);
  res.json({ success: true, message: 'ÄÃ£ reset tráº¡ng thÃ¡i há»‡ thá»‘ng vá» Idle!' });
});

// 4.5. AI Video Generator Trigger (0Ä‘ - Construction & Storytelling)
// API kiá»ƒm tra tráº¡ng thÃ¡i ComfyUI Local Server
app.get('/api/ai-generator/comfy-status', async (req, res) => {
  const status = await checkComfyUIStatus();
  res.json(status);
});

app.post('/api/ai-generator/generate', async (req, res) => {
  if (systemState.isRunning) {
    return res.status(400).json({ success: false, message: 'Há»‡ thá»‘ng Ä‘ang thá»±c hiá»‡n pipeline khÃ¡c!' });
  }

  const { topic, stepCount, isVertical, renderMode } = req.body || {};

  systemState.isRunning = true;
  systemState.currentStep = 'Äang khá»Ÿi táº¡o Video AI...';
  systemState.stats.lastRunTime = new Date().toLocaleTimeString('vi-VN');
  broadcast('state_change', systemState);

  res.json({ success: true, message: 'ÄÃ£ kÃ­ch hoáº¡t táº¡o Video AI!' });

  setTimeout(async () => {
    try {
      logger.info('Dashboard', `Báº¯t Ä‘áº§u táº¡o AI Motion Video chá»§ Ä‘á»: "${topic || 'Phá»¥c cháº¿ xe cá»•'}"`);
      const options = {
        topic: topic || 'Phá»¥c cháº¿ xe mÃ¡y cá»• há»ng tá»« xÃ¡c xe cÅ© thÃ nh xe má»›i lá»™ng láº«y',
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
        steps: { script: 'âœ…', images: 'âœ…', voice: 'âœ…', video: 'âœ…' },
        title: result.title,
        script: result.script,
        caption: result.caption,
        videoFile: result.videoUrl,
      });

      broadcast('ai_video_created', result);

    } catch (err) {
      logger.error('Dashboard', `Lá»—i táº¡o Video AI: ${err.message}`);
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
// STUDIO APIs â€” Stories, Audio, Video
// ==========================================

const { splitStoryIntoEpisodes, generateEpisodeMetadata } = require('./src/story/storyReader');
const { generateVoice } = require('./src/tts/voiceGenerator');

// ÄÆ°á»ng dáº«n thÆ° má»¥c studio
const STORIES_DIR  = path.join(__dirname, 'workspace', 'stories');
const AUDIO_DIR    = path.join(__dirname, 'workspace', 'audio');
const VIDEO_BG_DIR = path.join(__dirname, 'workspace', 'downloads');
const MUSIC_DIR    = path.join(__dirname, 'workspace', 'music');
const OUTPUT_DIR   = path.join(__dirname, 'workspace', 'output');

// Äáº£m báº£o thÆ° má»¥c tá»“n táº¡i
[STORIES_DIR, AUDIO_DIR, VIDEO_BG_DIR, MUSIC_DIR, OUTPUT_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Serve thÆ° má»¥c audio
app.use('/audio', express.static(AUDIO_DIR));
app.use('/music', express.static(MUSIC_DIR));

// Helper: Ä‘á»c danh sÃ¡ch truyá»‡n tá»« stories dir
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

// GET /api/stories â€” Danh sÃ¡ch táº¥t cáº£ truyá»‡n
app.get('/api/stories', (req, res) => {
  try {
    res.json({ success: true, stories: listAllStories() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stories/:id â€” Chi tiáº¿t má»™t truyá»‡n + phÃ¢n táº­p
app.get('/api/stories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const txtFile = path.join(STORIES_DIR, `${id}.txt`);
    const metaFile = path.join(STORIES_DIR, `${id}.json`);
    if (!fs.existsSync(txtFile)) return res.status(404).json({ success: false, error: 'KhÃ´ng tÃ¬m tháº¥y truyá»‡n' });
    const content = fs.readFileSync(txtFile, 'utf8');
    const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    // Æ¯u tiÃªn: query param â†’ meta Ä‘Ã£ lÆ°u â†’ 10000 (máº·c Ä‘á»‹nh truyá»‡n dÃ i)
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


// POST /api/fetch-url â€” Láº¥y ná»™i dung truyá»‡n tá»« URL
app.post('/api/fetch-url', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'Thiáº¿u URL' });
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
    const title = titleMatch ? titleMatch[1].split(/[|\-â€“]/)[0].trim() : '';
    if (text.length < 200) return res.status(400).json({ success: false, error: 'Ná»™i dung quÃ¡ ngáº¯n hoáº·c trang khÃ´ng thá»ƒ Ä‘á»c Ä‘Æ°á»£c' });
    res.json({ success: true, content: text, title });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Danh sach model Gemini ho tro (cap nhat 2026)
const GEMINI_MODELS = [
  { id: 'gemini-3.1-pro-preview',        label: 'Gemini 3.1 Pro Preview âœ¨',  note: 'Manh nhat 2026 â€” Khuyen dung' },
  { id: 'gemini-3.8-flash',              label: 'Gemini 3.8 Flash âš¡',         note: 'Nhanh + chat luong cao' },
{ id: 'gemini-3.8-flash',         label: '⚡ Gemini 3.8 Flash [FREE ✅]',     note: 'Khuyen dung - Nhat, nhanh, mien phi' },
  { id: 'gemini-flash-latest',      label: '⚡ Gemini Flash Latest [FREE ✅]',  note: 'On dinh, mien phi' },
  { id: 'gemini-3.1-flash-lite',    label: '⚡ Gemini 3.1 Flash Lite [FREE ✅]',note: 'Nhe nhat, mien phi' },
  { id: 'gemini-flash-lite-latest', label: '⚡ Flash Lite Latest [FREE ✅]',    note: 'Nhe nhat, mien phi' },
  { id: 'gemini-3.1-pro-preview',   label: '✨ Gemini 3.1 Pro [PAID 💳]',       note: 'Can tra phi' },
];

// GET /api/ai-models â€” Danh sÃ¡ch model Gemini
app.get('/api/ai-models', (req, res) => {
  res.json({ success: true, models: GEMINI_MODELS });
});

// Helper: Gá»i 1 request Ä‘áº¿n Gemini (raw, khÃ´ng retry)
async function _callGeminiRaw(apiKey, model, payload) {
  const https = require('https');
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
    req2.setTimeout(90000, () => { req2.destroy(); reject(new Error('Gemini API Timeout sau 90s')); });
    req2.write(payload); req2.end();
  });
  return JSON.parse(body);
}

// Helper: Gá»i Gemini API vá»›i prompt â€” há»— trá»£ xoay vÃ²ng key + fallback model
async function callGeminiAPI(apiKeyParam, systemPrompt, targetWords = 1000, temperature = 0.92, model = 'gemini-3.8-flash') {
  const maxTokens = Math.min(Math.round(targetWords * 3.5), 65536);
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: systemPrompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature, topP: 0.95, topK: 64 },
  });

  // Láº¥y chain fallback model cho model Ä‘Æ°á»£c yÃªu cáº§u
  const modelChain = MODEL_FALLBACK_CHAIN[model] || [model, 'gemini-3.8-flash', 'gemini-flash-latest'];

  // Thá»­ tá»«ng model trong chain
  for (const tryModel of modelChain) {
    // Má»—i model thá»­ tá»‘i Ä‘a (sá»‘ key) láº§n
    const maxKeyTries = Math.max(geminiKeyManager.loadKeys(), 1);
    for (let keyTry = 0; keyTry < maxKeyTries; keyTry++) {
      // Æ¯u tiÃªn key tá»« manager, fallback sang apiKeyParam náº¿u khÃ´ng cÃ³
      const key = geminiKeyManager.getCurrentKey() || apiKeyParam;
      if (!key) throw new Error('KhÃ´ng cÃ³ API key nÃ o Ä‘Æ°á»£c cáº¥u hÃ¬nh');

      try {
        logger.info('GeminiKeys', `ðŸ“¡ Gá»i ${tryModel} vá»›i key ...${key.slice(-8)}`);
        const parsed = await _callGeminiRaw(key, tryModel, payload);

        if (parsed.error) {
          const errMsg = parsed.error.message || '';
          const isDeprecated = errMsg.includes('no longer available') || errMsg.includes('update your code');
          const isHighDemand = errMsg.includes('high demand') || errMsg.includes('temporarily');
          const isQuota = errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate') || parsed.error.code === 429;

          if (isDeprecated) {
            logger.warn('GeminiKeys', `[SKIP] Model ${tryModel} da bi xoa - thu model tiep theo`);
            break; // next model
          }
          if (isHighDemand) {
            logger.warn('GeminiKeys', `[WAIT] ${tryModel} qua tai - cho 3s roi thu model tiep`);
            await new Promise(r => setTimeout(r, 3000));
            break; // next model
          }
          if (isQuota) {
            const rotated = geminiKeyManager.markQuotaExceeded(key);
            if (!rotated) break;
            continue;
          }
          throw new Error(errMsg || 'Gemini API Error');
        }

        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (tryModel !== model) {
          logger.warn('GeminiKeys', `âš ï¸ ÄÃ£ dÃ¹ng fallback model: ${tryModel} (thay vÃ¬ ${model})`);
        }
        return text;
      } catch (err) {
        if (err.message.includes('Timeout') || err.message.includes('ECONNRESET')) {
          logger.warn('GeminiKeys', `â±ï¸ Timeout vá»›i key ...${key.slice(-8)}, thá»­ láº¡i...`);
          const rotated = geminiKeyManager.markQuotaExceeded(key);
          if (!rotated) break;
          continue;
        }
        throw err; // Lá»—i khÃ´ng xá»­ lÃ½ Ä‘Æ°á»£c â†’ nÃ©m ra ngoÃ i
      }
    }
    logger.warn('GeminiKeys', `ðŸ”„ Táº¥t cáº£ key háº¿t quota vá»›i ${tryModel}, thá»­ model: ${modelChain[modelChain.indexOf(tryModel) + 1] || 'khÃ´ng cÃ²n'}`)
  }

  throw new Error('âŒ Táº¥t cáº£ API keys vÃ  fallback models Ä‘Ã£ háº¿t quota. Vui lÃ²ng thÃªm key má»›i!');
}

// Helper: XÃ¢y dá»±ng system prompt theo thá»ƒ loáº¡i & phong cÃ¡ch
function buildStoryPrompt({ prompt, genre, targetWords, style, characters, setting, chapterNum, totalChapters, previousSummary }) {
  const genreGuide = {
    'NgÃ´n tÃ¬nh': 'Táº­p trung vÃ o cáº£m xÃºc lÃ£ng máº¡n, tÃ¬nh yÃªu ngá»t ngÃ o vÃ  nhá»¯ng khoáº£nh kháº¯c Ä‘Ã¡nh tim ngÆ°á»i Ä‘á»c. MiÃªu táº£ ná»™i tÃ¢m nhÃ¢n váº­t sÃ¢u sáº¯c.',
    'Kiáº¿m hiá»‡p': 'Tháº¿ giá»›i vÃµ lÃ¢m vá»›i cÃ¡c mÃ´n phÃ¡i, chiÃªu thá»©c vÃµ cÃ´ng Ä‘á»™c Ä‘Ã¡o. CÃ³ hÃ nh Ä‘á»™ng gay cáº¥n, Ã¢n nghÄ©a giang há»“, anh hÃ¹ng hÃ o kiá»‡t.',
    'TiÃªn hiá»‡p': 'Tu luyá»‡n thÃ nh tiÃªn, Ä‘á»™t phÃ¡ cáº£nh giá»›i, thu tháº­p linh váº­t. XÃ¢y dá»±ng tháº¿ giá»›i tu tiÃªn hÃ¹ng vÄ© vá»›i phÃ¡p thuáº­t vÃ  tháº§n thÃº.',
    'Trinh thÃ¡m': 'BÃ­ áº©n cáº§n Ä‘Æ°á»£c giáº£i mÃ£, manh má»‘i áº©n giáº¥u, tÃ¬nh tiáº¿t twist báº¥t ngá». NhÃ¢n váº­t thÃ¡m tá»­ thÃ´ng minh, suy luáº­n logic cháº·t cháº½.',
    'Kinh dá»‹': 'KhÃ´ng khÃ­ rÃ¹ng rá»£n, yáº¿u tá»‘ siÃªu nhiÃªn Ä‘Ã¡ng sá»£. XÃ¢y dá»±ng tension tá»«ng chÆ°Æ¡ng, cáº£m giÃ¡c hÃ£i hÃ¹ng vÃ  báº¥t an liÃªn tá»¥c.',
    'HÃ i hÆ°á»›c': 'TÃ¬nh huá»‘ng dá»Ÿ khÃ³c dá»Ÿ cÆ°á»i, nhÃ¢n váº­t ngá»‘c ngháº¿ch Ä‘Ã¡ng yÃªu, thoáº¡i hÃ i hÆ°á»›c tá»± nhiÃªn. KhÃ´ng khÃ­ nháº¹ nhÃ ng, vui tÆ°Æ¡i.',
    'Lá»‹ch sá»­': 'Bá»‘i cáº£nh lá»‹ch sá»­ Viá»‡t Nam hoáº·c ÄÃ´ng Ã chÃ¢n thá»±c. NhÃ¢n váº­t cÃ³ chiá»u sÃ¢u lá»‹ch sá»­, sá»± kiá»‡n Ä‘an xen lá»‹ch sá»­ thá»±c táº¿.',
    '': 'Viáº¿t theo phong cÃ¡ch tá»± nhiÃªn, cÃ¢n báº±ng giá»¯a hÃ nh Ä‘á»™ng vÃ  cáº£m xÃºc.',
  };
  const styleGuide = {
    'dramatic': 'VÄƒn phong ká»‹ch tÃ­nh, cao trÃ o liÃªn tá»¥c, cÃ¢u vÄƒn ngáº¯n gá»n, máº¡nh máº½.',
    'poetic': 'VÄƒn phong thÆ¡ vÄƒn, giÃ u hÃ¬nh áº£nh, áº©n dá»¥ Ä‘áº¹p, cáº£m xÃºc tinh táº¿.',
    'fast-paced': 'Nhá»‹p Ä‘á»™ nhanh, hÃ nh Ä‘á»™ng liÃªn tá»¥c, Ä‘á»‘i thoáº¡i sÃºc tÃ­ch, khÃ´ng dÃ i dÃ²ng.',
    'detailed': 'MiÃªu táº£ chi tiáº¿t tá»‰ má»‰, kháº¯c há»a bá»‘i cáº£nh vÃ  ná»™i tÃ¢m sÃ¢u sáº¯c.',
    'classic': 'VÄƒn phong cá»• Ä‘iá»ƒn, trang trá»ng, ngÃ´n tá»« tinh táº¿, phong cÃ¡ch truyá»‡n truyá»n thá»‘ng.',
    '': 'VÄƒn phong tá»± nhiÃªn, cÃ¢n báº±ng.',
  };

  const chapterInfo = (totalChapters > 1)
    ? `\nðŸ“– ÄÃ‚Y LÃ€ Táº¬P ${chapterNum}/${totalChapters} cá»§a bá»™ truyá»‡n.`
    : '';

  const prevContext = previousSummary
    ? `\n\nðŸ“Œ TÃ“M Táº®T CÃC Táº¬P TRÆ¯á»šC (Ä‘á»ƒ Ä‘áº£m báº£o tÃ­nh liÃªn tá»¥c):\n${previousSummary}\n\nHÃ£y tiáº¿p tá»¥c cÃ¢u chuyá»‡n má»™t cÃ¡ch tá»± nhiÃªn tá»« Ä‘Ã¢y.`
    : '';

  const charInfo = characters ? `\nðŸ‘¤ NHÃ‚N Váº¬T CHÃNH: ${characters}` : '';
  const settingInfo = setting ? `\nðŸžï¸ Bá»I Cáº¢NH: ${setting}` : '';

  const isFirstChapter = !previousSummary;
  const titleLine = isFirstChapter
    ? `DÃ²ng Ä‘áº§u tiÃªn PHáº¢I lÃ : TIÃŠU Äá»€: [tÃªn truyá»‡n háº¥p dáº«n]\n`
    : `DÃ²ng Ä‘áº§u tiÃªn PHáº¢I lÃ : Táº¬P ${chapterNum}: [tiÃªu Ä‘á» táº­p nÃ y]\n`;

  return `Báº¡n lÃ  má»™t nhÃ  vÄƒn Viá»‡t Nam tÃ i nÄƒng, chuyÃªn viáº¿t truyá»‡n ${genre || 'háº¥p dáº«n'}.

${genreGuide[genre] || genreGuide['']}
${styleGuide[style] || styleGuide['']}
${chapterInfo}${charInfo}${settingInfo}${prevContext}

ðŸ“ YÃŠU Cáº¦U:
- Viáº¿t khoáº£ng ${targetWords} tá»« (quan trá»ng: pháº£i Ä‘á»§ Ä‘á»™ dÃ i)
- ${titleLine}- Ná»™i dung pháº£i HOÃ€N CHá»ˆNH, cÃ³ má»Ÿ Ä‘áº§u - diá»…n biáº¿n - káº¿t thÃºc (hoáº·c cliffhanger náº¿u cÃ³ táº­p sau)
- KhÃ´ng thÃªm ghi chÃº, giáº£i thÃ­ch ngoÃ i truyá»‡n
- VÄƒn phong tiáº¿ng Viá»‡t tá»± nhiÃªn, cuá»‘n hÃºt${totalChapters > 1 && chapterNum < totalChapters ? '\n- Káº¿t táº­p báº±ng má»™t tÃ¬nh huá»‘ng háº¥p dáº«n (cliffhanger) Ä‘á»ƒ ngÆ°á»i Ä‘á»c muá»‘n Ä‘á»c tiáº¿p' : ''}

ðŸ’¡ Ã TÆ¯á»žNG / CHá»¦ Äá»€: ${prompt}

Báº¯t Ä‘áº§u viáº¿t ngay:`;
}

// POST /api/ai-story â€” Táº¡o truyá»‡n/táº­p má»›i báº±ng Gemini AI (nÃ¢ng cáº¥p)
app.post('/api/ai-story', async (req, res) => {
  try {
    const { prompt, targetWords, genre, style, characters, setting, totalChapters, chapterNum, previousSummary, model } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: 'Thiáº¿u prompt/chá»§ Ä‘á» truyá»‡n' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'ChÆ°a cáº¥u hÃ¬nh GEMINI_API_KEY trong .env' });

    const words = Math.min(parseInt(targetWords) || 1000, 8000);
    const chapNum = parseInt(chapterNum) || 1;
    const totalChaps = parseInt(totalChapters) || 1;
    const selectedModel = model || 'gemini-3.8-flash';

    const systemPrompt = buildStoryPrompt({
      prompt, genre: genre || '', targetWords: words, style: style || '',
      characters: characters || '', setting: setting || '',
      chapterNum: chapNum, totalChapters: totalChaps,
      previousSummary: previousSummary || null,
    });

    logger.info('Studio', `AI Story: Táº­p ${chapNum}/${totalChaps} | "${prompt.substring(0,40)}..." | ${words} tá»« | ${genre||'auto'} | Model: ${selectedModel}`);
    const rawText = await callGeminiAPI(apiKey, systemPrompt, words, 0.92, selectedModel);
    if (!rawText) return res.status(500).json({ success: false, error: 'Gemini khÃ´ng tráº£ vá» ná»™i dung' });

    // TÃ¡ch tiÃªu Ä‘á» tá»« dÃ²ng Ä‘áº§u
    const lines = rawText.split('\n');
    let title = '';
    let content = rawText;
    const firstLine = lines[0] || '';
    if (firstLine.startsWith('TIÃŠU Äá»€:')) {
      title = firstLine.replace('TIÃŠU Äá»€:', '').trim();
      content = lines.slice(1).join('\n').trim();
    } else if (firstLine.match(/^Táº¬P \d+:/i)) {
      title = firstLine.replace(/^Táº¬P \d+:/i, '').trim();
      content = lines.slice(1).join('\n').trim();
    }

    const wordCount = content.split(/\s+/).filter(Boolean).length;
    logger.success('Studio', `AI Story: Táº¡o xong táº­p ${chapNum} â€” ${wordCount} tá»«`);
    res.json({ success: true, content, title, wordCount, chapterNum: chapNum });
  } catch (err) {
    logger.error('Studio', `AI Story Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-story/continue â€” Táº¡o tÃ³m táº¯t bá»‘i cáº£nh cho táº­p tiáº¿p theo
app.post('/api/ai-story/summarize', async (req, res) => {
  try {
    const { content, title } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Thiáº¿u ná»™i dung' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'ChÆ°a cáº¥u hÃ¬nh GEMINI_API_KEY' });

    const summaryPrompt = `HÃ£y tÃ³m táº¯t ngáº¯n gá»n ná»™i dung chÃ­nh cá»§a táº­p truyá»‡n sau trong 150-200 tá»«. 
Táº­p trung vÃ o: nhÃ¢n váº­t chÃ­nh, sá»± kiá»‡n quan trá»ng, tráº¡ng thÃ¡i hiá»‡n táº¡i cá»§a nhÃ¢n váº­t, vÃ  Ä‘iá»ƒm dá»«ng cÃ¢u chuyá»‡n.
Chá»‰ tráº£ vá» báº£n tÃ³m táº¯t, khÃ´ng thÃªm tiÃªu Ä‘á» hay giáº£i thÃ­ch.

Ná»™i dung táº­p truyá»‡n:
${content.substring(0, 3000)}`;

    const summary = await callGeminiAPI(apiKey, summaryPrompt, 200, 0.5);
    res.json({ success: true, summary: summary.trim() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// PIPELINE â€” DOC TU story_pipeline_template.json
// Moi step build prompt tu template, khong hardcode
// ==========================================
const PIPELINE_TEMPLATE_PATH = path.join(__dirname, 'config', 'story_pipeline_template.json');

function loadPipelineTemplate() {
  try {
    return JSON.parse(fs.readFileSync(PIPELINE_TEMPLATE_PATH, 'utf8'));
  } catch (e) {
    logger.warn('Pipeline', `Khong doc duoc pipeline template: ${e.message}`);
    return null;
  }
}

/**
 * Build prompt string tu mot step trong template
 * Thay the cac {{placeholder}} bang gia tri thuc
 */
function buildPromptFromTemplate(stepDef, vars = {}) {
  const req = stepDef.request;
  const lines = [];
  lines.push(req.role || '');
  if (req.task) lines.push('\n' + req.task);
  if (Array.isArray(req.instructions) && req.instructions.length) {
    lines.push('\nHUONG DAN:');
    req.instructions.forEach(inst => lines.push('- ' + inst));
  }
  if (req.output_schema) {
    lines.push('\nTra ve JSON theo dung cau truc sau (CHI JSON thuan tuy, KHONG markdown):');
    lines.push(JSON.stringify(req.output_schema, null, 2));
  }
  Object.entries(vars).forEach(([key, val]) => {
    if (val !== undefined && val !== null && val !== '') {
      lines.push(`\n${key.toUpperCase()}: ${typeof val === 'object' ? JSON.stringify(val, null, 2) : val}`);
    }
  });
  let prompt = lines.join('\n');
  Object.entries(vars).forEach(([key, val]) => {
    const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val || '');
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), strVal);
  });
  return prompt.trim();
}

function parseJSONResponse(rawText) {
  const clean = rawText
    .replace(/^```json\s*/im, '').replace(/^```\s*/im, '')
    .replace(/```\s*$/im, '').trim();
  try { return JSON.parse(clean); } catch {}
  const match = rawText.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  throw new Error('AI khong tra ve JSON hop le. Thu lai hoac chon model khac.');
}

// POST /api/ai-story/blueprint -- Step 1: Phan tich y tuong -> JSON Blueprint
app.post('/api/ai-story/blueprint', async (req, res) => {
  try {
    const { story_idea, model, total_episodes } = req.body;
    if (!story_idea || story_idea.trim().length < 10) {
      return res.status(400).json({ success: false, error: 'Thieu y tuong truyen' });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'Chua cau hinh GEMINI_API_KEY trong .env' });

    const epCount = parseInt(total_episodes) || 10;
    const tpl = loadPipelineTemplate();
    const step = tpl && tpl.step_1_story_blueprint;
    const selectedModel = model || (step && step.model) || 'gemini-3.1-pro-preview';
    const temperature = (step && step.temperature) || 0.85;

    let prompt;
    if (step) {
      prompt = buildPromptFromTemplate(step, { STORY_IDEA: story_idea.trim(), TOTAL_EPISODES: epCount });
      prompt = prompt.replace('{{STORY_IDEA}}', story_idea.trim());
      if (prompt.indexOf(String(epCount)) === -1) {
        prompt += '\n\nLUU Y: Tao outline cho dung ' + epCount + ' tap trong "episode_outline".';
      }
    } else {
      prompt = 'Ban la bien kich chuyen nghiep. Tao blueprint truyen dai tap tu y tuong sau, tra ve JSON thuan tuy voi cac truong: story, characters, world, arcs, mysteries, twists, episode_outline (' + epCount + ' tap).\nY TUONG: ' + story_idea.trim();
    }

    logger.info('Studio', '[Step 1] Blueprint: "' + story_idea.substring(0, 50) + '..." | ' + epCount + ' tap | ' + selectedModel);
    const rawText = await callGeminiAPI(apiKey, prompt, 5000, temperature, selectedModel);
    if (!rawText) return res.status(500).json({ success: false, error: 'Gemini khong tra ve noi dung' });

    const blueprint = parseJSONResponse(rawText);
    blueprint._meta = {
      pipeline_step: 'step_1_story_blueprint',
      generated_at: new Date().toISOString(),
      story_idea: story_idea.trim(),
      model: selectedModel,
      total_episodes: epCount,
      template_version: (tpl && tpl._meta && tpl._meta.version) || 'unknown',
    };

    logger.success('Studio', '[Step 1] Blueprint xong: "' + (blueprint.story && blueprint.story.title) + '" -- ' + ((blueprint.characters && blueprint.characters.length) || 0) + ' nhan vat, ' + ((blueprint.arcs && blueprint.arcs.length) || 0) + ' arc, ' + ((blueprint.episode_outline && blueprint.episode_outline.length) || 0) + ' tap');
    res.json({ success: true, blueprint });
  } catch (err) {
    logger.error('Studio', '[Step 1] Blueprint Error: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-story/episode -- Step 2: Viet noi dung tap tu blueprint outline
app.post('/api/ai-story/episode', async (req, res) => {
  try {
    const { blueprint, chapterNum, targetWords, model, previousSummary } = req.body;
    if (!blueprint) return res.status(400).json({ success: false, error: 'Thieu blueprint' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'Chua cau hinh GEMINI_API_KEY' });

    const chapNum = parseInt(chapterNum) || 1;
    const tpl = loadPipelineTemplate();
    const step = tpl && tpl.step_2_episode_writer;
    const selectedModel = model || (step && step.model) || 'gemini-3.8-flash';
    const temperature = (step && step.temperature) || 0.92;
    const words = Math.min(parseInt(targetWords) || 1000, 8000);

    const epOutline = (blueprint.episode_outline && blueprint.episode_outline[chapNum - 1]) || {};
    const totalChaps = (blueprint.episode_outline && blueprint.episode_outline.length) || 1;
    const currentArc = (blueprint.arcs || []).find(function(a) {
      const m = (a.episodes || '').match(/(\d+)[-\u2013](\d+)/);
      return m ? chapNum >= parseInt(m[1]) && chapNum <= parseInt(m[2]) : false;
    }) || (blueprint.arcs && blueprint.arcs[0]) || {};

    const charSummary = (blueprint.characters || []).map(function(c) {
      return '[' + c.id + '] ' + c.name + ' (' + c.role + '): ' + c.personality + '. Ngoai hinh: ' + (c.appearance || '') + '. Giong: ' + (c.voice || '');
    }).join('\n');

    const vars = {
      STORY_TITLE: (blueprint.story && blueprint.story.title) || '',
      GENRE: (blueprint.story && blueprint.story.genre) || '',
      STYLE: (blueprint.story && blueprint.story.style) || '',
      TONE: (blueprint.story && blueprint.story.tone) || '',
      WORLD_SUMMARY: (blueprint.world && blueprint.world.description) || '',
      POWER_SYSTEM: (blueprint.world && blueprint.world.power_system) || '',
      CHARACTERS_SUMMARY: charSummary,
      CURRENT_ARC: (currentArc.title || '') + ': ' + (currentArc.goal || ''),
      EPISODE_OUTLINE: epOutline,
      EP: chapNum,
      TOTAL_CHAPTERS: totalChaps,
      TARGET_WORDS: words,
      PREVIOUS_SUMMARY: previousSummary || '',
    };

    const prompt = step ? buildPromptFromTemplate(step, vars) :
      'Ban la nha van Viet Nam. Viet tap ' + chapNum + '/' + totalChaps + ' cua truyen "' + vars.STORY_TITLE + '" theo outline, khoang ' + words + ' tu.\nOutline: ' + JSON.stringify(epOutline) + '\nNhan vat: ' + charSummary + (previousSummary ? '\nTom tat tap truoc: ' + previousSummary : '') + '\nBat dau viet ngay:';

    logger.info('Studio', '[Step 2] Episode ' + chapNum + '/' + totalChaps + ' | ' + words + ' tu | ' + selectedModel);
    const rawText = await callGeminiAPI(apiKey, prompt, Math.round(words * 3.5), temperature, selectedModel);
    if (!rawText) return res.status(500).json({ success: false, error: 'Gemini khong tra ve noi dung' });

    let result;
    try { result = parseJSONResponse(rawText); } catch {
      const wordCount = rawText.split(/\s+/).filter(Boolean).length;
      result = { ep: chapNum, title: epOutline.title || ('Tap ' + chapNum), content: rawText, word_count: wordCount, summary: '' };
    }
    if (!result.content && rawText.length > 100) result.content = rawText;
    result.word_count = result.word_count || (result.content || '').split(/\s+/).filter(Boolean).length;
    result._meta = { pipeline_step: 'step_2_episode_writer', model: selectedModel };

    logger.success('Studio', '[Step 2] Tap ' + chapNum + ' xong: ' + result.word_count + ' tu');
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Studio', '[Step 2] Episode Error: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-story/scene-expand -- Step 3: Mo rong canh chi tiet
app.post('/api/ai-story/scene-expand', async (req, res) => {
  try {
    const { scene_text, blueprint, model } = req.body;
    if (!scene_text) return res.status(400).json({ success: false, error: 'Thieu doan canh can mo rong' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'Chua cau hinh GEMINI_API_KEY' });

    const tpl = loadPipelineTemplate();
    const step = tpl && tpl.step_3_scene_expander;
    const selectedModel = model || (step && step.model) || 'gemini-3.8-flash';
    const temperature = (step && step.temperature) || 0.88;

    const charAppearance = (blueprint && blueprint.characters || []).map(function(c) {
      return c.name + ': ' + (c.appearance || '') + ', ' + (c.outfit || '');
    }).join('\n');

    const vars = { SCENE_TEXT: scene_text, CHARACTERS_APPEARANCE: charAppearance };
    const prompt = step ? buildPromptFromTemplate(step, vars) :
      'Ban la dao dien kiem nha van. Mo rong canh sau len ~300 tu. Tra ve JSON: {expanded_scene, visual_cues, mood}.\nCANH: ' + scene_text;

    const rawText = await callGeminiAPI(apiKey, prompt, 1200, temperature, selectedModel);
    const result = parseJSONResponse(rawText);
    result._meta = { pipeline_step: 'step_3_scene_expander', model: selectedModel };
    logger.success('Studio', '[Step 3] Scene expand xong');
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Studio', '[Step 3] Scene Expand Error: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-story/voice-script -- Step 4: Tao TTS script tu noi dung tap
app.post('/api/ai-story/voice-script', async (req, res) => {
  try {
    const { content, blueprint, model } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Thieu noi dung tap' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'Chua cau hinh GEMINI_API_KEY' });

    const tpl = loadPipelineTemplate();
    const step = tpl && tpl.step_4_voice_prompt;
    const selectedModel = model || (step && step.model) || 'gemini-3.8-flash';
    const temperature = (step && step.temperature) || 0.5;

    const charVoices = (blueprint && blueprint.characters || []).map(function(c) {
      return c.name + ': ' + (c.voice || '');
    }).join('\n');
    const vars = { CONTENT: content.substring(0, 6000), CHARACTERS_VOICES: charVoices };

    const prompt = step ? buildPromptFromTemplate(step, vars) :
      'Ban la chuyen gia bien tap script audio Viet Nam. Toi uu doan truyen cho TTS (them [PAUSE], [SLOW], [FAST]). Tra ve JSON: {tts_script, estimated_duration_seconds, character_voices}.\nNOI DUNG: ' + content.substring(0, 4000);

    const rawText = await callGeminiAPI(apiKey, prompt, 3000, temperature, selectedModel);
    const result = parseJSONResponse(rawText);
    result._meta = { pipeline_step: 'step_4_voice_prompt', model: selectedModel };
    logger.success('Studio', '[Step 4] Voice script xong -- ~' + (result.estimated_duration_seconds || '?') + 's');
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Studio', '[Step 4] Voice Script Error: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai-story/image-prompts -- Step 5: Tao prompt anh AI cho tung canh
app.post('/api/ai-story/image-prompts', async (req, res) => {
  try {
    const { content, blueprint, model } = req.body;
    if (!content) return res.status(400).json({ success: false, error: 'Thieu noi dung tap' });
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'Chua cau hinh GEMINI_API_KEY' });

    const tpl = loadPipelineTemplate();
    const step = tpl && tpl.step_5_image_prompt;
    const selectedModel = model || (step && step.model) || 'gemini-3.8-flash';
    const temperature = (step && step.temperature) || 0.7;

    const charAppearance = (blueprint && blueprint.characters || [])
      .map(function(c) { return c.name + ': ' + (c.appearance || '') + ', ' + (c.outfit || ''); })
      .join('\n');
    const worldStyle = (blueprint && blueprint.world && blueprint.world.description) || '';

    const vars = {
      EPISODE_CONTENT: content.substring(0, 5000),
      CHARACTERS_APPEARANCE: charAppearance,
      WORLD_STYLE: worldStyle,
    };

    const prompt = step ? buildPromptFromTemplate(step, vars) :
      'Ban la art director manhwa. Chon 3-5 canh quan trong, tao prompt anh AI. Tra ve JSON: {scenes: [{scene_id, description, prompt_en, negative_prompt, aspect_ratio, priority}]}.\nNHAN VAT: ' + charAppearance + '\nNOI DUNG: ' + content.substring(0, 3000);

    const rawText = await callGeminiAPI(apiKey, prompt, 2500, temperature, selectedModel);
    const result = parseJSONResponse(rawText);
    result._meta = { pipeline_step: 'step_5_image_prompt', model: selectedModel };
    logger.success('Studio', '[Step 5] Image prompts xong -- ' + ((result.scenes && result.scenes.length) || 0) + ' canh');
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Studio', '[Step 5] Image Prompts Error: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/pipeline-template -- Tra ve pipeline template cho client xem
app.get('/api/pipeline-template', (req, res) => {
  try {
    const tpl = loadPipelineTemplate();
    if (!tpl) return res.status(404).json({ success: false, error: 'Khong tim thay pipeline template' });
    res.json({ success: true, template: tpl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/stories/:id/blueprint -- Luu blueprint vao file rieng ben canh story
app.post('/api/stories/:id/blueprint', (req, res) => {
  try {
    const { id } = req.params;
    const { blueprint } = req.body;
    if (!blueprint) return res.status(400).json({ success: false, error: 'Thieu du lieu blueprint' });
    const bpFile = path.join(STORIES_DIR, `${id}_blueprint.json`);
    fs.writeFileSync(bpFile, JSON.stringify(blueprint, null, 2), 'utf8');
    logger.success('Studio', 'Da luu blueprint: ' + id + '_blueprint.json');
    res.json({ success: true, message: 'Da luu blueprint' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/stories/:id/blueprint -- Doc blueprint cua mot truyen
app.get('/api/stories/:id/blueprint', (req, res) => {
  try {
    const { id } = req.params;
    const bpFile = path.join(STORIES_DIR, `${id}_blueprint.json`);
    if (!fs.existsSync(bpFile)) return res.status(404).json({ success: false, error: 'Chua co blueprint cho truyen nay' });
    const blueprint = JSON.parse(fs.readFileSync(bpFile, 'utf8'));
    res.json({ success: true, blueprint });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/stories', (req, res) => {
  try {
    const { title, content, genre, description, wordsPerEpisode } = req.body;
    if (!content || content.trim().length < 50) {
      return res.status(400).json({ success: false, error: 'Ná»™i dung truyá»‡n quÃ¡ ngáº¯n!' });
    }
    const { saveStoryToFile } = require('./src/story/storyReader');
    const savedPath = saveStoryToFile(content, title || 'Truyá»‡n Má»›i');
    const safeId = path.basename(savedPath, '.txt');
    // LÆ°u thÃªm meta genre, description, wordsPerEpisode
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
    logger.success('Studio', `ÄÃ£ lÆ°u truyá»‡n: "${title}" (${wordCount} tá»«, ${episodes.length} táº­p)`);
    res.json({ success: true, id: safeId, title, wordCount, episodeCount: episodes.length, wordsPerEpisode: wpeToSave, message: `ÄÃ£ lÆ°u truyá»‡n "${title}" (${episodes.length} táº­p)` });
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
    res.json({ success: true, message: 'ÄÃ£ xÃ³a truyá»‡n' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/stories/:id/ai-append â€” DÃ¹ng AI viáº¿t tiáº¿p & ghÃ©p vÃ o file truyá»‡n Ä‘Ã£ cÃ³
app.post('/api/stories/:id/ai-append', async (req, res) => {
  try {
    const { id } = req.params;
    const { model, targetWords, genre, extraPrompt, lastContext, chapterNum } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'ChÆ°a cáº¥u hÃ¬nh GEMINI_API_KEY' });

    const txtFile = path.join(STORIES_DIR, `${id}.txt`);
    const metaFile = path.join(STORIES_DIR, `${id}.json`);
    if (!fs.existsSync(txtFile)) return res.status(404).json({ success: false, error: 'KhÃ´ng tÃ¬m tháº¥y truyá»‡n' });

    const existingContent = fs.readFileSync(txtFile, 'utf8');
    const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    const storyTitle = meta.originalTitle || meta.title || id;
    const words = Math.min(parseInt(targetWords) || 1000, 8000);
    const chapNum = parseInt(chapterNum) || 2;
    const selectedModel = model || 'gemini-3.8-flash';

    // Láº¥y 800 tá»« cuá»‘i lÃ m context (Æ°u tiÃªn lastContext tá»« client)
    const contextText = lastContext || existingContent.split(/\s+/).slice(-800).join(' ');

    const continuePromptText = `${extraPrompt || `Viáº¿t tiáº¿p cÃ¢u chuyá»‡n "${storyTitle}" tá»« chá»— Ä‘Ã£ dá»«ng. ÄÃ¢y lÃ  pháº§n ${chapNum}.`}`;

    const systemPrompt = `Báº¡n lÃ  má»™t nhÃ  vÄƒn Viá»‡t Nam tÃ i nÄƒng.
${genre ? `Thá»ƒ loáº¡i: ${genre}.` : ''}

ðŸ“Œ Ná»˜I DUNG CUá»I CÃ™A TRUYá»†N (Ä‘á»ƒ Ä‘áº£m báº£o tÃ­nh liÃªn tá»¥c):
"${contextText}"

ðŸ“ YÃŠU Cáº¦U:
- Viáº¿t khoáº£ng ${words} tá»« tiáº¿p theo
- DÃ²ng Ä‘áº§u tiÃªn PHáº¢I lÃ : PHáº¦N ${chapNum}: [tiÃªu Ä‘á» Ä‘oáº¡n nÃ y]
- Tiáº¿p ná»‘i tá»± nhiÃªn tá»« ná»™i dung Ä‘Ã£ cÃ³, khÃ´ng tÃ³m táº¯t láº¡i
- Káº¿t báº±ng cliffhanger Ä‘á»ƒ ngÆ°á»i Ä‘á»c muá»‘n Ä‘á»c tiáº¿p
- KhÃ´ng thÃªm ghi chÃº hay giáº£i thÃ­ch ngoÃ i truyá»‡n
- VÄƒn phong tiáº¿ng Viá»‡t tá»± nhiÃªn, cuá»‘n hÃºt

ðŸ’¡ ${continuePromptText}

Báº¯t Ä‘áº§u viáº¿t ngay:`;

    logger.info('Studio', `AI Append: "${storyTitle}" pháº§n ${chapNum} | ${words} tá»« | ${selectedModel}`);
    const rawText = await callGeminiAPI(apiKey, systemPrompt, words, 0.92, selectedModel);
    if (!rawText) return res.status(500).json({ success: false, error: 'Gemini khÃ´ng tráº£ vá» ná»™i dung' });

    // ThÃªm separator + ná»™i dung má»›i vÃ o file
    const separator = `\n\n${'â•'.repeat(50)}\n\n`;
    const appendContent = separator + rawText.trim();
    fs.appendFileSync(txtFile, appendContent, 'utf8');

    const newTotalContent = existingContent + appendContent;
    const addedWords = rawText.split(/\s+/).filter(Boolean).length;
    const totalWords = newTotalContent.split(/\s+/).filter(Boolean).length;

    logger.success('Studio', `AI Append xong: +${addedWords} tá»« â†’ tá»•ng ${totalWords} tá»«`);
    res.json({ success: true, addedWords, totalWords, chapterNum: chapNum });
  } catch (err) {
    logger.error('Studio', `AI Append Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});


// Tráº¡ng thÃ¡i render audio Ä‘ang cháº¡y
const audioRenderJobs = {};

// POST /api/render-audio â€” Render audio má»™t hoáº·c nhiá»u táº­p
app.post('/api/render-audio', async (req, res) => {
  try {
    const { storyId, episodes, voiceName, rate, pitch, volume, wordsPerEpisode, engine, speed, preset, zerottsUrl } = req.body;
    const txtFile = path.join(STORIES_DIR, `${storyId}.txt`);
    if (!fs.existsSync(txtFile)) return res.status(404).json({ success: false, error: 'KhÃ´ng tÃ¬m tháº¥y truyá»‡n' });
    const content = fs.readFileSync(txtFile, 'utf8');
    const metaFile = path.join(STORIES_DIR, `${storyId}.json`);
    const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    const storyTitle = meta.originalTitle || meta.title || storyId;
    // Chia táº­p tá»« file .txt gá»‘c theo wordsPerEpisode cá»§a truyá»‡n
    const storyWpe = parseInt(wordsPerEpisode) || meta.wordsPerEpisode || 10000;
    const allEpisodes = splitStoryIntoEpisodes(content, storyWpe);
    const episodesToRender = episodes && episodes.length > 0
      ? allEpisodes.filter(ep => episodes.includes(ep.index))
      : allEpisodes;

    // Cáº­p nháº­t voice config náº¿u cÃ³
    if (voiceName) process.env.VOICE_NAME = voiceName;

    const jobId = `${storyId}_${Date.now()}`;
    audioRenderJobs[jobId] = { status: 'running', total: episodesToRender.length, done: 0, results: [] };

    res.json({ success: true, jobId, total: episodesToRender.length, message: `Báº¯t Ä‘áº§u render ${episodesToRender.length} táº­p audio...` });

    // Render async
    (async () => {
      for (const ep of episodesToRender) {
        const safeTitle = storyTitle.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 30);
        const audioFileName = `${safeTitle}_Tap${ep.index}.mp3`;
        const audioPath = path.join(AUDIO_DIR, audioFileName);
        try {
          logger.info('Studio', `Render audio: ${audioFileName} (${ep.wordCount} tá»« | engine: ${engine || 'edgetts'})...`);
          // Ghi script ra file táº¡m
          const tempId = `studio_${storyId}_ep${ep.index}`;

          // Override VOICE_NAME via env
          if (voiceName) process.env.VOICE_NAME = voiceName;

          // Táº¡o stream cho ZeroTTS náº¿u dÃ¹ng engine zerotts
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
                  episodeTitle: ep.title || `Táº­p ${ep.index}`,
                  streamId,
                  streamUrl,
                  engine: 'zerotts'
                });
                logger.info('Studio', `  Live stream ready: ${streamUrl}`);
              }
            } catch (sErr) {
              logger.warn('Studio', `  KhÃ´ng thá»ƒ táº¡o live stream: ${sErr.message}`);
            }
          }

          // TÃ­nh rate string Ä‘Ãºng Ä‘á»‹nh dáº¡ng edge-tts: UI gá»­i sá»‘ % tÄƒng thÃªm (vÃ­ dá»¥ 33 = +33% â‰ˆ 1.6x)
          const rateStr = (rate !== undefined && rate !== null && rate !== 0)
            ? (rate > 0 ? `+${rate}%` : `${rate}%`)
            : '+0%';
          logger.info('Studio', `Rate: ${rateStr} (raw: ${rate})`);
          await generateVoice(tempId, ep.content, rateStr, ({ chunk, totalChunks, elapsedMs }) => {
            broadcast('audio_chunk_progress', { jobId, episodeIndex: ep.index, chunk, totalChunks, elapsedMs });
            logger.info('Studio', `  Chunk ${chunk}/${totalChunks} OK (${elapsedMs}ms)`);
          }, { engine, voiceName, speed, preset, zerottsUrl, streamId });

          // Copy tá»« audio cache sang thÆ° má»¥c audio studio
          const tempAudioPath = path.join(__dirname, 'workspace', 'audio', `${tempId}.mp3`);
          if (fs.existsSync(tempAudioPath) && tempAudioPath !== audioPath) {
            fs.copyFileSync(tempAudioPath, audioPath);
          }

          const fileSize = fs.existsSync(audioPath) ? fs.statSync(audioPath).size : 0;
          // Æ¯á»›c tÃ­nh duration thá»±c táº¿ tá»« kÃ­ch thÆ°á»›c file MP3 (bitrate 128kbps = 16KB/s)
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
          logger.success('Studio', `âœ… Audio: ${audioFileName} (${Math.round(fileSize/1024)} KB)`);
        } catch (err) {
          logger.error('Studio', `Lá»—i render audio táº­p ${ep.index}: ${err.message}`);
          audioRenderJobs[jobId].results.push({ episodeIndex: ep.index, status: 'error', error: err.message });
          audioRenderJobs[jobId].done++;
          broadcast('audio_render_progress', { jobId, episodeIndex: ep.index, status: 'error', done: audioRenderJobs[jobId].done, total: audioRenderJobs[jobId].total });
        }
      }
      audioRenderJobs[jobId].status = 'done';
      broadcast('audio_render_complete', { jobId, results: audioRenderJobs[jobId].results });

      logger.success('Studio', `âœ… HoÃ n thÃ nh render ${episodesToRender.length} táº­p audio!`);
    })();

  } catch (err) {
    logger.error('Studio', `Lá»—i render audio: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/render-audio/status/:jobId
app.get('/api/render-audio/status/:jobId', (req, res) => {
  const job = audioRenderJobs[req.params.jobId];
  if (!job) return res.status(404).json({ success: false, error: 'Job khÃ´ng tá»“n táº¡i' });
  res.json({ success: true, ...job });
});

// GET /api/voice-preview/zerotts/:name â€” Xem thá»­ giá»ng ZeroTTS
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
    res.status(404).json({ success: false, error: 'KhÃ´ng tÃ¬m tháº¥y máº«u giá»ng ZeroTTS' });
  }
});

// GET /api/voice-preview/edgetts/:name â€” Máº«u giá»ng Edge-TTS
app.get('/api/voice-preview/edgetts/:name', async (req, res) => {
  const { name } = req.params;
  const previewDir = path.join(AUDIO_DIR, 'previews');
  fs.mkdirSync(previewDir, { recursive: true });
  const previewFile = path.join(previewDir, `${name}.mp3`);
  if (fs.existsSync(previewFile) && fs.statSync(previewFile).size > 1000) {
    return res.sendFile(previewFile);
  }
  const voiceTitle = name.includes('NamMinh') ? 'Nam Minh' : 'HoÃ i My';
  const sampleText = `Xin chÃ o! ÄÃ¢y lÃ  giá»ng Ä‘á»c máº«u ${voiceTitle} trÃªn AIBeta Studio.`;
  try {
    const { execFile } = require('child_process');
    const tempTxt = previewFile.replace('.mp3', '.txt');
    fs.writeFileSync(tempTxt, sampleText, 'utf8');
    execFile(config.paths.edgeTts, ['--voice', name, '--file', tempTxt, '--write-media', previewFile], { timeout: 15000 }, (err) => {
      try { fs.unlinkSync(tempTxt); } catch {}
      if (!err && fs.existsSync(previewFile)) {
        res.sendFile(previewFile);
      } else {
        res.status(500).json({ success: false, error: 'KhÃ´ng thá»ƒ táº¡o máº«u giá»ng Edge-TTS' });
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/zerotts-stream/:sid â€” Proxy luá»“ng phÃ¡t audio trá»±c tiáº¿p tá»« ZeroTTS
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

// GET /api/audio-files â€” Danh sÃ¡ch file audio Ä‘Ã£ render
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

// DELETE /api/audio-files/all â€” XÃ³a toÃ n bá»™ file audio
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

// DELETE /api/audio-files/:filename â€” XÃ³a má»™t file audio
app.delete('/api/audio-files/:filename', (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // trÃ¡nh path traversal
    const filepath = path.join(AUDIO_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, error: 'File khÃ´ng tá»“n táº¡i' });
    fs.unlinkSync(filepath);
    res.json({ success: true, deleted: filename });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/video-bg-files â€” Danh sÃ¡ch video ná»n + nháº¡c ná»n
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

// POST /api/render-video â€” GhÃ©p video tá»« audio + video ná»n + nháº¡c ná»n
app.post('/api/render-video', async (req, res) => {
  try {
    const { mappings, musicVolume, outputFormat } = req.body;
    // mappings = [{ audioFile, videoBgFile, musicFile, outputName }]
    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ success: false, error: 'Thiáº¿u thÃ´ng tin ghÃ©p video' });
    }
    const jobId = `video_${Date.now()}`;
    videoRenderJobs[jobId] = { status: 'running', total: mappings.length, done: 0, results: [] };
    res.json({ success: true, jobId, total: mappings.length, message: `Báº¯t Ä‘áº§u ghÃ©p ${mappings.length} video...` });

    // GhÃ©p async
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
          if (!fs.existsSync(audioPath)) throw new Error(`Audio khÃ´ng tá»“n táº¡i: ${audioFile}`);
          if (!fs.existsSync(videoBgPath)) throw new Error(`Video ná»n khÃ´ng tá»“n táº¡i: ${videoBgFile}`);

          let ffmpegCmd;
          if (musicPath && fs.existsSync(musicPath)) {
            // GhÃ©p: video ná»n + audio truyá»‡n + nháº¡c ná»n (mix)
            ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoBgPath}" -i "${audioPath}" -stream_loop -1 -i "${musicPath}" ` +
              `-filter_complex "[1:a]volume=1.0[voice];[2:a]volume=${volMusic}[music];[voice][music]amix=inputs=2:duration=first[aout]" ` +
              `-map 0:v -map "[aout]" -shortest -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k "${outputPath}"`;
          } else {
            // GhÃ©p: video ná»n + audio truyá»‡n (khÃ´ng nháº¡c ná»n)
            ffmpegCmd = `ffmpeg -y -stream_loop -1 -i "${videoBgPath}" -i "${audioPath}" ` +
              `-map 0:v -map 1:a -shortest -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 192k "${outputPath}"`;
          }

          logger.info('Studio', `FFmpeg ghÃ©p video: ${outName}...`);
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
          logger.success('Studio', `âœ… Video ghÃ©p xong: ${outName} (${result.fileSizeMB} MB)`);
        } catch (err) {
          logger.error('Studio', `Lá»—i ghÃ©p video ${outName}: ${err.message}`);
          videoRenderJobs[jobId].results.push({ outputName: outName, status: 'error', error: err.message });
          videoRenderJobs[jobId].done++;
          broadcast('video_render_progress', { jobId, outputName: outName, status: 'error', done: videoRenderJobs[jobId].done, total: videoRenderJobs[jobId].total });
        }
      }
      videoRenderJobs[jobId].status = 'done';
      broadcast('video_render_complete', { jobId, results: videoRenderJobs[jobId].results });
      logger.success('Studio', `âœ… HoÃ n thÃ nh ghÃ©p ${mappings.length} video!`);
    })();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/output-videos â€” Danh sÃ¡ch video output hoÃ n chá»‰nh
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

// Upload video ná»n
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

// Upload nháº¡c ná»n
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

// â”€â”€â”€ ZeroTTS Process Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const { spawn } = require('child_process');
const ZEROTTS_DIR = path.join(__dirname, '..', 'ZeroTTS');
const ZEROTTS_PORT = 7860;
let zerottsProcess = null;
let zerottsPid = null;

// POST /api/zerotts/start â€” Khá»Ÿi Ä‘á»™ng ZeroTTS song song
app.post('/api/zerotts/start', async (req, res) => {
  // Kiá»ƒm tra náº¿u Ä‘Ã£ online rá»“i thÃ¬ khÃ´ng cáº§n start láº¡i
  try {
    const check = await axios.get(`http://localhost:${ZEROTTS_PORT}/api/tts-status`, { timeout: 2000 });
    if (check.data?.ok || check.data?.status === 'ok') {
      return res.json({ success: true, status: 'already_running', message: 'ZeroTTS Ä‘Ã£ online rá»“i!' });
    }
  } catch {/* chÆ°a online â€” tiáº¿p tá»¥c start */}

  // Náº¿u process cÅ© cÃ²n Ä‘Ã³ thÃ¬ kill trÆ°á»›c
  if (zerottsProcess && !zerottsProcess.killed) {
    try { zerottsProcess.kill('SIGTERM'); } catch {}
    zerottsProcess = null;
  }

  try {
    logger.info('ZeroTTS', `Khá»Ÿi Ä‘á»™ng ZeroTTS tá»«: ${ZEROTTS_DIR}`);
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
      logger.info('ZeroTTS', `Tiáº¿n trÃ¬nh káº¿t thÃºc (code ${code})`);
      zerottsProcess = null;
      zerottsPid = null;
      broadcast('zerotts_status', { running: false });
    });

    broadcast('zerotts_status', { running: true, pid: zerottsPid });
    res.json({ success: true, status: 'starting', pid: zerottsPid, message: 'Äang khá»Ÿi Ä‘á»™ng ZeroTTS...' });
  } catch (err) {
    logger.error('ZeroTTS', `Lá»—i khá»Ÿi Ä‘á»™ng: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/zerotts/status â€” Kiá»ƒm tra ZeroTTS cÃ³ online khÃ´ng
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
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Start Server

// ══════════════════════════════════════════════════════════════
// TAB 3: TẠO ẢNH API – Character & Scene Image Generation
// ══════════════════════════════════════════════════════════════

// Helper: download image from URL to local path
async function downloadImageToLocal(imageUrl, localPath) {
  const http = require('http');
  const https = require('https');
  return new Promise((resolve, reject) => {
    const file = require('fs').createWriteStream(localPath);
    const client = imageUrl.startsWith('https') ? https : http;
    client.get(imageUrl, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return downloadImageToLocal(response.headers.location, localPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error('HTTP ' + response.statusCode));
      }
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(localPath)));
    }).on('error', (err) => {
      require('fs').unlink(localPath, () => {});
      reject(err);
    });
  });
}

// Helper: gọi Gemini với auto retry + key rotation
async function callGeminiForImage(prompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const apiKey = geminiKeyManager.getCurrentKey();
  if (!apiKey) throw new Error('Không có Gemini API key');
  const genAI = new GoogleGenerativeAI(apiKey);
  const requestOptions = { apiVersion: 'v1beta' };
  const models = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'];
  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName }, requestOptions);
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (e) {
      if (e.message && (e.message.includes('quota') || e.message.includes('429'))) {
        geminiKeyManager.markQuotaExceeded(apiKey);
      }
      if (modelName === models[models.length - 1]) throw e;
    }
  }
}

// POST /api/img/analyze-characters
// Phân tích nhân vật từ nội dung truyện bằng Gemini
app.post('/api/img/analyze-characters', async (req, res) => {
  try {
    const { storyTitle, content } = req.body;
    if (!content) return res.json({ success: false, error: 'Không có nội dung truyện' });

    const storySnippet = content.slice(0, 6000); // Giới hạn để tránh tốn token

    const prompt = `Bạn là chuyên gia phân tích nhân vật trong văn học. Hãy đọc đoạn truyện sau và trích xuất TẤT CẢ nhân vật quan trọng.

TRUYỆN: "${storyTitle}"
NỘI DUNG:
${storySnippet}

Trả về JSON array (KHÔNG có markdown, chỉ JSON thuần):
[
  {
    "name": "Tên nhân vật (đầy đủ, rõ ràng)",
    "role": "Vai trò (Nhân vật chính / Nhân vật phụ / Phản diện / ...)",
    "gender": "male / female / unknown",
    "age": "Tuổi ước tính hoặc mô tả (trẻ em / thanh niên / trung niên / lớn tuổi)",
    "appearance": "Mô tả ngoại hình chi tiết bằng tiếng Anh: màu tóc, kiểu tóc, màu mắt, chiều cao, vóc dáng, trang phục đặc trưng, đặc điểm nhận dạng nổi bật",
    "personality": "Tính cách ngắn gọn",
    "imagePrompt": "English prompt để generate portrait: [gender] [age] [appearance details], [setting/background hint], anime/realistic style, high quality portrait, detailed face"
  }
]

Chỉ trả về JSON array, không giải thích thêm.`;

    const responseText = await callGeminiForImage(prompt);
    // Parse JSON từ response
    let characters = [];
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        characters = JSON.parse(jsonMatch[0]);
      }
    } catch (pe) {
      logger.warn('ImgAPI', 'Parse JSON nhân vật lỗi: ' + pe.message);
    }

    logger.success('ImgAPI', `Phân tích xong: ${characters.length} nhân vật trong "${storyTitle}"`);
    res.json({ success: true, characters });
  } catch (e) {
    logger.error('ImgAPI', 'analyze-characters lỗi: ' + e.message);
    res.json({ success: false, error: e.message });
  }
});

// POST /api/img/analyze-scenes
// Phân tích và chia cảnh từ truyện, tạo prompt nhất quán với nhân vật
app.post('/api/img/analyze-scenes', async (req, res) => {
  try {
    const { storyTitle, content, characters } = req.body;
    if (!content) return res.json({ success: false, error: 'Không có nội dung truyện' });

    // Build character reference string
    const charRef = (characters || []).map(c =>
      `- ${c.name} (${c.role}): ${c.appearance || c.imagePrompt || ''}`
    ).join('\n');

    const storySnippet = content.slice(0, 8000);

    const prompt = `Bạn là đạo diễn nghệ thuật AI. Hãy phân tích truyện sau và chia thành các cảnh quan trọng để vẽ minh họa.

TRUYỆN: "${storyTitle}"

NHÂN VẬT (giữ nhất quán):
${charRef || 'Chưa có thông tin nhân vật'}

NỘI DUNG TRUYỆN:
${storySnippet}

Hãy chia thành 6-12 cảnh quan trọng nhất. Trả về JSON array (KHÔNG có markdown):
[
  {
    "index": 1,
    "episodeTitle": "Tên cảnh ngắn gọn (tiếng Việt)",
    "desc": "Mô tả ngắn cảnh này xảy ra gì (tiếng Việt, 1-2 câu)",
    "characters_in_scene": ["Tên nhân vật xuất hiện trong cảnh"],
    "prompt": "English Pollinations.ai image prompt: [scene description], [character appearances consistent with above], [mood/lighting], [art style: anime illustration / realistic / cinematic], ultra detailed, high quality"
  }
]

Đảm bảo: prompt tiếng Anh, nhân vật NHẤT QUÁN với mô tả đã cho, không thay đổi ngoại hình giữa các cảnh.`;

    const responseText = await callGeminiForImage(prompt);
    let scenes = [];
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        scenes = JSON.parse(jsonMatch[0]);
      }
    } catch (pe) {
      logger.warn('ImgAPI', 'Parse JSON cảnh lỗi: ' + pe.message);
    }

    logger.success('ImgAPI', `Phân tích xong: ${scenes.length} cảnh trong "${storyTitle}"`);
    res.json({ success: true, scenes });
  } catch (e) {
    logger.error('ImgAPI', 'analyze-scenes lỗi: ' + e.message);
    res.json({ success: false, error: e.message });
  }
});

// POST /api/img/gen-character
// Tạo ảnh chân dung nhân vật qua Pollinations.ai
app.post('/api/img/gen-character', async (req, res) => {
  try {
    const { character, storyId } = req.body;
    if (!character) return res.json({ success: false, error: 'Thiếu thông tin nhân vật' });

    const prompt = character.imagePrompt || `${character.gender || 'person'} character portrait, ${character.appearance || character.name}, anime style, detailed face, high quality, white background`;
    const seed = Math.floor(Math.random() * 900000) + 100000;
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=512&height=768&seed=${seed}&model=flux-realism&nologo=true`;

    // Download to local
    const downloadsDir = config.paths.downloads || path.join(__dirname, 'workspace', 'downloads');
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
    const safeName = (character.name || 'char').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
    const localFileName = `char_${safeName}_${seed}.jpg`;
    const localPath = path.join(downloadsDir, localFileName);

    await downloadImageToLocal(imageUrl, localPath);

    logger.success('ImgAPI', `Ảnh nhân vật "${character.name}" OK: ${localFileName}`);
    res.json({ success: true, imgUrl: `/downloads/${localFileName}`, localPath });
  } catch (e) {
    logger.error('ImgAPI', 'gen-character lỗi: ' + e.message);
    res.json({ success: false, error: e.message });
  }
});

// POST /api/img/gen-scene
// Tạo ảnh cảnh truyện qua Pollinations.ai (với character consistency)
app.post('/api/img/gen-scene', async (req, res) => {
  try {
    const { scene, characters, storyId, sceneIndex } = req.body;
    if (!scene) return res.json({ success: false, error: 'Thiếu thông tin cảnh' });

    // Build character consistency suffix
    const sceneChars = (scene.characters_in_scene || []);
    const charDetails = (characters || [])
      .filter(c => sceneChars.includes(c.name))
      .map(c => c.appearance || '')
      .filter(Boolean)
      .join(', ');

    let finalPrompt = scene.prompt || `${scene.desc}, detailed illustration, high quality`;
    if (charDetails) {
      finalPrompt += `, consistent character: ${charDetails.slice(0, 200)}`;
    }
    finalPrompt += ', cinematic lighting, ultra detailed';

    const seed = Math.floor(Math.random() * 900000) + 100000;
    const encodedPrompt = encodeURIComponent(finalPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&seed=${seed}&model=flux-realism&nologo=true&enhance=true`;

    const downloadsDir = config.paths.downloads || path.join(__dirname, 'workspace', 'downloads');
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });
    const localFileName = `scene_${storyId || 'story'}_${sceneIndex || 0}_${seed}.jpg`;
    const localPath = path.join(downloadsDir, localFileName);

    await downloadImageToLocal(imageUrl, localPath);

    logger.success('ImgAPI', `Ảnh cảnh ${(sceneIndex||0)+1} OK: ${localFileName}`);
    res.json({ success: true, imgUrl: `/downloads/${localFileName}`, localPath });
  } catch (e) {
    logger.error('ImgAPI', 'gen-scene lỗi: ' + e.message);
    res.json({ success: false, error: e.message });
  }
});


server.listen(PORT, () => {
  console.log('\n' + 'â•'.repeat(60));
  console.log(`ðŸ–¥ï¸   WEB DASHBOARD Sáº´N SÃ€NG Táº I: http://localhost:${PORT}`);
  console.log('â•'.repeat(60) + '\n');
  logger.success('Server', `Má»Ÿ trÃ¬nh duyá»‡t truy cáº­p: http://localhost:${PORT}`);
});




