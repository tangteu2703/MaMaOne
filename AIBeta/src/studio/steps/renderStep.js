// ==========================================
// STUDIO / STEP 4 — RENDER
// Dựng clip Ken Burns cho từng ảnh rồi ghép voice + nhạc nền + phụ đề + tiêu đề → final.mp4
// ==========================================
const fs = require('fs');
const path = require('path');
const store = require('../jobStore');
const { renderVideo } = require('../videoBuilder');
const { fmtDuration } = require('../mediaUtils');

const STEP = 'render';

async function run(job, signal) {
  const dir = store.jobDir(job);
  const finalFile = path.join(dir, 'final.mp4');
  if (job.steps[STEP].status === 'done' && !job.renderStale && fs.existsSync(finalFile)) return;

  const o = job.options;
  store.beginStep(job, STEP, { total: 0, done: 0, percent: 0, message: 'Chuẩn bị dựng video...' });
  store.jlog(job, 'info', `🎬 Dựng video ${o.aspect} · ${o.fps}fps · ${o.quality === 'fast' ? '720p' : '1080p'} · chuyển cảnh: ${o.transition} · nhạc: ${o.music || 'không'}`);

  const t0 = Date.now();
  const output = await renderVideo(job, {
    dir, signal,
    report: ({ percent, message }) => store.updateStep(job, STEP, { percent, message }),
  });

  job.output = output;
  job.renderStale = false;
  store.endStep(job, STEP, 'done', { message: `${fmtDuration(output.durationSec)} · ${output.sizeMB} MB · ${output.width}x${output.height}${output.withMusic ? ' · có nhạc nền' : ''}` });
  store.jlog(job, 'success', `🎬 Video hoàn tất: ${fmtDuration(output.durationSec)}, ${output.sizeMB} MB (dựng mất ${fmtDuration((Date.now() - t0) / 1000)})`);
  store.saveNow(job);
}

module.exports = { run };
