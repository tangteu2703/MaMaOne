// ==========================================
// CONFIG - Cấu hình trung tâm toàn hệ thống
// ==========================================
require('dotenv').config();
const path = require('path');
const fs = require('fs');

function hasSystemFFmpeg() {
  try {
    const { execSync } = require('child_process');
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function findPlaywrightFFmpeg() {
  const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Do Van Tang';
  const playwrightDir = path.join(userProfile, 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(playwrightDir)) {
    try {
      const files = fs.readdirSync(playwrightDir);
      const ffmpegFolder = files.find(f => f.startsWith('ffmpeg-'));
      if (ffmpegFolder) {
        const ffmpegPath = path.join(playwrightDir, ffmpegFolder, 'ffmpeg-win64.exe');
        if (fs.existsSync(ffmpegPath)) {
          return ffmpegPath;
        }
      }
    } catch (e) {}
  }
  return null;
}

function findPythonScriptPath(scriptName) {
  const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Do Van Tang';
  const pathsToSearch = [
    path.join(userProfile, 'AppData', 'Local', 'Programs', 'Python'),
    path.join(userProfile, 'AppData', 'Local', 'Python')
  ];

  for (const basePath of pathsToSearch) {
    if (fs.existsSync(basePath)) {
      try {
        const pythonDirs = fs.readdirSync(basePath);
        for (const dir of pythonDirs) {
          const scriptPath = path.join(basePath, dir, 'Scripts', scriptName);
          if (fs.existsSync(scriptPath)) {
            return scriptPath;
          }
          const scriptPathRoot = path.join(basePath, dir, scriptName);
          if (fs.existsSync(scriptPathRoot)) {
            return scriptPathRoot;
          }
        }
      } catch (e) {}
    }
  }
  return null;
}

module.exports = {
  // API Keys
  apify: {
    token: process.env.APIFY_API_TOKEN,
    tiktokScraperActorId: 'clockworks/tiktok-scraper',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest',
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
    hashtags: (process.env.HASHTAGS || 'satisfying,building,construction,craft,woodworking,lego,diy').split(','),
    maxVideosPerRun: parseInt(process.env.MAX_VIDEOS_PER_RUN || '5'),
    minViewCount: parseInt(process.env.MIN_VIEW_COUNT || '10000'),
    voiceName: process.env.VOICE_NAME || 'vi-VN-HoaiMyNeural',
    // Độ dài video nền tối thiểu ưu tiên cào (giây)
    minVideoDurationSeconds: parseInt(process.env.MIN_VIDEO_DURATION || '30'),
  },

  // Story (Truyện Audio) Settings
  story: {
    // Thư mục chứa file truyện .txt
    storiesDir: path.join(__dirname, '../workspace/stories'),
    // File truyện mặc định
    storyFile: process.env.STORY_FILE || path.join(__dirname, '../workspace/stories/story.txt'),
    // Số từ mỗi tập video (~200 từ = ~70-80 giây audio TTS tiếng Việt)
    wordsPerEpisode: parseInt(process.env.WORDS_PER_EPISODE || '200'),
    // Tên truyện đang hoạt động
    activeStoryTitle: process.env.STORY_TITLE || 'Câu Chuyện Của Tôi',
    // Nhạc nền lofi (đường dẫn file hoặc 'none')
    lofiMusicPath: process.env.LOFI_MUSIC_PATH || path.join(__dirname, '../workspace/music/lofi_background.mp3'),
    // Âm lượng nhạc nền (0.0 - 1.0, mặc định 40% âm lượng)
    musicVolume: parseFloat(process.env.MUSIC_VOLUME || '0.40'),
  },

  // File Paths
  paths: {
    downloads: path.join(__dirname, '../workspace/downloads'),
    audio: path.join(__dirname, '../workspace/audio'),
    output: path.join(__dirname, '../workspace/output'),
    logs: path.join(__dirname, '../logs'),
    stories: path.join(__dirname, '../workspace/stories'),
    music: path.join(__dirname, '../workspace/music'),
    // FFmpeg: ưu tiên dùng bin/ffmpeg.exe nếu có, hoặc hệ thống / Playwright
    ffmpeg: process.env.FFMPEG_PATH
      || (fs.existsSync(path.resolve(__dirname, '../bin/ffmpeg.exe'))
          ? path.resolve(__dirname, '../bin/ffmpeg.exe')
          : (hasSystemFFmpeg() ? 'ffmpeg' : null)
          || findPlaywrightFFmpeg()
          || 'ffmpeg'),
    // Python tools (tự động tìm trong AppData)
    ytdlp: process.env.YTDLP_PATH
      || findPythonScriptPath('yt-dlp.exe')
      || 'yt-dlp.exe',
    edgeTts: process.env.EDGETTS_PATH
      || findPythonScriptPath('edge-tts.exe')
      || 'edge-tts.exe',
  },

  // Scheduler (giờ đăng - 24h format)
  schedule: {
    cron: '0 8,12,18 * * *', // 8h, 12h, 18h mỗi ngày
    delayBetweenActions: { min: 2000, max: 5000 }, // delay random ms
  },
};

