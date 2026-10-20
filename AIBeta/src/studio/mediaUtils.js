// ==========================================
// STUDIO / MEDIA UTILS
// Tiện ích dùng chung: chạy FFmpeg (có huỷ), đo thời lượng, sleep có thể huỷ, nhận dạng ảnh
// ==========================================
const fs = require('fs');
const { spawn } = require('child_process');
const config = require('../../config/config');

const ffmpegBin = () => config.paths.ffmpeg || 'ffmpeg';

/** Lỗi đặc biệt: job bị người dùng tạm dừng */
function pausedError() {
  const e = new Error('PAUSED');
  e.paused = true;
  return e;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw pausedError();
}

/** sleep có thể bị huỷ bởi AbortSignal */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(pausedError());
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(pausedError()); };
    const cleanup = () => signal && signal.removeEventListener('abort', onAbort);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Chạy ffmpeg. onProgress(timeSec) được gọi khi ffmpeg in "time=".
 * @returns {Promise<string>} phần đuôi stderr
 */
function runFfmpeg(args, { cwd, signal, onProgress, label = '' } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(pausedError());
    const child = spawn(ffmpegBin(), ['-hide_banner', '-y', ...args], {
      cwd, signal, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let tail = '';
    child.stderr.on('data', (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-6000);
      if (onProgress) {
        const all = [...s.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
        if (all.length) {
          const m = all[all.length - 1];
          onProgress(Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]));
        }
      }
    });
    child.on('error', (err) => {
      if (err.name === 'AbortError' || (signal && signal.aborted)) reject(pausedError());
      else reject(new Error(`Không chạy được ffmpeg (${ffmpegBin()}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (signal && signal.aborted) return reject(pausedError());
      if (code === 0) return resolve(tail);
      const brief = tail.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
      reject(new Error(`ffmpeg lỗi (code ${code}) ${label}: ${brief}`));
    });
  });
}

/** Đo thời lượng file media bằng `ffmpeg -i` (không cần ffprobe) */
function probeDuration(file) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegBin(), ['-hide_banner', '-i', file], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', () => resolve(0));
    child.on('close', () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3]) : 0);
    });
  });
}

/** Thời lượng chính xác theo mẫu của WAV PCM (đọc header). Trả 0 nếu không đọc được. */
function wavDuration(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(512);
    fs.readSync(fd, head, 0, 512, 0);
    fs.closeSync(fd);
    if (head.toString('ascii', 0, 4) !== 'RIFF') return 0;
    const sampleRate = head.readUInt32LE(24);
    const channels = head.readUInt16LE(22);
    const bits = head.readUInt16LE(34);
    const idx = head.indexOf('data', 12, 'ascii');
    if (idx < 0 || !sampleRate || !channels || !bits) return 0;
    const dataBytes = Math.min(head.readUInt32LE(idx + 4), fs.statSync(file).size - (idx + 8));
    return dataBytes / (sampleRate * channels * (bits / 8));
  } catch {
    return 0;
  }
}

/** Đoán phần mở rộng ảnh từ magic bytes */
function sniffImageExt(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(16);
    fs.readSync(fd, b, 0, 16, 0);
    fs.closeSync(fd);
    if (b[0] === 0xff && b[1] === 0xd8) return '.jpg';
    if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return '.png';
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  } catch { /* bỏ qua */ }
  return '.jpg';
}

const pad = (n, len = 4) => String(n).padStart(len, '0');

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h${pad(m, 2)}m` : (m ? `${m}m${pad(s, 2)}s` : `${s}s`);
}

module.exports = {
  runFfmpeg, probeDuration, wavDuration, sniffImageExt,
  sleep, throwIfAborted, pausedError, pad, fmtDuration,
};
