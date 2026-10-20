// ==========================================
// STUDIO / JOB STORE
// Lưu trữ job (RAM + job.json), thư viện truyện, tuỳ chọn mặc định, view trả về cho giao diện
// ==========================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../logger');

const ROOT = path.join(__dirname, '..', '..', 'workspace', 'studio');
const JOBS_DIR = path.join(ROOT, 'jobs');
const STORIES_DIR = path.join(ROOT, 'stories');
[JOBS_DIR, STORIES_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const STEP_ORDER = ['voice', 'images', 'subtitle', 'render'];
const jobs = new Map();

// ── Tuỳ chọn ────────────────────────────────────────────────────────────
const clamp = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

function normalizeOptions(o = {}) {
  const minScene = clamp(o.minSceneSec, 3, 1.5, 10);
  return {
    aspect: o.aspect === '9:16' ? '9:16' : '16:9',
    style: String(o.style || 'anime'),
    engine: o.engine === 'edgetts' ? 'edgetts' : 'zerotts',
    voiceName: String(o.voiceName || '').slice(0, 80),
    preset: String(o.preset || '').slice(0, 40),
    speed: clamp(o.speed, 1, 0.6, 1.8),
    music: o.music ? path.basename(String(o.music)) : '',
    musicVolume: clamp(o.musicVolume, 0.18, 0, 1),
    minSceneSec: minScene,
    maxSceneSec: Math.max(clamp(o.maxSceneSec, 6, 3, 15), minScene + 1),
    mergeShort: o.mergeShort !== false,
    transition: o.transition === 'fade' ? 'fade' : 'cut',
    fps: [24, 25, 30].includes(Number(o.fps)) ? Number(o.fps) : 25,
    quality: o.quality === 'fast' ? 'fast' : 'normal',
    titlePosition: ['top', 'bottom', 'none'].includes(o.titlePosition) ? o.titlePosition : 'top',
    titleIntro: o.titleIntro !== false,
    gapSec: clamp(o.gapSec, 0.25, 0, 1.5),
  };
}

// ── Job ─────────────────────────────────────────────────────────────────
const newStep = () => ({ status: 'pending', done: 0, total: 0, percent: 0, message: '', error: null, startedAt: null, finishedAt: null });

const jobDir = (job) => path.join(JOBS_DIR, job.id);

function createJob(spec, options) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const job = {
    id: `${stamp}_${crypto.randomBytes(2).toString('hex')}`,
    title: spec.title,
    status: 'queued',
    message: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    options: normalizeOptions(options),
    steps: Object.fromEntries(STEP_ORDER.map((s) => [s, newStep()])),
    segments: spec.segments.map((s, i) => {
      const withGlobal = (p) => (spec.globalPrompt ? `${spec.globalPrompt}, ${p}` : p);
      return {
        i,
        text: s.text,
        imagePrompt: withGlobal(s.imagePrompt),
        shots: (s.shots && s.shots.length ? s.shots : [s.imagePrompt]).map(withGlobal),
      };
    }),
    scenes: null,
    totalSec: 0,
    output: null,
    renderStale: true,
    stats: { providers: {} },
    log: [],
  };
  fs.mkdirSync(jobDir(job), { recursive: true });
  jobs.set(job.id, job);
  saveNow(job);
  return job;
}

let saveTimers = new Map();
function saveNow(job) {
  clearTimeout(saveTimers.get(job.id));
  saveTimers.delete(job.id);
  job.updatedAt = Date.now();
  try {
    const file = path.join(jobDir(job), 'job.json');
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(job, (k, v) => (k.startsWith('_') ? undefined : v)));
    fs.renameSync(tmp, file);
  } catch (e) {
    logger.warn('Studio', `Không lưu được job ${job.id}: ${e.message}`);
  }
}

/** Lưu có trễ để không ghi đĩa liên tục khi tiến độ cập nhật dày */
function save(job) {
  if (saveTimers.has(job.id)) return;
  saveTimers.set(job.id, setTimeout(() => saveNow(job), 1000));
}

