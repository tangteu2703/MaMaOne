// ==========================================
// STUDIO / STEP 1 — VOICE
// Tạo giọng đọc TỪNG ĐOẠN (ZeroTTS hoặc Edge-TTS) → chuẩn hoá WAV → đo thời lượng chính xác
// Đoạn nào đã có file thì bỏ qua (chạy tiếp được sau khi dừng / restart)
// ==========================================
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const deps = require('../deps');
const store = require('../jobStore');
const { runFfmpeg, wavDuration, probeDuration, sleep, throwIfAborted, pausedError, pad, fmtDuration } = require('../mediaUtils');

const STEP = 'voice';
const MAX_ATTEMPTS = 3;

const cleanForTTS = (t) => String(t || '').replace(/[*_#~`>|]+/g, ' ').replace(/\s+/g, ' ').trim();

async function zerottsOnline() {
  try {
    const r = await axios.get(`${deps.zerottsUrl()}/api/tts-status`, { timeout: 2500 });
    return !!(r.data && (r.data.ok || r.data.status === 'ok'));
  } catch { return false; }
}

/** Đảm bảo ZeroTTS online; nếu chưa thì nhờ server khởi động rồi chờ tối đa 3 phút */
async function ensureZeroTTS(job, signal) {
  if (await zerottsOnline()) return;
  store.jlog(job, 'warn', `ZeroTTS chưa online tại ${deps.zerottsUrl()} — đang thử khởi động...`);
  try { await axios.post(`http://127.0.0.1:${deps.port}/api/zerotts/start`, {}, { timeout: 15000 }); } catch { /* bỏ qua */ }
  for (let i = 0; i < 60; i++) {
    store.updateStep(job, STEP, { message: `Đang chờ ZeroTTS khởi động... (${i * 3}s)` });
    await sleep(3000, signal);
    if (await zerottsOnline()) { store.jlog(job, 'success', 'ZeroTTS đã online'); return; }
  }
  throw new Error(`ZeroTTS không online tại ${deps.zerottsUrl()}. Hãy bật ZeroTTS hoặc chọn engine Edge-TTS.`);
}

/** Gọi engine → trả đường dẫn file audio thô */
async function synthRaw(job, seg, rawBase, signal) {
  const o = job.options;
  const text = cleanForTTS(seg.text);
  if (o.engine === 'zerotts') {
    const body = { text, voice: o.voiceName || 'maichi' };
    if (o.preset) body.preset = o.preset; else body.speed = o.speed;
    let res;
    try {
      res = await axios.post(`${deps.zerottsUrl()}/api/tts`, body, { timeout: 180000, signal });
    } catch (e) {
      if (signal.aborted) throw pausedError();
      throw new Error(e.response?.data?.error || e.message);
    }
    if (!res.data?.success || !res.data.outputPath || !fs.existsSync(res.data.outputPath)) {
      throw new Error(res.data?.error || 'ZeroTTS không trả về file audio');
    }
    const dest = `${rawBase}.wav`;
    fs.copyFileSync(res.data.outputPath, dest);
    return dest;
  }

  const { generateVoice } = require('../../tts/voiceGenerator');
  const pct = Math.round((o.speed - 1) * 100);
  const rate = `${pct >= 0 ? '+' : '-'}${Math.abs(pct)}%`;
  const produced = await generateVoice(`studio_${job.id}_${pad(seg.i)}`, text, rate, null, {
    engine: 'edgetts', voiceName: o.voiceName || 'vi-VN-HoaiMyNeural',
  });
  if (!produced || !fs.existsSync(produced)) throw new Error('Edge-TTS không tạo được audio');
  const dest = `${rawBase}.mp3`;
  fs.copyFileSync(produced, dest);
  try { fs.unlinkSync(produced); } catch { /* bỏ qua */ }
  return dest;
}

async function synthSegment(job, seg, dir, signal) {
  const rawBase = path.join(dir, `raw_${pad(seg.i)}`);
  const rel = `voice/seg_${pad(seg.i)}.wav`;
  const out = path.join(path.dirname(dir), rel);
  const raw = await synthRaw(job, seg, rawBase, signal);
  const gap = job.options.gapSec;
  const filter = gap > 0 ? `aresample=44100,apad=pad_dur=${gap}` : 'aresample=44100';
  await runFfmpeg(['-i', raw, '-af', filter, '-ac', '1', '-c:a', 'pcm_s16le', out], { signal, label: 'chuẩn hoá voice' });
  try { fs.unlinkSync(raw); } catch { /* bỏ qua */ }
  seg.voiceFile = rel;
  seg.voiceDur = wavDuration(out) || await probeDuration(out);
  if (!seg.voiceDur) throw new Error('Không đo được thời lượng voice');
}

const hasVoice = (job, seg) => seg.voiceFile && seg.voiceDur && fs.existsSync(path.join(store.jobDir(job), seg.voiceFile));

async function run(job, signal) {
  const total = job.segments.length;
  if (job.segments.every((s) => hasVoice(job, s))) {
    store.endStep(job, STEP, 'done', { done: total, total, message: `Đủ ${total} đoạn voice` });
    return;
  }

  store.beginStep(job, STEP, { total, done: job.segments.filter((s) => hasVoice(job, s)).length, percent: 0, message: 'Chuẩn bị...' });
  const dir = path.join(store.jobDir(job), 'voice');
  fs.mkdirSync(dir, { recursive: true });
  if (job.options.engine === 'zerotts') await ensureZeroTTS(job, signal);

  const o = job.options;
  const label = `${o.engine === 'zerotts' ? 'ZeroTTS' : 'Edge-TTS'} · ${o.voiceName || 'mặc định'}${o.preset ? ` · ${o.preset}` : ''}`;
  store.jlog(job, 'info', `🎙️ Bắt đầu tạo voice ${total} đoạn bằng ${label}`);

  let done = job.steps[STEP].done;
  const t0 = Date.now();
  const startDone = done;
  for (const seg of job.segments) {
    throwIfAborted(signal);
    if (hasVoice(job, seg)) continue;

    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try { await synthSegment(job, seg, dir, signal); lastErr = null; break; } catch (e) {
        if (e.paused) throw e;
        lastErr = e;
        store.jlog(job, 'warn', `Voice đoạn ${seg.i + 1} lỗi (lần ${attempt}/${MAX_ATTEMPTS}): ${e.message}`);
        if (attempt < MAX_ATTEMPTS) await sleep(3000 * attempt, signal);
      }
    }
    if (lastErr) throw new Error(`Voice đoạn ${seg.i + 1} thất bại: ${lastErr.message}`);

    done++;
    const perSeg = (Date.now() - t0) / 1000 / Math.max(1, done - startDone);
    store.updateStep(job, STEP, {
      done, percent: done / total,
      message: `Đoạn ${done}/${total} · ${label} · ${seg.voiceDur.toFixed(1)}s · còn ~${fmtDuration(perSeg * (total - done))}`,
    });
    if (done % 25 === 0) store.jlog(job, 'info', `🎙️ Voice ${done}/${total}`);
  }

  const totalSec = job.segments.reduce((n, s) => n + s.voiceDur, 0);
  store.endStep(job, STEP, 'done', { done: total, total, message: `Xong ${total} đoạn · tổng ${fmtDuration(totalSec)} · ${label}` });
  store.jlog(job, 'success', `🎙️ Voice hoàn tất: ${total} đoạn, tổng ${fmtDuration(totalSec)}`);
}

module.exports = { run };
