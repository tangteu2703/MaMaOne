// ==========================================
// MODULE 4: VOICE GENERATOR (TTS)
// Tạo giọng đọc AI Tiếng Việt chuẩn 100% (google-tts-api -> edge-tts)
// QUAN TRỌNG: Tạo tiếng THẬT 100%, không dùng silent placeholder
// ==========================================
const gTTS = require('google-tts-api');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec, execFile } = require('child_process');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'VoiceGen';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * Tạo file audio mp3 giọng đọc AI Tiếng Việt từ script
 * @param {string} videoId - ID video
 * @param {string} script - Kịch bản tiếng Việt cần đọc
 * @returns {Promise<string>} Đường dẫn file audio .mp3
 */
async function generateVoice(videoId, script, rateStr, onChunkProgress, options = {}) {
  const outputPath = path.join(config.paths.audio, `${videoId}.mp3`);
  const rate = rateStr || '+0%';
  const voiceName = options.voiceName || process.env.VOICE_NAME || config.pipeline.voiceName || 'vi-VN-HoaiMyNeural';
  const isDefaultVoice = voiceName === 'vi-VN-HoaiMyNeural';
  const isCustomRate  = rate !== '+0%' && rate !== '0%';
  const engine = options.engine || process.env.TTS_ENGINE || 'edgetts';

  // Xóa cache cũ nếu có rate hoặc voice mới
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
    logger.info(MODULE, `Xóa cache cũ để render lại`);
  }

  logger.info(MODULE, `Render: ${videoId} | engine=${engine} | voice=${voiceName} | rate=${rate}`);

  // ZeroTTS AI Engine (Local)
  if (engine === 'zerotts') {
    logger.info(MODULE, `Đang kết nối ZeroTTS AI engine (voice=${voiceName})...`);
    try {
      const ztResult = await tryZeroTTS(script, outputPath, { ...options, voiceName });
      if (ztResult && fs.existsSync(ztResult) && fs.statSync(ztResult).size > 1000) {
        if (onChunkProgress) onChunkProgress({ chunk: 1, totalChunks: 1, elapsedMs: 1000 });
        return ztResult;
      }
    } catch (err) {
      logger.warn(MODULE, `ZeroTTS thất bại: ${err.message} — fallback Edge-TTS`);
    }
  }

  // Edge-TTS: luôn ưu tiên khi có voice tùy chỉnh hoặc rate khác 0
  // (Google TTS không hỗ trợ voice chọn + rate)
  if (isCustomRate || !isDefaultVoice) {
    logger.info(MODULE, `Đang dùng Edge-TTS (voice=${voiceName}, rate=${rate})...`);
    const result = await tryEdgeTTS(script, outputPath, rate, voiceName, onChunkProgress);

    if (result && fs.existsSync(result) && fs.statSync(result).size > 5000) {
      const sizeKB = (fs.statSync(result).size / 1024).toFixed(1);
      logger.success(MODULE, `✅ Edge-TTS OK: ${videoId}.mp3 (${sizeKB} KB)`);
      return result;
    }
    logger.warn(MODULE, `Edge-TTS thất bại — fallback Google TTS (sẽ mất voice/rate)`);
  }

  // Google TTS: chỉ dùng khi không cần voice/rate đặc biệt (nhanh, online)
  try {
    logger.info(MODULE, 'Google TTS API...');
    const audioPath = await generateGoogleTTS(script, outputPath);
    if (audioPath && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 5000) {
      logger.success(MODULE, `✅ Google TTS OK: ${videoId}.mp3`);
      return audioPath;
    }
  } catch (err1) {
    logger.warn(MODULE, `Google TTS thất bại: ${err1.message}`);
  }

  // Fallback: Google Translate TTS trực tiếp
  logger.info(MODULE, 'Fallback: Google Translate TTS direct...');
  const result3 = await tryGoogleTTS(videoId, script, outputPath);
  if (result3 && fs.existsSync(result3) && fs.statSync(result3).size > 1000) {
    return result3;
  }

  throw new Error(`Không thể tạo giọng đọc cho ${videoId}.`);
}

/**
 * Google Translate TTS Node.js Fallback
 */
