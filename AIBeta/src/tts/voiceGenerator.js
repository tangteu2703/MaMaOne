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
async function generateVoice(videoId, script, rateStr) {
  const outputPath = path.join(config.paths.audio, `${videoId}.mp3`);
  const rate = rateStr || '+0%';
  const voiceName = process.env.VOICE_NAME || config.pipeline.voiceName || 'vi-VN-HoaiMyNeural';
  const isDefaultVoice = voiceName === 'vi-VN-HoaiMyNeural';
  const isCustomRate  = rate !== '+0%' && rate !== '0%';

  // Xóa cache cũ nếu có rate hoặc voice mới
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
    logger.info(MODULE, `Xóa cache cũ để render lại`);
  }

  logger.info(MODULE, `Render: ${videoId} | voice=${voiceName} | rate=${rate}`);

  // Edge-TTS: luôn ưu tiên khi có voice tùy chỉnh hoặc rate khác 0
  // (Google TTS không hỗ trợ voice chọn + rate)
  if (isCustomRate || !isDefaultVoice) {
    logger.info(MODULE, `Đang dùng Edge-TTS (voice=${voiceName}, rate=${rate})...`);
    const result = await tryEdgeTTS(script, outputPath, rate, voiceName);
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
 * Fallback Edge-TTS
 */
function tryEdgeTTS(script, outputPath, rateStr, voiceName) {
  return new Promise((resolve) => {
    const tempTxt = outputPath.replace('.mp3', '_script.txt');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(tempTxt, script, 'utf8');

    const rate  = rateStr   || '+0%';
    const voice = voiceName || process.env.VOICE_NAME || config.pipeline.voiceName || 'vi-VN-HoaiMyNeural';
    const edgeTtsPath = config.paths.edgeTts;

    // Dùng execFile thay exec để tránh shell parse ký tự đặc biệt (+, %)
    const args = [
      '--voice', voice,
      '--file', tempTxt,
      '--write-media', outputPath,
      '--rate', rate,
    ];

    logger.info(MODULE, `Edge-TTS: voice=${voice} rate=${rate}`);
    execFile(edgeTtsPath, args, { timeout: 120000 }, (error) => {
      try { fs.unlinkSync(tempTxt); } catch {}
      if (!error && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 5000) {
        resolve(outputPath);
      } else {
        if (error) logger.warn(MODULE, `Edge-TTS error: ${error.message.split('\n')[0]}`);
        resolve(null);
      }
    });
  });
}

module.exports = { generateVoice };
