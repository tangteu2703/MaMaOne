// ==========================================
// MODULE 5: VIDEO EDITOR
// Ghép video + voice AI + subtitle TikTok style
// ==========================================
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'VideoEditor';

/**
 * Ghép video hoàn chỉnh: Video gốc + Voice AI + Subtitle
 * @param {string} videoId - ID video
 * @param {string} videoPath - Đường dẫn video gốc
 * @param {string} audioPath - Đường dẫn audio AI
 * @param {object} scriptData - { script, caption, hashtags, title }
 * @returns {Promise<string>} Đường dẫn video output
 */
async function editVideo(videoId, videoPath, audioPath, scriptData) {
  const outputPath = path.join(config.paths.output, `${videoId}_final.mp4`);

  if (fs.existsSync(outputPath)) {
    logger.info(MODULE, `Video output ${videoId} đã tồn tại`);
    return outputPath;
  }

  logger.info(MODULE, `Bắt đầu ghép video: ${videoId}`);

  try {
    // Bước 1: Tạo file subtitle SRT
    const srtPath = await createSubtitleFile(videoId, scriptData.script, audioPath);

    // Bước 2: Ghép video + audio + subtitle
    await mergeVideoAudioSubtitle(videoPath, audioPath, srtPath, outputPath);

    // Xóa file SRT tạm
    try { fs.unlinkSync(srtPath); } catch {}

    const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
    logger.success(MODULE, `Video output: ${videoId}_final.mp4 (${sizeMB} MB)`);

    return outputPath;
  } catch (error) {
    logger.error(MODULE, `Lỗi ghép video: ${error.message}`);
    throw error;
  }
}

/**
 * Tạo file SRT subtitle từ script
 * Chia kịch bản thành các đoạn nhỏ 3-5 giây
 */
async function createSubtitleFile(videoId, script, audioPath) {
  const srtPath = path.join(config.paths.audio, `${videoId}.srt`);

  // Tính thời lượng audio
  const audioDuration = await getAudioDuration(audioPath);
  const words = script.split(/\s+/).filter(w => w.length > 0);
  const wordsPerSecond = words.length / audioDuration;
  const wordsPerChunk = Math.max(4, Math.round(wordsPerSecond * 4)); // ~4 giây/chunk

  // Chia thành các chunk
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }

  const chunkDuration = audioDuration / chunks.length;

  // Viết file SRT
  let srtContent = '';
  chunks.forEach((chunk, index) => {
    const startTime = index * chunkDuration;
    const endTime = Math.min((index + 1) * chunkDuration, audioDuration);

    srtContent += `${index + 1}\n`;
    srtContent += `${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n`;
    srtContent += `${chunk}\n\n`;
  });

  fs.writeFileSync(srtPath, srtContent, 'utf8');
  logger.info(MODULE, `Đã tạo subtitle: ${chunks.length} đoạn, ${audioDuration.toFixed(1)}s`);

  return srtPath;
}

/**
 * Ghép video + audio + subtitle bằng FFmpeg
 */
async function mergeVideoAudioSubtitle(videoPath, audioPath, srtPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Escape paths cho Windows
    const escapeSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    // FFmpeg command:
    // -i video: input video gốc (tắt audio)
    // -i audio: voice AI mới
    // vf subtitles: burn-in phụ đề TikTok style (chữ to, trắng, có border đen)
    const cmd = [
      `"${config.paths.ffmpeg}"`,
      '-i', `"${videoPath}"`,
      '-i', `"${audioPath}"`,
      // Video filter: scale TikTok vertical + subtitles style
      '-vf', [
        `scale=1080:1920:force_original_aspect_ratio=increase`,
        `crop=1080:1920`,
        `subtitles='${escapeSrtPath}':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,MarginV=80,Alignment=2'`,
      ].join(','),
      // Map: video từ input 0, audio từ input 1
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'fast',
      '-crf', '23',
      '-b:a', '128k',
      // Cắt video theo độ dài audio (tối đa 3 phút)
      '-shortest',
      '-t', '180',
      '-movflags', '+faststart',
      '-y',
      `"${outputPath}"`,
    ].join(' ');

    logger.info(MODULE, 'Đang ghép video với FFmpeg...');

    exec(cmd, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        logger.warn(MODULE, `FFmpeg với subtitle thất bại, thử không có subtitle...`);
        // Thử lại không có subtitle
        mergeSimple(videoPath, audioPath, outputPath).then(resolve).catch(reject);
      } else {
        logger.success(MODULE, 'FFmpeg ghép video thành công!');
        resolve();
      }
    });
  });
}

/**
 * Ghép đơn giản không có subtitle (fallback)
 */
async function mergeSimple(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = [
      `"${config.paths.ffmpeg}"`,
      '-i', `"${videoPath}"`,
      '-i', `"${audioPath}"`,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'fast',
      '-crf', '23',
      '-shortest',
      '-t', '180',
      '-y',
      `"${outputPath}"`,
    ].join(' ');

    exec(cmd, { timeout: 300000 }, (error) => {
      if (error) {
        reject(new Error(`FFmpeg simple merge thất bại: ${error.message}`));
      } else {
        logger.success(MODULE, 'FFmpeg simple merge thành công (không có subtitle)');
        resolve();
      }
    });
  });
}

/**
 * Lấy thời lượng audio bằng ffprobe
 */
async function getAudioDuration(audioPath) {
  return new Promise((resolve) => {
    const cmd = `ffprobe -v quiet -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
    exec(cmd, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(60); // Default 60 giây
      } else {
        resolve(parseFloat(stdout.trim()) || 60);
      }
    });
  });
}

/**
 * Format thời gian sang SRT format (HH:MM:SS,mmm)
 */
function formatSRTTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.round((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s},${ms}`;
}

module.exports = { editVideo };