async function tryGoogleTTS(videoId, script, outputPath) {
  return new Promise((resolve) => {
    try {
      const sentences = script.match(/[^.!?]+[.!?]+/g) || [script];
      const chunks = [];
      let current = '';
      for (const s of sentences) {
        if ((current + s).length < 180) {
          current += ' ' + s;
        } else {
          if (current.trim()) chunks.push(current.trim());
          current = s;
        }
      }
      if (current.trim()) chunks.push(current.trim());
      if (chunks.length === 0) chunks.push(script.substring(0, 180));

      // Đảm bảo thư mục tồn tại trước khi ghi
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      const file = fs.createWriteStream(outputPath);
      file.on('error', (e) => { logger.warn(MODULE, `WriteStream lỗi: ${e.message}`); resolve(null); });
      let chunkIndex = 0;

      function downloadNextChunk() {
        if (chunkIndex >= chunks.length) {
          file.close(() => {
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 500) {
              logger.success(MODULE, `Google Translate TTS thành công! (${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB)`);
              resolve(outputPath);
            } else {
              resolve(null);
            }
          });
          return;
        }

        const q = encodeURIComponent(chunks[chunkIndex]);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${q}&tl=vi&client=tw-ob`;

        https.get(url, { rejectUnauthorized: false }, (res) => {
          if (res.statusCode === 200) {
            res.pipe(file, { end: false });
            res.on('end', () => {
              chunkIndex++;
              setTimeout(downloadNextChunk, 200);
            });
          } else {
            logger.warn(MODULE, `Google TTS chunk ${chunkIndex} status: ${res.statusCode}`);
            chunkIndex++;
            setTimeout(downloadNextChunk, 200);
          }
        }).on('error', (e) => {
          logger.warn(MODULE, `Google TTS err: ${e.message}`);
          resolve(null);
        });
      }

      downloadNextChunk();
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Tạo giọng đọc Tiếng Việt qua Google TTS API
 */
async function generateGoogleTTS(text, outputPath) {
  const cleanText = text.replace(/[*_#~`]/g, '').trim();
  if (!cleanText) throw new Error('Văn bản kịch bản rỗng');

  // Lấy danh sách URL audio (Google TTS tự ngắt dòng < 200 ký tự)
  const audioUrls = gTTS.getAllAudioUrls(cleanText, {
    lang: 'vi',
    slow: false,
    host: 'https://translate.google.com',
    timeout: 15000,
  });

  logger.info(MODULE, `Chia kịch bản thành ${audioUrls.length} đoạn audio...`);

  const audioBuffers = [];
  for (let i = 0; i < audioUrls.length; i++) {
    const item = audioUrls[i];
    const res = await axios.get(item.url, {
      responseType: 'arraybuffer',
      httpsAgent,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    audioBuffers.push(Buffer.from(res.data));
  }

  const combinedBuffer = Buffer.concat(audioBuffers);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, combinedBuffer);
  return outputPath;
}

/**
 * Split text thành các chunks ~500 từ theo ranh giới câu
 */
function splitTextIntoChunks(text, maxWords = 500) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text];
  const chunks = [];
  let current = '';
  let wordCount = 0;

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).length;
    if (wordCount + words > maxWords && current.trim()) {
      chunks.push(current.trim());
      current = sentence;
      wordCount = words;
    } else {
      current += ' ' + sentence;
      wordCount += words;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Render một chunk text bằng edge-tts (có retry)
 */
function renderEdgeTTSChunk(text, outputPath, rate, voice, edgeTtsPath) {
  return new Promise((resolve) => {
    const tempTxt = outputPath.replace('.mp3', '_chunk.txt');
    fs.writeFileSync(tempTxt, text, 'utf8');
    const args = ['--voice', voice, '--file', tempTxt, '--write-media', outputPath, '--rate', rate];

    function attempt(attemptsLeft) {
      // Xóa file cũ nếu có để tránh false-positive
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}

      execFile(edgeTtsPath, args, { timeout: 30000 }, (error, stdout, stderr) => {
        if (!error && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
          try { fs.unlinkSync(tempTxt); } catch {}
          resolve(outputPath);
        } else {
          const msg = (stderr || (error && error.message) || 'unknown').split('\n')[0];
          logger.warn(MODULE, `Edge-TTS chunk attempt failed (${attemptsLeft} left): ${msg}`);
          if (attemptsLeft > 0) {
            logger.info(MODULE, `Retry chunk sau 2s...`);
            setTimeout(() => attempt(attemptsLeft - 1), 2000);
          } else {
            try { fs.unlinkSync(tempTxt); } catch {}
            resolve(null);
          }
        }
      });
    }

    attempt(2); // 2 retries
  });
}


/**
 * Ghép nhiều file MP3 thành 1 bằng ffmpeg
 */
