// ==========================================
// STUDIO / STEP 2 — IMAGES
// Tạo ảnh lần lượt cho từng cảnh qua scheduler đa nguồn (Cloudflare → Flow → Pollinations).
//  - Log rõ provider + model của từng ảnh
//  - Tất cả provider hết quota/cooldown → chờ rồi thử lại (không bỏ ảnh, không dừng job)
//  - Lỗi thật sự → thử lại có giới hạn, quá số lần thì đánh dấu lỗi và đi tiếp (dùng ảnh thay thế khi dựng)
//  - Ảnh nào đã có file thì bỏ qua (chạy tiếp được)
// ==========================================
const fs = require('fs');
const path = require('path');
const deps = require('../deps');
const store = require('../jobStore');
const { sleep, throwIfAborted, sniffImageExt, pad, fmtDuration } = require('../mediaUtils');

const STEP = 'images';
const MAX_ATTEMPTS = Math.max(1, parseInt(process.env.STUDIO_IMAGE_RETRIES, 10) || 6);
const COOLDOWN_WAIT_MS = 60000;
const ALL_COOLDOWN = /đều đang cooldown|hết quota/i;

const imageSize = (aspect) => (aspect === '9:16' ? [576, 1024] : [1024, 576]);
const hasImage = (job, sc) => sc.imageStatus === 'done' && sc.imageFile && fs.existsSync(path.join(store.jobDir(job), sc.imageFile));

function buildPrompt(job, sc) {
  let prompt = sc.prompt;
  if (job.options.style !== 'none') prompt = deps.imageStyles.applyStyle(prompt, job.options.style);
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 1500);
}

function counts(job) {
  const done = job.scenes.filter((s) => hasImage(job, s)).length;
  const errors = job.scenes.filter((s) => s.imageStatus === 'error').length;
  return { done, errors };
}

/** Tạo 1 ảnh, trả về khi xong hoặc khi hết số lần thử */
async function generateScene(job, sc, signal, selection = 'auto') {
  const dir = path.join(store.jobDir(job), 'images');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `scene_${pad(sc.i)}`);
  const [w, h] = imageSize(job.options.aspect);
  const prompt = buildPrompt(job, sc);
  const total = job.scenes.length;
  let attempt = 0;

  for (;;) {
    throwIfAborted(signal);
    const tmp = `${base}.tmp`;
    try {
      sc.imageStatus = 'running';
      const res = await deps.imageProviders.generateImage(prompt, tmp, w, h, { provider: selection });
      throwIfAborted(signal);
      const ext = sniffImageExt(tmp);
      fs.renameSync(tmp, base + ext);

      Object.assign(sc, {
        imageStatus: 'done', imageFile: `images/scene_${pad(sc.i)}${ext}`, error: null,
        provider: res.provider, model: res.model || '', kind: res.kind, elapsedMs: res.elapsedMs, attempts: attempt + 1,
      });
      job.stats.providers[res.provider] = (job.stats.providers[res.provider] || 0) + 1;
      job.renderStale = true;
      const { done } = counts(job);
      store.jlog(job, 'success', `🖼️ Ảnh ${sc.i + 1}/${total} ✅ ${res.provider} | model: ${res.model || '-'} | ${(res.elapsedMs / 1000).toFixed(1)}s (xong ${done}/${total})`);
      return;
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* không có file tạm */ }
      if (e.paused || signal.aborted) throw e;
      const msg = String(e.message || e).slice(0, 160);

      if (ALL_COOLDOWN.test(msg)) {
        // Không tính là lần thử: chỉ chờ provider hồi quota
        const status = (deps.imageProviders.getStatus() || []).map((p) => `${p.name}${p.cooldownSec ? ` (${Math.ceil(p.cooldownSec / 60)}p)` : ''}`).join(', ');
        store.jlog(job, 'warn', `⏳ Ảnh ${sc.i + 1}: tất cả provider đang cooldown/hết quota → chờ ${COOLDOWN_WAIT_MS / 1000}s rồi thử lại. [${status}]`);
        store.updateStep(job, STEP, { message: 'Tất cả provider đang cooldown/hết quota — đang chờ hồi rồi tự chạy tiếp...' });
        await sleep(COOLDOWN_WAIT_MS, signal);
        continue;
      }

      attempt++;
      sc.attempts = attempt;
      store.jlog(job, 'warn', `⚠️ Ảnh ${sc.i + 1}/${total} lỗi lần ${attempt}/${MAX_ATTEMPTS}: ${msg}`);
      if (attempt >= MAX_ATTEMPTS) {
        sc.imageStatus = 'error';
        sc.error = msg;
        store.jlog(job, 'error', `❌ Ảnh ${sc.i + 1}/${total} bỏ qua sau ${MAX_ATTEMPTS} lần thử (sẽ dùng ảnh thay thế, bấm "Tạo lại ảnh lỗi" để thử lại)`);
        return;
      }
      await sleep(Math.min(60000, 10000 * attempt), signal);
    }
  }
}

