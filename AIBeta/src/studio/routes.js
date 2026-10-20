// ==========================================
// STUDIO / ROUTES  (mount tại /api/studio)
// ==========================================
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');
const config = require('../../config/config');
const deps = require('./deps');
const store = require('./jobStore');
const pipeline = require('./pipeline');
const { parseStory } = require('./storySpec');
const { buildPrompt } = require('./steps/imageStep');

const MUSIC_EXT = /\.(mp3|wav|m4a|ogg|flac|aac)$/i;

const EDGE_VOICES = [
  { name: 'vi-VN-HoaiMyNeural', label: 'Hoài My (nữ)' },
  { name: 'vi-VN-NamMinhNeural', label: 'Nam Minh (nam)' },
];

const PRESETS = [
  { id: '', label: 'Tuỳ chỉnh — dùng thanh tốc độ' },
  { id: 'Kể chuyện', label: '🎙️ Kể chuyện — chậm, trầm ấm' },
  { id: 'Hồi hộp', label: '⚡ Hồi hộp — nhanh, căng thẳng' },
  { id: 'Thanh thản', label: '🌊 Thanh thản — nhẹ nhàng' },
  { id: 'Đọc sách', label: '📚 Đọc sách — rõ ràng, từ tốn' },
  { id: 'Kịch tính', label: '🎧 Kịch tính — biểu cảm' },
];

async function loadZeroTTSVoices() {
  try {
    const r = await axios.get(`${deps.zerottsUrl()}/api/voices`, { timeout: 8000 });
    const list = (r.data && r.data.voices) || [];
    return { online: true, voices: list.map((v) => ({ name: v.name, label: v.label || v.displayName || v.name, hasPreview: !!v.hasPreview })) };
  } catch {
    return { online: false, voices: [{ name: 'maichi', label: 'maichi (mặc định)', hasPreview: false }] };
  }
}

function listMusic() {
  if (!fs.existsSync(config.paths.music)) return [];
  return fs.readdirSync(config.paths.music).filter((f) => MUSIC_EXT.test(f)).map((f) => ({
    name: f,
    sizeMB: Math.round((fs.statSync(path.join(config.paths.music, f)).size / 1048576) * 10) / 10,
    url: `/music/${encodeURIComponent(f)}`,
  }));
}

const fail = (res, code, error) => res.status(code).json({ success: false, error });
const withJob = (handler) => (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return fail(res, 404, 'Job không tồn tại');
  return handler(job, req, res);
};

function createRouter() {
  store.loadAll();
  const router = express.Router();

  // ── Dữ liệu cho form tạo video ──────────────────────────────────────
  router.get('/options', async (req, res) => {
    const zt = await loadZeroTTSVoices();
    res.json({
      success: true,
      styles: [...deps.imageStyles.listStyles(), { id: 'none', label: 'Giữ nguyên prompt (không thêm style)', isDefault: false }],
      defaultStyle: deps.imageStyles.DEFAULT_STYLE,
      zerotts: { online: zt.online, voices: zt.voices },
      edgeVoices: EDGE_VOICES,
      presets: PRESETS,
      music: listMusic(),
      providerOrder: deps.imageProviders.getOrder(),
    });
  });

  router.get('/providers', (req, res) => {
    res.json({ success: true, order: deps.imageProviders.getOrder(), providers: deps.imageProviders.getStatus() });
  });

  // ── Thư viện truyện ─────────────────────────────────────────────────
  router.get('/stories', (req, res) => res.json({ success: true, stories: store.listStories() }));

  // Upload nội dung file (JSON/TXT) dạng text thuần: POST /stories?name=ten.json
  router.post('/stories', express.text({ type: '*/*', limit: '50mb' }), (req, res) => {
    try {
      const fileName = String(req.query.name || 'truyen.json');
      const spec = parseStory(req.body, fileName);
      const record = store.saveStory(spec, fileName);
      res.json({
        success: true,
        story: { id: record.id, title: record.title, fileName, stats: spec.stats },
        warnings: spec.warnings,
      });
    } catch (e) {
      fail(res, 400, e.message);
    }
  });

  router.delete('/stories/:id', (req, res) => { store.deleteStory(req.params.id); res.json({ success: true }); });

  router.get('/music', (req, res) => res.json({ success: true, music: listMusic() }));

  // ── Jobs ────────────────────────────────────────────────────────────
  router.get('/jobs', (req, res) => res.json({ success: true, jobs: store.listJobs().map(store.summary) }));

  router.post('/jobs', (req, res) => {
    const { storyId, options } = req.body || {};
    const story = storyId && store.getStory(storyId);
    if (!story) return fail(res, 400, 'Chưa chọn truyện hợp lệ');
    const job = store.createJob(story.spec, options);
    pipeline.enqueue(job);
    res.json({ success: true, job: store.summary(job) });
  });

  router.get('/jobs/:id', withJob((job, req, res) => {
    res.json({
      success: true,
      job: store.progressView(job, {
        providers: job.status === 'running' ? deps.imageProviders.getStatus() : [],
        providerOrder: deps.imageProviders.getOrder(),
      }),
    });
  }));

  // Prompt từng cảnh: bản gốc trong truyện + bản CUỐI CÙNG thực sự gửi tới model (đã ghép style), kèm ảnh
  router.get('/jobs/:id/scenes', withJob((job, req, res) => {
    const fmt = (s) => s.toFixed(1);
    const scenes = (job.scenes || []).map((s) => {
      const texts = job.segments.filter((g) => g.i >= s.segFrom && g.i <= s.segTo).map((g) => g.text);
      return {
        i: s.i,
        start: s.start,
        dur: s.dur,
        range: `${fmt(s.start)}s → ${fmt(s.start + s.dur)}s`,
        text: texts.join(' '),
        rawPrompt: s.prompt,
        finalPrompt: buildPrompt(job, s),
        status: s.imageStatus,
        provider: s.provider || '',
        model: s.model || '',
        error: s.error || '',
        imageUrl: s.imageFile ? store.fileUrl(job, s.imageFile) : '',
      };
    });
    res.json({ success: true, style: job.options.style, scenes });
  }));

  const action = (name, fn) => router.post(`/jobs/:id/${name}`, withJob((job, req, res) => {
    const ok = fn(job, req);
    if (ok === false) return fail(res, 409, 'Không thực hiện được lúc này (job đang chạy/xếp hàng hoặc chưa đủ điều kiện)');
    res.json({ success: true, job: store.summary(job) });
  }));
  action('pause', (job) => pipeline.pause(job));
  action('resume', (job) => pipeline.resume(job));
  action('retry-images', (job) => pipeline.retryErrorImages(job));
  action('rerender', (job, req) => pipeline.rerender(job, (req.body || {}).options));

  router.delete('/jobs/:id', withJob((job, req, res) => { pipeline.remove(job); res.json({ success: true }); }));

  return router;
}

module.exports = { createRouter };