function concatMp3WithFfmpeg(inputPaths, outputPath) {
  return new Promise((resolve) => {
    const listFile = outputPath + '_concat.txt';
    const listContent = inputPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listFile, listContent, 'utf8');
    const ffmpegPath = config.paths.ffmpeg || 'ffmpeg';
    execFile(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputPath],
      { timeout: 120000 }, (error) => {
        try { fs.unlinkSync(listFile); } catch {}
        if (!error && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
          resolve(outputPath);
        } else {
          if (error) logger.warn(MODULE, `ffmpeg concat error: ${error.message.split('\n')[0]}`);
          resolve(null);
        }
      });
  });
}

/**
 * Edge-TTS: split text dài thành chunks, render từng chunk, ghép lại
 */
async function tryEdgeTTS(script, outputPath, rateStr, voiceName, onChunkProgress) {
  const rate  = rateStr   || '+0%';
  const voice = voiceName || process.env.VOICE_NAME || config.pipeline.voiceName || 'vi-VN-HoaiMyNeural';
  const edgeTtsPath = config.paths.edgeTts;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const chunks = splitTextIntoChunks(script, 500);
  logger.info(MODULE, `Edge-TTS: voice=${voice} rate=${rate} | ${chunks.length} chunk(s)`);

  if (chunks.length === 1) {
    // Không cần ghép — render thẳng
    const t0 = Date.now();
    const r = await renderEdgeTTSChunk(chunks[0], outputPath, rate, voice, edgeTtsPath);
    if (r && onChunkProgress) onChunkProgress({ chunk: 1, totalChunks: 1, elapsedMs: Date.now() - t0 });
    return r;
  }

  // Render từng chunk
  const chunkPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkOut = outputPath.replace('.mp3', `_part${i}.mp3`);
    const t0 = Date.now();
    let result = await renderEdgeTTSChunk(chunks[i], chunkOut, rate, voice, edgeTtsPath);
    if (!result) {
      // Fallback: dùng Google TTS cho chunk này để không bị mất toàn bộ
      logger.warn(MODULE, `Edge-TTS chunk ${i + 1}/${chunks.length} thất bại — dùng Google TTS cho chunk này`);
      try {
        result = await generateGoogleTTS(chunks[i], chunkOut);
      } catch {}
      if (!result) {
        chunkPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
        logger.warn(MODULE, `Cả Google TTS cũng thất bại — hủy toàn bộ`);
        return null;
      }
    }
    chunkPaths.push(result);
    const elapsedMs = Date.now() - t0;
    logger.info(MODULE, `Edge-TTS chunk ${i + 1}/${chunks.length} OK (${elapsedMs}ms)`);
    if (onChunkProgress) onChunkProgress({ chunk: i + 1, totalChunks: chunks.length, elapsedMs });
  }

  // Ghép tất cả chunks
  const concatResult = await concatMp3WithFfmpeg(chunkPaths, outputPath);
  chunkPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  return concatResult;
}

/**
 * Render giọng đọc bằng ZeroTTS (Local AI)
 */
async function tryZeroTTS(script, outputPath, options = {}) {
  const zerottsUrl = options.zerottsUrl || process.env.ZEROTTS_URL || 'http://localhost:7860';
  const voice = options.voiceName || process.env.ZEROTTS_VOICE || 'maichi';
  const speed = options.speed !== undefined ? options.speed : 1.0;
  const preset = options.preset || '';

  const streamId = options.streamId || null;

  logger.info(MODULE, `ZeroTTS call: voice=${voice} speed=${speed} preset=${preset} stream_id=${streamId || 'none'} -> ${zerottsUrl}`);

  const resp = await axios.post(`${zerottsUrl}/api/tts`, {
    text: script,
    voice,
    speed,
    preset,
    stream_id: streamId,
  }, { timeout: 300000 });

  if (resp.data && resp.data.success && resp.data.outputPath && fs.existsSync(resp.data.outputPath)) {
    const srcWav = resp.data.outputPath;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Chuyển wav sang mp3 bằng ffmpeg
    const ffmpegPath = config.paths.ffmpeg || 'ffmpeg';
    await new Promise((resolve) => {
      execFile(ffmpegPath, ['-y', '-i', srcWav, '-codec:a', 'libmp3lame', '-b:a', '192k', outputPath], (err) => {
        if (!err && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
          resolve(outputPath);
        } else {
          // Nếu ffmpeg lỗi hoặc không có libmp3lame, copy thẳng file wav đổi tên hoặc giữ nguyên
          try {
            fs.copyFileSync(srcWav, outputPath);
            resolve(outputPath);
          } catch (copyErr) {
            resolve(null);
          }
        }
      });
    });

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
      logger.success(MODULE, `✅ ZeroTTS OK: ${path.basename(outputPath)} (${sizeKB} KB)`);
      return outputPath;
    }
  }
  return null;
}

module.exports = { generateVoice };

