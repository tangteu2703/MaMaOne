// ==========================================
// CONFIG - Cấu hình trung tâm toàn hệ thống
// ==========================================
require('dotenv').config();
const path = require('path');

module.exports = {
  // API Keys
  apify: {
    token: process.env.APIFY_API_TOKEN,
    tiktokScraperActorId: 'apidojo/tiktok-scraper',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: 'gemini-1.5-flash',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },

  // TikTok Settings
  tiktok: {
    sessionFile: process.env.TIKTOK_SESSION_FILE || './config/tiktok-session.json',
    uploadUrl: 'https://www.tiktok.com/upload',
    loginUrl: 'https://www.tiktok.com/login',
  },

  // Pipeline Settings
  pipeline: {
    hashtags: (process.env.HASHTAGS || 'coding,programming,aitools').split(','),
    maxVideosPerRun: parseInt(process.env.MAX_VIDEOS_PER_RUN || '3'),
    minViewCount: parseInt(process.env.MIN_VIEW_COUNT || '50000'),
    voiceName: process.env.VOICE_NAME || 'vi-VN-HoaiMyNeural',
  },

  // File Paths
  paths: {
    downloads: path.join(__dirname, '../workspace/downloads'),
    audio: path.join(__dirname, '../workspace/audio'),
    output: path.join(__dirname, '../workspace/output'),
    logs: path.join(__dirname, '../logs'),
    // FFmpeg: dùng bản đã tải sẵn bởi Playwright
    ffmpeg: process.env.FFMPEG_PATH
      || 'C:\\Users\\MV250392\\AppData\\Local\\ms-playwright\\ffmpeg-1011\\ffmpeg-win64.exe',
    // Python tools (full path vì không có trong PATH hệ thống)
    ytdlp: process.env.YTDLP_PATH
      || 'C:\\Users\\MV250392\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\yt-dlp.exe',
    edgeTts: process.env.EDGETTS_PATH
      || 'C:\\Users\\MV250392\\AppData\\Local\\Python\\pythoncore-3.14-64\\Scripts\\edge-tts.exe',
  },

  // Scheduler (giờ đăng - 24h format)
  schedule: {
    cron: '0 8,12,18 * * *', // 8h, 12h, 18h mỗi ngày
    delayBetweenActions: { min: 2000, max: 5000 }, // delay random ms
  },
};
