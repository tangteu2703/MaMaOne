// ==========================================
// MODULE 5: VIDEO EDITOR (Story Audio Mode)
// Ghép video nền (loop/concat nếu cần) + Voice đọc truyện AI + Nhạc Lofi nền + Subtitle
// ==========================================
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'VideoEditor';

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
 * Lấy thời lượng chính xác của file media bằng FFprobe
 * @returns {Promise<number>} Thời lượng (giây)
 */
function getMediaDuration(filePath) {
  return new Promise((resolve) => {
    const cmd = `"${config.paths.ffprobe || config.paths.ffmpeg.replace('ffmpeg', 'ffprobe')}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
    exec(cmd, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(10); // Default fallback
      } else {
        const dur = parseFloat(stdout.trim());
        resolve(isNaN(dur) ? 10 : dur);
      }
    });
  });
}

/**
 * Kiểm tra video có luồng audio không
 */
function hasAudioStream(videoPath) {
  return new Promise((resolve) => {
    const cmd = `"${config.paths.ffprobe || config.paths.ffmpeg.replace('ffmpeg', 'ffprobe')}" -v error -select_streams a -show_entries stream=codec_name -of default=noprint_wrappers=1 "${videoPath}"`;
    exec(cmd, (error, stdout) => {
      resolve(!error && stdout.trim().length > 0);
    });
  });
}

/**
 * Tạo file SRT subtitle từ nội dung truyện
 * Chia câu thành cụm ngắn (5-6 từ) theo thời gian audio
 */
async function createSubtitleFile(videoId, storyContent, audioPath, voiceSpeed = 1.35) {
  const srtPath = path.join(config.paths.audio, `${videoId}.srt`);
  const rawDuration = await getMediaDuration(audioPath);
  const audioDuration = rawDuration / voiceSpeed;

  // Làm sạch và chia thành các cụm chữ (5-6 từ/cụm để đọc thoải mái)
  const words = storyContent.replace(/[*_#~`]/g, '').trim().split(/\s+/).filter(w => w.length > 0);
  const wordsPerChunk = 5;
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }

  const chunkDuration = audioDuration / Math.max(1, chunks.length);

  let srtContent = '';
  chunks.forEach((chunk, index) => {
    const startTime = index * chunkDuration;
    const endTime = Math.min((index + 1) * chunkDuration, audioDuration);
    srtContent += `${index + 1}\n`;
    srtContent += `${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n`;
    srtContent += `${chunk}\n\n`;
  });

  fs.writeFileSync(srtPath, srtContent, 'utf8');
  logger.info(MODULE, `Subtitle: ${chunks.length} cụm chữ, ${audioDuration.toFixed(1)}s (tốc độ ${voiceSpeed}x)`);
  return { srtPath, effectiveDuration: audioDuration };
}

/**
 * Ghép danh sách video nền lại thành 1 video đủ dài (concat + loop)
 * @param {string[]} videoPaths - Danh sách đường dẫn file video nền
 * @param {number} targetDurationSeconds - Độ dài cần đạt (giây)
 * @param {string} outputPath - Đường dẫn file output
 */
