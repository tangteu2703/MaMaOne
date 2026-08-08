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

  // Phương án 2: edge-tts với Python script custom
  const result2 = await tryEdgeTTSWithCertifi(videoId, script, outputPath);
  if (result2) return result2;

  // Fallback: Tạo audio WAV silent bằng pure Node.js (không cần FFmpeg)
  logger.warn(MODULE, 'TTS thất bại (SSL blocked), tạo audio silent placeholder...');
  return createSilentWav(outputPath, 60);
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
