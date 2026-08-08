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
    hashtags: process.env.HASHTAGS || 'coding,programming,aitools',
    maxVideos: process.env.MAX_VIDEOS_PER_RUN || '3',
    minViews: process.env.MIN_VIEW_COUNT || '50000',
    voiceName: process.env.VOICE_NAME || 'vi-VN-HoaiMyNeural',
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
  const { apifyToken, geminiKey, hashtags, maxVideos, minViews, voiceName } = req.body;
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
    };

    let lines = envContent.split('\n');
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

// 4. Run Pipeline Manual Trigger
app.post('/api/run', async (req, res) => {
  if (systemState.isRunning) {
    return res.status(400).json({ success: false, message: 'Pipeline đang chạy rồi!' });
  }

  const { hashtags, maxVideos } = req.body || {};

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
        hashtags: hashtags ? hashtags.split(',') : undefined,
        maxVideos: maxVideos ? parseInt(maxVideos) : undefined,
      });

      systemState.stats.processedToday += results.length;
      systemState.stats.successToday += results.filter(r => r.success).length;
      systemState.stats.failedToday += results.filter(r => !r.success).length;

      results.forEach(r => {
        systemState.videoHistory.unshift({
          id: r.videoId,
          time: new Date().toLocaleTimeString('vi-VN'),
          status: r.success ? 'success' : 'failed',
          steps: r.steps,
          error: r.error,
          videoFile: `/output/${r.videoId}_final.mp4`
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

// 5. Get Processed Videos
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
    res.json({ success: true, videos: files });
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