async function createBackgroundVideo(videoPaths, targetDurationSeconds, outputPath) {
  logger.info(MODULE, `Cần ${targetDurationSeconds.toFixed(1)}s video nền từ ${videoPaths.length} clip`);

  // Đo tổng thời lượng hiện có
  let totalAvailDuration = 0;
  const durations = [];
  for (const vp of videoPaths) {
    const d = await getMediaDuration(vp);
    durations.push(d);
    totalAvailDuration += d;
  }

  logger.info(MODULE, `Tổng video nền sẵn có: ${totalAvailDuration.toFixed(1)}s | Cần: ${targetDurationSeconds.toFixed(1)}s`);

  // Xây dựng danh sách file cần dùng (loop nếu thiếu)
  const useList = [];
  let accum = 0;
  let loopRound = 0;
  while (accum < targetDurationSeconds * 1.05 && loopRound < 20) {
    for (let i = 0; i < videoPaths.length && accum < targetDurationSeconds * 1.05; i++) {
      useList.push({ path: videoPaths[i], duration: durations[i] });
      accum += durations[i];
    }
    loopRound++;
  }

  logger.info(MODULE, `Sẽ ghép ${useList.length} clip (trong ${loopRound} vòng lặp) = ${accum.toFixed(1)}s`);

  // Tạo file concat list
  const concatListPath = path.join(config.paths.audio, `concat_${path.basename(outputPath, '.mp4')}.txt`);
  const concatContent = useList.map(u => `file '${u.path.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatListPath, concatContent, 'utf8');

  // FFmpeg concat (scale chuẩn 9:16 khi ghép)
  return new Promise((resolve, reject) => {
    const cmd = [
      `"${config.paths.ffmpeg}"`,
      '-f', 'concat',
      '-safe', '0',
      '-i', `"${concatListPath}"`,
      '-vf', `"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"`,
      '-an', // Bỏ audio của video nền (sẽ dùng voice + lofi thay)
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-t', targetDurationSeconds.toString(),
      '-y',
      `"${outputPath}"`,
    ].join(' ');

    exec(cmd, { timeout: 300000 }, (error) => {
      try { fs.unlinkSync(concatListPath); } catch {}
      if (error) reject(new Error(`Ghép video nền lỗi: ${error.message.split('\n')[0]}`));
      else {
        logger.success(MODULE, `Ghép xong video nền: ${path.basename(outputPath)}`);
        resolve(outputPath);
      }
    });
  });
}

/**
 * Ghép hoàn chỉnh: Video nền + Voice đọc truyện AI (1.35x) + Nhạc Lofi (40%) + Subtitle
 * @param {string} videoId - ID định danh tập truyện
 * @param {string[]} backgroundVideoPaths - Danh sách video nền (1 hoặc nhiều)
 * @param {string} audioPath - File voice đọc truyện (.mp3)
 * @param {object} episodeData - { title, content, index } - Data tập truyện
 */
async function editVideo(videoId, backgroundVideoPaths, audioPath, episodeData) {
  // Normalize: nếu nhận 1 string thay vì array
  const bgPaths = Array.isArray(backgroundVideoPaths) ? backgroundVideoPaths : [backgroundVideoPaths];

  const safeTitle = sanitizeTitle(episodeData?.title || `Episode_${videoId}`);
  const fileName = `${safeTitle}_${videoId}_final.mp4`;
  const outputPath = path.join(config.paths.output, fileName);

  if (fs.existsSync(outputPath)) {
    const existingSize = fs.statSync(outputPath).size;
    if (existingSize > 100 * 1024) {
      logger.info(MODULE, `Video output ${fileName} đã tồn tại`);
      return outputPath;
    }
    fs.unlinkSync(outputPath);
  }

  logger.info(MODULE, `Bắt đầu render Tập truyện: ${fileName}`);

  try {
    const voiceSpeed = 1.35; // Tăng tốc giọng đọc 1.35x
    const rawAudioDuration = await getMediaDuration(audioPath);
    const audioDuration = rawAudioDuration / voiceSpeed;
    logger.info(MODULE, `Audio gốc: ${rawAudioDuration.toFixed(1)}s ➔ Sau tăng tốc ${voiceSpeed}x: ${audioDuration.toFixed(1)}s`);

    // 2. Chuẩn bị video nền (concat/loop để đủ độ dài audio)
    const bgVideoPath = path.join(config.paths.audio, `bg_${videoId}.mp4`);
    await createBackgroundVideo(bgPaths, audioDuration + 1, bgVideoPath);

    // 3. Tạo subtitle SRT từ nội dung truyện
    const { srtPath } = await createSubtitleFile(videoId, episodeData.content, audioPath, voiceSpeed);

    // 4. Merge: video nền + voice (1.35x) + nhạc lofi + subtitle
    await mergeStoryVideo(bgVideoPath, audioPath, srtPath, outputPath, audioDuration, voiceSpeed);

    // Cleanup temp files
    try { fs.unlinkSync(bgVideoPath); } catch {}
    try { fs.unlinkSync(srtPath); } catch {}

    const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
    logger.success(MODULE, `✅ Render xong: ${fileName} (${sizeMB} MB)`);
    return outputPath;

  } catch (error) {
    logger.error(MODULE, `Lỗi render tập truyện: ${error.message}`);
    throw error;
  }
}

/**
 * Merge cuối: Video nền (không âm) + Voice AI (tăng tốc 1.35x) + Nhạc Lofi (40%) + Subtitle
 */
async function mergeStoryVideo(bgVideoPath, voicePath, srtPath, outputPath, audioDuration, voiceSpeed = 1.35) {
  return new Promise((resolve, reject) => {
    const srtEscaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const lofiPath = config.story.lofiMusicPath;
    const hasLofi = fs.existsSync(lofiPath);
    const musicVolume = config.story.musicVolume || 0.40;

    logger.info(MODULE, `Nhạc nền lofi: ${hasLofi ? lofiPath : 'Không có — chỉ dùng voice'}`);

    let cmd;

    if (hasLofi) {
      const filterComplex = [
        `[0:v]subtitles='${srtEscaped}':force_style='FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Bold=1,Outline=2,Shadow=1,MarginV=120,Alignment=2'[v]`,
        `[1:a]atempo=${voiceSpeed},volume=1.0[voice]`,
        `[2:a]volume=${musicVolume}[lofi]`,
        `[voice][lofi]amix=inputs=2:duration=first:dropout_transition=3[a]`,
      ].join('; ');

      cmd = [
        `"${config.paths.ffmpeg}"`,
        '-i', `"${bgVideoPath}"`,     // [0] video nền
        '-i', `"${voicePath}"`,       // [1] voice đọc truyện
        '-stream_loop', '-1',
        '-i', `"${lofiPath}"`,        // [2] nhạc lofi (loop)
        '-filter_complex', `"${filterComplex}"`,
        '-map', '"[v]"',
        '-map', '"[a]"',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-preset', 'fast',
        '-crf', '23',
        '-b:a', '128k',
        '-t', audioDuration.toString(),
        '-movflags', '+faststart',
        '-y',
        `"${outputPath}"`,
      ].join(' ');
    } else {
      const filterComplex = [
        `[0:v]subtitles='${srtEscaped}':force_style='FontName=Arial,FontSize=13,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Bold=1,Outline=2,Shadow=1,MarginV=120,Alignment=2'[v]`,
        `[1:a]atempo=${voiceSpeed},volume=1.0[a]`,
      ].join('; ');

      cmd = [
        `"${config.paths.ffmpeg}"`,
        '-i', `"${bgVideoPath}"`,
        '-i', `"${voicePath}"`,
        '-filter_complex', `"${filterComplex}"`,
        '-map', '"[v]"',
        '-map', '"[a]"',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-preset', 'fast',
        '-crf', '23',

        '-b:a', '128k',
        '-t', audioDuration.toString(),
        '-movflags', '+faststart',
        '-y',
        `"${outputPath}"`,
      ].join(' ');
    }

    logger.info(MODULE, 'FFmpeg đang render video truyện audio...');

    exec(cmd, { timeout: 600000 }, (error) => {
      if (error) {
        logger.warn(MODULE, `FFmpeg lỗi nâng cao (${error.message.split('\n')[0]}), thử fallback đơn giản...`);
        // Fallback: chỉ ghép video + voice, không lofi, không subtitle
        mergeSimpleFallback(bgVideoPath, voicePath, outputPath, audioDuration)
          .then(resolve)
          .catch(reject);
      } else {
        logger.success(MODULE, 'Render video truyện audio hoàn chỉnh!');
        resolve();
      }
    });
  });
}

function mergeSimpleFallback(bgVideoPath, voicePath, outputPath, audioDuration) {
  return new Promise((resolve, reject) => {
    const cmd = [
      `"${config.paths.ffmpeg}"`,
      '-i', `"${bgVideoPath}"`,
      '-i', `"${voicePath}"`,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'fast',
      '-crf', '23',
      '-t', audioDuration.toString(),
      '-y',
      `"${outputPath}"`,
    ].join(' ');

    exec(cmd, { timeout: 300000 }, (error) => {
      if (error) reject(new Error(`Fallback merge thất bại: ${error.message}`));
      else resolve();
    });
  });
}

function formatSRTTime(seconds) {
  const pad = (num, size = 2) => String(num).padStart(size, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

module.exports = { editVideo, createBackgroundVideo, getMediaDuration };
