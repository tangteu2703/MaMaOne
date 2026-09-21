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
    logger.info(MODULE, `Đang kết nối ZeroTTS AI engine (voice=${voiceName} | speed=${options.speed} | preset=${options.preset || '-'})...`);
    try {
      const ztResult = await tryZeroTTS(script, outputPath, { ...options, voiceName }, onChunkProgress);
      if (ztResult && fs.existsSync(ztResult) && fs.statSync(ztResult).size > 1000) {
        if (onChunkProgress) onChunkProgress({ chunk: 1, totalChunks: 1, elapsedMs: 1000 });
        return ztResult;
      }
      logger.warn(MODULE, `ZeroTTS trả về rỗng hoặc file không tồn tại — fallback Edge-TTS`);
    } catch (err) {
      logger.warn(MODULE, `ZeroTTS thất bại: ${err.message} — fallback Edge-TTS`);
    }
    // Bug fix: ZeroTTS voice names (giahuy, maichi...) không hợp lệ với Edge-TTS
    // → dùng voice mặc định Edge-TTS thay vì pass ZeroTTS voice name
    const fallbackEdgeVoice = 'vi-VN-HoaiMyNeural';
    logger.info(MODULE, `Fallback Edge-TTS với voice mặc định: ${fallbackEdgeVoice}`);
    const edgeResult = await tryEdgeTTS(script, outputPath, rate, fallbackEdgeVoice, onChunkProgress);
    if (edgeResult && fs.existsSync(edgeResult) && fs.statSync(edgeResult).size > 5000) {
      logger.success(MODULE, `✅ Fallback Edge-TTS OK (${fallbackEdgeVoice})`);
      return edgeResult;
    }
    // Fallback cuối cùng: Google TTS
    logger.warn(MODULE, `Edge-TTS cũng thất bại — fallback Google TTS`);
    return tryGoogleTTS(videoId, script, outputPath);
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
 * Render giọng đọc bằng ZeroTTS (Local AI) — CHUNK mode để tránh timeout
 * Mỗi chunk ~300 từ, timeout riêng 180s/chunk, concat WAV rồi apply speed.
 */
async function tryZeroTTS(script, outputPath, options = {}, onChunkProgress) {
  const zerottsUrl = options.zerottsUrl || process.env.ZEROTTS_URL || 'http://localhost:7860';
  const voice = options.voiceName || process.env.ZEROTTS_VOICE || 'maichi';
  const speed = options.speed !== undefined ? parseFloat(options.speed) : 1.0;
  const preset = options.preset || '';
  const streamId = options.streamId || null; // chỉ dùng cho chunk đầu
  const ffmpegPath = config.paths.ffmpeg || 'ffmpeg';

  // ── Chia text thành chunks ~300 từ theo ranh giới câu ──────────────────────
  const ZT_WORDS_PER_CHUNK = 300;
  const chunks = splitTextIntoChunks(script, ZT_WORDS_PER_CHUNK);
  logger.info(MODULE, `ZeroTTS: voice=${voice} | speed=${speed} | preset=${preset} | ${chunks.length} chunk(s) x ~${ZT_WORDS_PER_CHUNK}từ | stream_id=${streamId || 'none'}`);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const wavPaths = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkWav = outputPath.replace('.mp3', `_zt_chunk${i}.wav`);
    const payload = {
      text: chunks[i],
      voice,
      speed: 1.0,       // generate tốc độ gốc, apply_speed sau khi ghép
      preset,
      stream_id: i === 0 ? streamId : null,  // live stream chỉ chunk đầu
    };
    const t0 = Date.now();
    logger.info(MODULE, `  ZeroTTS chunk ${i+1}/${chunks.length} (${chunks[i].split(' ').length} từ)...`);

    try {
      const resp = await axios.post(`${zerottsUrl}/api/tts`, payload, { timeout: 180000 });
      const elapsed = Date.now() - t0;
      logger.info(MODULE, `  Chunk ${i+1} response: success=${resp.data?.success} | durationSec=${resp.data?.durationSec} | ${elapsed}ms`);

      if (!resp.data?.success || !resp.data?.outputPath) {
        throw new Error(`ZeroTTS chunk ${i+1} failed: success=false`);
      }
      const srcWav = resp.data.outputPath;
      if (!fs.existsSync(srcWav)) {
        throw new Error(`outputPath không tồn tại: ${srcWav}`);
      }
      // Copy WAV chunk về thư mục output
      fs.copyFileSync(srcWav, chunkWav);
      wavPaths.push(chunkWav);
      if (onChunkProgress) onChunkProgress({ chunk: i + 1, totalChunks: chunks.length, elapsedMs: elapsed });
    } catch (err) {
      logger.warn(MODULE, `  ZeroTTS chunk ${i+1} thất bại: ${err.message}`);
      // Dọn dẹp các chunk đã tạo
      wavPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
      throw err; // Propagate để generateVoice fallback Edge-TTS
    }
  }

  // ── Ghép tất cả WAV chunks thành 1 file ─────────────────────────────────
  let mergedWav;
  if (wavPaths.length === 1) {
    mergedWav = wavPaths[0];
  } else {
    mergedWav = outputPath.replace('.mp3', '_zt_merged.wav');
    const listFile = mergedWav + '_list.txt';
    const listContent = wavPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listFile, listContent, 'utf8');
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', mergedWav],
        { timeout: 120000 }, (err) => {
          try { fs.unlinkSync(listFile); } catch {}
          if (!err && fs.existsSync(mergedWav)) resolve();
          else reject(new Error('ffmpeg concat WAV thất bại'));
        });
    });
    wavPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  }

  // ── Apply speed vào WAV đã ghép ───────────────────────────────────────────
  if (Math.abs(speed - 1.0) >= 0.01) {
    logger.info(MODULE, `  Áp dụng speed x${speed} vào WAV đã ghép...`);
    const atempo = speed > 2.0
      ? `atempo=2.0,atempo=${(speed/2.0).toFixed(3)}`
      : `atempo=${speed.toFixed(3)}`;
    const speedWav = mergedWav.replace('.wav', '_speed.wav');
    await new Promise((resolve, reject) => {
      execFile(ffmpegPath, ['-y', '-i', mergedWav, '-af', atempo, speedWav],
        { timeout: 120000 }, (err) => {
          if (!err && fs.existsSync(speedWav)) {
            try { fs.unlinkSync(mergedWav); } catch {}
            mergedWav = speedWav;
            resolve();
          } else {
            logger.warn(MODULE, `  apply_speed ffmpeg lỗi, giữ nguyên speed 1x`);
            resolve(); // không reject, vẫn có audio 1x
          }
        });
    });
  }

  // ── Convert WAV sang MP3 ────────────────────────────────────────────────────
  await new Promise((resolve) => {
    execFile(ffmpegPath, ['-y', '-i', mergedWav, '-codec:a', 'libmp3lame', '-b:a', '192k', outputPath],
      { timeout: 120000 }, (err) => {
        if (!err && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
          resolve();
        } else {
          try { fs.copyFileSync(mergedWav, outputPath); } catch {}
          resolve();
        }
      });
  });
  try { fs.unlinkSync(mergedWav); } catch {}

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
    const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
    logger.success(MODULE, `✅ ZeroTTS OK: ${path.basename(outputPath)} (${sizeKB} KB) | ${chunks.length} chunks | speed x${speed}`);
    return outputPath;
  }
  return null;
}

module.exports = { generateVoice };