async function run(job, signal) {
  const total = job.scenes.length;
  const pending = job.scenes.filter((s) => !hasImage(job, s));
  if (!pending.length) {
    store.endStep(job, STEP, 'done', { done: total, total, message: `Đủ ${total} ảnh` });
    return;
  }

  // Ảnh lỗi từ lần trước sẽ được thử lại
  pending.forEach((s) => { if (s.imageStatus === 'error' || s.imageStatus === 'running') { s.imageStatus = 'pending'; s.attempts = 0; } });
  store.beginStep(job, STEP, { total, done: total - pending.length, percent: (total - pending.length) / total, message: 'Chuẩn bị...' });

  // Nguồn ảnh do người dùng chọn (auto = xoay tua theo ưu tiên). Không khả dụng → quay về auto
  let selection = String(job.options.imageProvider || 'auto');
  if (!deps.imageProviders.hasProvider(selection)) {
    store.jlog(job, 'warn', `⚠️ Nguồn ảnh "${selection}" không khả dụng (chưa cấu hình/bật trong .env) → dùng tự động xoay tua`);
    selection = 'auto';
  }
  const order = deps.imageProviders.getOrder().join(' → ');
  store.jlog(job, 'info', `🖼️ Tạo ${pending.length}/${total} ảnh | style: ${job.options.style} | khung ${job.options.aspect} | nguồn: ${deps.imageProviders.describeSelection(selection)}${selection === 'auto' ? '' : ` | (thứ tự ưu tiên chung: ${order})`}`);

  const t0 = Date.now();
  let produced = 0;
  for (const sc of pending) {
    throwIfAborted(signal);
    await generateScene(job, sc, signal, selection);
    produced++;
    const { done, errors } = counts(job);
    const perImage = (Date.now() - t0) / 1000 / produced;
    const remaining = total - done - errors;
    store.updateStep(job, STEP, {
      done, errors, percent: (done + errors) / total,
      message: `${done}/${total} ảnh${errors ? ` · ${errors} lỗi` : ''} · ${sc.provider || '-'}${sc.model ? ` (${sc.model})` : ''} · còn ~${fmtDuration(perImage * remaining)}`,
    });
    store.save(job);
  }

  const { done, errors } = counts(job);
  store.endStep(job, STEP, errors ? 'warn' : 'done', {
    done, errors, total,
    message: errors ? `${done}/${total} ảnh · ${errors} ảnh lỗi dùng ảnh thay thế` : `Xong ${total} ảnh`,
  });
  const stats = Object.entries(job.stats.providers).map(([k, v]) => `${k}: ${v}`).join(' | ');
  store.jlog(job, errors ? 'warn' : 'success', `🖼️ Hoàn tất ảnh ${done}/${total}${errors ? `, lỗi ${errors}` : ''}. Thống kê: ${stats || '—'}`);
  store.saveNow(job);
}

module.exports = { run, buildPrompt };
