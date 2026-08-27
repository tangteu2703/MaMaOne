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
const { exec } = require('child_process');
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
async function generateVoice(videoId, script) {
  const outputPath = path.join(config.paths.audio, `${videoId}.mp3`);

  // Nếu đã tạo và file hợp lệ (>5KB) thì dùng luôn
  if (fs.existsSync(outputPath)) {
    const size = fs.statSync(outputPath).size;
    if (size > 5 * 1024) {
      const sizeKB = (size / 1024).toFixed(1);
      logger.info(MODULE, `Audio ${videoId}.mp3 đã có sẵn (${sizeKB} KB), dùng luôn`);
      return outputPath;
    } else {
      fs.unlinkSync(outputPath);
    }
  }

  logger.info(MODULE, `Đang tạo giọng đọc AI Tiếng Việt cho video: ${videoId}`);

  // -------------------------------------------------------------
  // PHƯƠNG ÁN 1: google-tts-api (Cực nhanh, giọng đọc Tiếng Việt chuẩn, 100% tiếng THẬT)
  // -------------------------------------------------------------
  try {
    logger.info(MODULE, 'Phương án 1: Tạo giọng đọc qua Google TTS API...');
    const audioPath = await generateGoogleTTS(script, outputPath);
    if (audioPath && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 5000) {
      const sizeKB = (fs.statSync(audioPath).size / 1024).toFixed(1);
      logger.success(MODULE, `✅ Google TTS tạo giọng đọc thành công: ${videoId}.mp3 (${sizeKB} KB)`);
      return audioPath;
    }
  } catch (err1) {
    logger.warn(MODULE, `Phương án 1 (Google TTS) thất bại: ${err1.message}`);
  }

  // Phương án 2: Edge-TTS Python CLI
  try {
    logger.info(MODULE, 'Phương án 2: Thử tạo giọng đọc qua Edge-TTS...');
    const result2 = await tryEdgeTTS(script, outputPath);
    if (result2 && fs.existsSync(result2) && fs.statSync(result2).size > 5000) {
      return result2;
    }
  } catch (err2) {
    logger.warn(MODULE, `Phương án 2 (Edge-TTS) thất bại: ${err2.message}`);
  }

  // Phương án 3: Google Translate TTS Fallback qua Node.js (Bỏ qua SSL cert)
  logger.info(MODULE, 'Phương án 3: Thử fallback sang Google TTS Node.js direct...');
  const result3 = await tryGoogleTTS(videoId, script, outputPath);
  if (result3 && fs.existsSync(result3) && fs.statSync(result3).size > 1000) {
    return result3;
  }

  throw new Error(`Không thể tạo giọng đọc AI Tiếng Việt cho video ${videoId}.`);
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

      const file = fs.createWriteStream(outputPath);
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
  fs.writeFileSync(outputPath, combinedBuffer);
  return outputPath;
}

/**
 * Fallback Edge-TTS
 */
function tryEdgeTTS(script, outputPath) {
  return new Promise((resolve) => {
    const tempTxt = outputPath.replace('.mp3', '_script.txt');
    fs.writeFileSync(tempTxt, script, 'utf8');

    const cmd = [
      `"${config.paths.edgeTts}"`,
      '--voice', config.pipeline.voiceName || 'vi-VN-HoaiMyNeural',
      '--file', `"${tempTxt}"`,
      '--write-media', `"${outputPath}"`,
      '--rate', '+10%',
    ].join(' ');

    exec(cmd, { timeout: 45000 }, (error) => {
      try { fs.unlinkSync(tempTxt); } catch {}
      if (!error && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
        resolve(outputPath);
      } else {
        resolve(null);
      }
    });
  });
}

module.exports = { generateVoice };
