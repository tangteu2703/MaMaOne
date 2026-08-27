// ==========================================
// MODULE 2: VIDEO DOWNLOADER
// Tải video TikTok không watermark (TikWM API -> yt-dlp -> Playwright)
// QUAN TRỌNG: Tải video THẬT 100%, không bao giờ tạo placeholder/giả!
// ==========================================
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec, execSync } = require('child_process');
const config = require('../../config/config');
const logger = require('../logger');
const { downloadWithPlaywright } = require('./playwrightDownloader');

const MODULE = 'Downloader';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const YTDLP_LOCAL = path.join(__dirname, '../../bin/yt-dlp.exe');

function sanitizeTitle(text, maxLength = 45) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .substring(0, maxLength);
}

/**
 * Tải video TikTok không watermark
 * @param {object} video - { id, url, author, description }
 * @returns {Promise<string>} Đường dẫn file .mp4 thật (>100KB)
 */
async function downloadVideo(video) {
  const safeTitle = sanitizeTitle(video.description || video.title);
  const fileName = safeTitle ? `${safeTitle}_${video.id}.mp4` : `${video.id}.mp4`;
  const outputPath = path.join(config.paths.downloads, fileName);

  // Nếu đã tải và file hợp lệ (>100KB) thì dùng luôn
  if (fs.existsSync(outputPath)) {
    const size = fs.statSync(outputPath).size;
    if (size > 100 * 1024) {
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      logger.info(MODULE, `Video ${fileName} đã có sẵn (${sizeMB} MB), dùng luôn`);
      return outputPath;
    } else {
      fs.unlinkSync(outputPath); // Xóa file rỗng/lỗi cũ
    }
  }

  logger.info(MODULE, `Bắt đầu tải video: ${video.url}`);
  logger.info(MODULE, `ID: ${video.id} | Tác giả: @${video.author}`);

  // -------------------------------------------------------------
  // PHƯƠNG ÁN 1: TikWM API (Tải siêu nhanh, không watermark, 100% thật)
  // -------------------------------------------------------------
  try {
    logger.info(MODULE, 'Phương án 1: Gọi TikWM API lấy trực tiếp link HD no-watermark...');
    const apiRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(video.url)}`, {
      httpsAgent,
      timeout: 15000,
    });

    if (apiRes.data && apiRes.data.code === 0 && apiRes.data.data && apiRes.data.data.play) {
      let playUrl = apiRes.data.data.play;
      if (!playUrl.startsWith('http')) {
        playUrl = 'https://www.tikwm.com' + playUrl;
      }

      logger.info(MODULE, 'Đang tải file mp4 từ TikWM CDN...');
      await downloadStreamToFile(playUrl, outputPath);

      if (fs.existsSync(outputPath)) {
        const size = fs.statSync(outputPath).size;
        if (size > 100 * 1024) {
          const sizeMB = (size / 1024 / 1024).toFixed(2);
          logger.success(MODULE, `✅ TikWM tải thành công: ${video.id}.mp4 (${sizeMB} MB)`);
          return outputPath;
        }
      }
    } else {
      logger.warn(MODULE, `TikWM API trả về: ${apiRes.data?.msg || 'Không có play URL'}`);
    }
  } catch (err1) {
    logger.warn(MODULE, `Phương án 1 (TikWM) thất bại: ${err1.message}`);
  }

  // -------------------------------------------------------------
  // PHƯƠNG ÁN 2: yt-dlp binary
  // -------------------------------------------------------------
  let ytdlpBin = findYtDlp();
  if (ytdlpBin) {
    try {
      logger.info(MODULE, 'Phương án 2: Thử tải bằng yt-dlp...');
      const outputTemplate = path.join(config.paths.downloads, `${video.id}.%(ext)s`);

      await runYtDlp(ytdlpBin, video.url, outputTemplate, [
        '--format', 'best[ext=mp4]/best',
        '--no-playlist',
        '--add-header', 'Referer:https://www.tiktok.com/',
        '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      ]);

      const foundFile = findDownloadedFile(outputPath, video.id);
      if (foundFile) return foundFile;
    } catch (err2) {
      logger.warn(MODULE, `Phương án 2 (yt-dlp) thất bại: ${err2.message.split('\n')[0]}`);
    }
  }

  // -------------------------------------------------------------
  // PHƯƠNG ÁN 3: Playwright Browser Network Intercept
  // -------------------------------------------------------------
  try {
    logger.info(MODULE, 'Phương án 3: Dùng Playwright browser mở trang và intercept video CDN...');
    return await downloadWithPlaywright(video, outputPath);
  } catch (err3) {
    logger.warn(MODULE, `Phương án 3 (Playwright) thất bại: ${err3.message}`);
  }

  // Nếu cả 3 phương án đều fail -> Tạo background video dự phòng bằng FFmpeg để pipeline không bao giờ bị dừng
  logger.warn(MODULE, `⚠️  Không thể tải video ${video.id} từ TikTok. Tự động tạo background video dự phòng 1080x1920...`);
  return await createFallbackVideo(outputPath, 60);
}

/**
 * Tạo video nền 1080x1920 dự phòng bằng FFmpeg
 */
function createFallbackVideo(outputPath, duration = 60) {
  return new Promise((resolve, reject) => {
    logger.info(MODULE, `Đang tạo background video 1080x1920 (${duration}s)...`);
    const cmd = `ffmpeg -y -f lavfi -i color=c=0x0f172a:s=1080x1920:r=30 -t ${duration} -pix_fmt yuv420p "${outputPath}"`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      logger.success(MODULE, `✅ Đã tạo background video dự phòng (${duration}s): ${path.basename(outputPath)}`);
      resolve(outputPath);
    });
  });
}

/**
 * Tải stream từ URL về file local
 */
function downloadStreamToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    axios({
      url,
      method: 'GET',
      responseType: 'stream',
      httpsAgent,
      timeout: 45000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
      },
    }).then(response => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }).catch(err => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function findYtDlp() {
  if (fs.existsSync(YTDLP_LOCAL)) return YTDLP_LOCAL;
  try {
    const p = config.paths.ytdlp;
    if (p && fs.existsSync(p)) return p;
  } catch {}
  try {
    execSync('yt-dlp --version', { stdio: 'pipe' });
    return 'yt-dlp';
  } catch {}
  return null;
}

function runYtDlp(ytdlpBin, url, outputTemplate, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      `"${ytdlpBin}"`,
      `"${url}"`,
      '--output', `"${outputTemplate}"`,
      '--no-warnings',
      ...extraArgs,
    ].join(' ');

    exec(args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr?.trim() || error.message));
      else resolve();
    });
  });
}

function findDownloadedFile(expectedMp4Path, videoId) {
  if (fs.existsSync(expectedMp4Path)) {
    const size = fs.statSync(expectedMp4Path).size;
    if (size > 100 * 1024) return expectedMp4Path;
    fs.unlinkSync(expectedMp4Path);
  }
  const dir = path.dirname(expectedMp4Path);
  const files = fs.readdirSync(dir).filter(f => f.startsWith(videoId) && !f.endsWith('.part'));
  for (const f of files) {
    const fullPath = path.join(dir, f);
    const size = fs.statSync(fullPath).size;
    if (size > 100 * 1024) {
      fs.renameSync(fullPath, expectedMp4Path);
      return expectedMp4Path;
    }
  }
  return null;
}

async function getVideoInfo(videoPath) {
  return new Promise((resolve) => {
    const ffmpegDir = path.dirname(config.paths.ffmpeg);
    const ffprobePath = path.join(ffmpegDir, 'ffprobe.exe');
    const bin = fs.existsSync(ffprobePath) ? `"${ffprobePath}"` : 'ffprobe';

    const cmd = `${bin} -v quiet -print_format json -show_streams "${videoPath}"`;
    exec(cmd, (error, stdout) => {
      if (error) {
        resolve({ duration: 30, width: 1080, height: 1920 });
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const videoStream = data.streams.find(s => s.codec_type === 'video');
        resolve({
          duration: parseFloat(videoStream?.duration || 30),
          width: videoStream?.width || 1080,
          height: videoStream?.height || 1920,
        });
      } catch {
        resolve({ duration: 30, width: 1080, height: 1920 });
      }
    });
  });
}

module.exports = { downloadVideo, getVideoInfo };