function loadAll() {
  for (const id of fs.readdirSync(JOBS_DIR)) {
    const file = path.join(JOBS_DIR, id, 'job.json');
    if (!fs.existsSync(file)) continue;
    try {
      const job = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'paused';
        job.message = 'Bị gián đoạn do server khởi động lại — bấm Tiếp tục để chạy tiếp từ chỗ dừng';
        STEP_ORDER.forEach((s) => { if (job.steps[s].status === 'running') job.steps[s].status = 'pending'; });
      }
      jobs.set(job.id, job);
    } catch (e) {
      logger.warn('Studio', `Bỏ qua job lỗi ${id}: ${e.message}`);
    }
  }
}

const getJob = (id) => jobs.get(id) || null;
const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);

function deleteJob(job) {
  jobs.delete(job.id);
  clearTimeout(saveTimers.get(job.id));
  fs.rmSync(jobDir(job), { recursive: true, force: true });
}

// ── Log & step helpers ──────────────────────────────────────────────────
function jlog(job, level, message) {
  job.log.push({ t: Date.now(), l: level, m: message });
  if (job.log.length > 500) job.log.shift();
  (logger[level] || logger.info)('Studio', `[${job.id}] ${message}`);
  save(job);
}

function beginStep(job, name, patch = {}) {
  Object.assign(job.steps[name], { status: 'running', error: null, startedAt: Date.now(), finishedAt: null }, patch);
  job.currentStep = name;
  save(job);
}

function updateStep(job, name, patch) {
  Object.assign(job.steps[name], patch);
  save(job);
}

function endStep(job, name, status = 'done', patch = {}) {
  Object.assign(job.steps[name], { status, percent: 1, finishedAt: Date.now() }, patch);
  save(job);
}

// ── Views ───────────────────────────────────────────────────────────────
const fileUrl = (job, rel) => `/studio-files/${job.id}/${rel}`;
const STATUS_CHAR = { pending: 'p', running: 'r', done: 'd', error: 'e' };

function summary(job) {
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    options: job.options,
    steps: job.steps,
    counts: { segments: job.segments.length, scenes: job.scenes ? job.scenes.length : 0 },
    totalSec: job.totalSec,
    output: job.output ? { ...job.output, url: fileUrl(job, job.output.file), path: path.resolve(jobDir(job), job.output.file) } : null,
  };
}

function progressView(job, extra = {}) {
  const scenes = job.scenes || [];
  const recentImages = scenes.filter((s) => s.imageStatus === 'done' && s.imageFile).slice(-14).reverse()
    .map((s) => ({ i: s.i, url: fileUrl(job, s.imageFile), provider: s.provider, model: s.model }));
  return {
    ...summary(job),
    scenesBrief: scenes.map((s) => STATUS_CHAR[s.imageStatus] || 'p').join(''),
    recentImages,
    stats: job.stats,
    log: job.log.slice(-80),
    ...extra,
  };
}

// ── Thư viện truyện ─────────────────────────────────────────────────────
const slug = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'truyen';

function saveStory(spec, fileName) {
  const id = `${slug(spec.title)}-${crypto.randomBytes(2).toString('hex')}`;
  const record = { id, title: spec.title, fileName, createdAt: Date.now(), stats: spec.stats, spec };
  fs.writeFileSync(path.join(STORIES_DIR, `${id}.json`), JSON.stringify(record));
  return record;
}

function getStory(id) {
  const file = path.join(STORIES_DIR, `${path.basename(String(id))}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function listStories() {
  return fs.readdirSync(STORIES_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(STORIES_DIR, f), 'utf8'));
      return { id: r.id, title: r.title, fileName: r.fileName, createdAt: r.createdAt, stats: r.stats };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

function deleteStory(id) {
  fs.rmSync(path.join(STORIES_DIR, `${path.basename(String(id))}.json`), { force: true });
}

module.exports = {
  ROOT, JOBS_DIR, STEP_ORDER,
  normalizeOptions, createJob, loadAll, getJob, listJobs, deleteJob, jobDir, save, saveNow,
  jlog, beginStep, updateStep, endStep,
  summary, progressView, fileUrl,
  saveStory, getStory, listStories, deleteStory,
};
