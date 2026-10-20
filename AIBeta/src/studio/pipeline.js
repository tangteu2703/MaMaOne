// ==========================================
// STUDIO / PIPELINE
// Điều phối: hàng đợi job (chạy lần lượt), chạy 4 bước voice → ảnh → phụ đề → render,
// tạm dừng / tiếp tục / thử lại ảnh lỗi / dựng lại
// ==========================================
const store = require('./jobStore');
const voiceStep = require('./steps/voiceStep');
const planStep = require('./steps/planStep');
const imageStep = require('./steps/imageStep');
const subtitleStep = require('./steps/subtitleStep');
const renderStep = require('./steps/renderStep');

const queue = [];
let active = null;

const cleanRuntime = (job) => { delete job._abort; };

async function runJob(job) {
  job._abort = new AbortController();
  const { signal } = job._abort;
  job.status = 'running';
  job.message = '';
  store.saveNow(job);
  store.jlog(job, 'info', `▶️ Bắt đầu job "${job.title}" (${job.segments.length} đoạn)`);

  try {
    await voiceStep.run(job, signal);
    planStep.run(job);
    await imageStep.run(job, signal);
    await subtitleStep.run(job, signal);
    await renderStep.run(job, signal);
    job.status = 'done';
    job.message = '';
    store.jlog(job, 'success', '✅ Job hoàn tất');
  } catch (e) {
    const step = job.currentStep;
    if (e.paused || signal.aborted) {
      job.status = 'paused';
      job.message = 'Đã tạm dừng — bấm Tiếp tục để chạy tiếp từ chỗ dừng';
      if (step && job.steps[step].status === 'running') job.steps[step].status = 'pending';
      store.jlog(job, 'warn', '⏸️ Job đã tạm dừng');
    } else {
      job.status = 'error';
      job.message = e.message;
      if (step) Object.assign(job.steps[step], { status: 'error', error: e.message, finishedAt: Date.now() });
      store.jlog(job, 'error', `❌ Job lỗi ở bước ${step}: ${e.message}`);
    }
  } finally {
    cleanRuntime(job);
    store.saveNow(job);
  }
}

async function pump() {
  if (active || !queue.length) return;
  active = queue.shift();
  try { await runJob(active); } finally { active = null; setImmediate(pump); }
}

function enqueue(job) {
  if (active === job || queue.includes(job)) return;
  job.status = 'queued';
  job.message = queue.length || active ? 'Đang xếp hàng — chờ job trước hoàn tất' : '';
  store.saveNow(job);
  queue.push(job);
  pump();
}

function pause(job) {
  const qi = queue.indexOf(job);
  if (qi >= 0) {
    queue.splice(qi, 1);
    job.status = 'paused';
    job.message = 'Đã tạm dừng';
    store.saveNow(job);
    return;
  }
  if (active === job && job._abort) job._abort.abort();
}

const isBusy = (job) => active === job || queue.includes(job);

/** Tiếp tục: các bước đã xong sẽ tự được bỏ qua */
function resume(job) {
  if (isBusy(job)) return false;
  enqueue(job);
  return true;
}

/** Thử lại ảnh lỗi: reset trạng thái các cảnh lỗi rồi chạy tiếp */
function retryErrorImages(job) {
  if (isBusy(job) || !job.scenes) return false;
  job.scenes.forEach((s) => { if (s.imageStatus === 'error') { s.imageStatus = 'pending'; s.attempts = 0; s.error = null; } });
  job.steps.images.status = 'pending';
  enqueue(job);
  return true;
}

/** Dựng lại video với tuỳ chọn hiển thị mới (nhạc, tiêu đề, chuyển cảnh...) mà không tạo lại voice/ảnh */
function rerender(job, patch = {}) {
  if (isBusy(job) || job.steps.images.status === 'pending') return false;
  const allowed = ['music', 'musicVolume', 'titlePosition', 'titleIntro', 'transition', 'fps', 'quality'];
  const merged = store.normalizeOptions({ ...job.options, ...Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k))) });
  allowed.forEach((k) => { job.options[k] = merged[k]; });
  job.renderStale = true;
  job.output = null;
  job.steps.subtitle.status = 'pending';
  job.steps.render.status = 'pending';
  enqueue(job);
  return true;
}

function remove(job) {
  pause(job);
  const wait = () => (active === job ? setTimeout(wait, 300) : store.deleteJob(job));
  wait();
}

module.exports = { enqueue, pause, resume, retryErrorImages, rerender, remove, isBusy };
