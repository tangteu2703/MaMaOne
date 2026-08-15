// ==========================================
// MODULE 4: VOICE GENERATOR (TTS)
// Tạo giọng đọc AI Tiếng Việt bằng Edge-TTS (miễn phí)
// ==========================================
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'VoiceGen';

/**
 * Tạo file audio giọng đọc AI từ script
 */
async function generateVoice(videoId, script) {
  const outputPath = path.join(config.paths.audio, `${videoId}.mp3`);

  if (fs.existsSync(outputPath)) {
    logger.info(MODULE, `Audio ${videoId} đã tồn tại, bỏ qua tạo giọng`);
    return outputPath;
  }

  logger.info(MODULE, `Đang tạo giọng đọc AI: ${config.pipeline.voiceName}`);

  // Phương án 1: edge-tts Python với SSL bypass
  const result = await tryEdgeTTS(videoId, script, outputPath);
  if (result) return result;

  // Phương án 3: Google Translate TTS Fallback qua Node.js (Bỏ qua SSL cert)
  logger.info(MODULE, 'Thử fallback sang Google TTS Node.js...');
  const result3 = await tryGoogleTTS(videoId, script, outputPath);
  if (result3) return result3;

  // Fallback: Tạo audio WAV silent bằng pure Node.js
  logger.warn(MODULE, 'TTS hoàn toàn thất bại, tạo audio silent placeholder...');
  return createSilentWav(outputPath, 60);
}

/**
 * Google Translate TTS Node.js Fallback
 */
async function tryGoogleTTS(videoId, script, outputPath) {
  const https = require('https');
  return new Promise((resolve) => {
    try {
      // Cắt script thành các câu dưới 200 ký tự cho Google TTS
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
 * edge-tts với SSL bypass qua biến môi trường Python
 */
async function tryEdgeTTS(videoId, script, outputPath) {
  return new Promise((resolve) => {
    const tempScriptFile = outputPath.replace('.mp3', '_script.txt');
    fs.writeFileSync(tempScriptFile, script, 'utf8');

    const cmd = [
      `"${config.paths.edgeTts}"`,
      '--voice', config.pipeline.voiceName,
      '--file', `"${tempScriptFile}"`,
      '--write-media', `"${outputPath}"`,
      '--rate', '+10%',
    ].join(' ');

    const env = {
      ...process.env,
      PYTHONHTTPSVERIFY: '0',
      REQUESTS_CA_BUNDLE: '',
      SSL_CERT_FILE: '',
    };

    exec(cmd, { timeout: 60000, env }, (error) => {
      try { fs.unlinkSync(tempScriptFile); } catch {}

      if (!error && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        logger.success(MODULE, `Edge-TTS thành công! (${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB)`);
        resolve(outputPath);
      } else {
        logger.warn(MODULE, `Edge-TTS Python thất bại: ${error?.message?.split('\n')[0] || 'SSL blocked'}`);
        resolve(null);
      }
    });
  });
}

/**
 * edge-tts qua Python script để có thể disable SSL verify hoàn toàn
 */
async function tryEdgeTTSWithCertifi(videoId, script, outputPath) {
  return new Promise((resolve) => {
    const tempScript = outputPath.replace('.mp3', '_tts.py');
    const tempTxt = outputPath.replace('.mp3', '_script.txt');

    fs.writeFileSync(tempTxt, script, 'utf8');

    const pyCode = `
import ssl
import asyncio
ssl._create_default_https_context = ssl._create_unverified_context

import edge_tts

async def main():
    text = open(r"${tempTxt.replace(/\\/g, '\\\\')}", encoding='utf-8').read()
    communicate = edge_tts.Communicate(text, "${config.pipeline.voiceName}", rate="+10%")
    await communicate.save(r"${outputPath.replace(/\\/g, '\\\\')}")

asyncio.run(main())
`.trim();

    fs.writeFileSync(tempScript, pyCode, 'utf8');

    const pythonExe = config.paths.ytdlp.replace('Scripts\\yt-dlp.exe', 'python.exe');
    exec(`"${pythonExe}" "${tempScript}"`, { timeout: 60000 }, (error) => {
      try { fs.unlinkSync(tempScript); fs.unlinkSync(tempTxt); } catch {}

      if (!error && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
        logger.success(MODULE, `Edge-TTS Python script thành công!`);
        resolve(outputPath);
      } else {
        logger.warn(MODULE, `Edge-TTS Python script thất bại: ${error?.message?.split('\n')[0] || 'unknown'}`);
        resolve(null);
      }
    });
  });
}

/**
 * Tạo file WAV silent bằng pure Node.js (không cần FFmpeg)
 */
function createSilentWav(outputPath, durationSeconds = 60) {
  const wavPath = outputPath.replace('.mp3', '.wav');
  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);

  const buffer = Buffer.alloc(44 + dataSize, 0);

  // RIFF chunk
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');

  // fmt chunk
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, 28);
  buffer.writeUInt16LE(numChannels * bitsPerSample / 8, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  fs.writeFileSync(wavPath, buffer);
  fs.renameSync(wavPath, outputPath);

  logger.warn(MODULE, `⚠️ Dùng silent WAV placeholder (${durationSeconds}s) — TTS bị chặn SSL!`);
  return outputPath;
}

module.exports = { generateVoice };
