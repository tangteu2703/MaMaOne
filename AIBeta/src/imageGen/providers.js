/**
 * Image Provider Scheduler
 *  - Tier 1: Cloudflare Workers AI (FLUX-schnell), nhiều tài khoản xoay tua (CF_ACCOUNT_ID[_2..], CF_API_TOKEN[_2..]).
 *            Free ~10.000 neurons/ngày/tài khoản (~100 ảnh). Luôn ưu tiên khi còn quota.
 *  - Tier 2: khi mọi Cloudflare hết quota → chạy SONG SONG Pollinations (giới hạn ~65s/ảnh)
 *            + Google Flow (nhiều model xoay vòng). Mỗi request được giao cho provider rảnh/sẵn sàng sớm nhất
 *            nên chu kỳ không bị kẹt ở 1 provider.
 */
const fs = require('fs');
const axios = require('axios');
const https = require('https');
const logger = require('../logger');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const MODULE = 'ImgProvider';

let downloadImageToLocal = null; // inject từ server.js
function init(deps) { downloadImageToLocal = deps.downloadImageToLocal; }

// ── Khai báo providers ────────────────────────────────────────────────
function buildProviders() {
  const list = [];

  // Cloudflare: nhiều tài khoản
  ['', '_2', '_3', '_4', '_5', '_6'].forEach((sfx, i) => {
    const accountId = process.env['CF_ACCOUNT_ID' + sfx];
    const token = process.env['CF_API_TOKEN' + sfx];
    if (accountId && token) {
      list.push({
        id: `cloudflare_${i + 1}`, kind: 'cloudflare', tier: 1,
        name: `Cloudflare FLUX-schnell #${i + 1}`,
        accountId, token, rateDelayMs: 1000, cooldownMs: 60000,
      });
    }
  });

  // Pollinations (free không cần API key, bỏ enhance=true để không bị 402)
  list.push({ id: 'pollinations_flux', kind: 'pollinations', model: 'flux', tier: 2,
    name: 'Pollinations (flux)', rateDelayMs: 30000, cooldownMs: 60000 });
  list.push({ id: 'pollinations_realism', kind: 'pollinations', model: 'flux-realism', tier: 2,
    name: 'Pollinations (flux-realism)', rateDelayMs: 30000, cooldownMs: 60000 });
  list.push({ id: 'pollinations_turbo', kind: 'pollinations', model: 'turbo', tier: 2,
    name: 'Pollinations (turbo)', rateDelayMs: 30000, cooldownMs: 60000 });

  // Google Flow: mỗi model là 1 provider, dùng chung 1 tab trình duyệt (group 'flow')
  if (String(process.env.FLOW_ENABLED || '').toLowerCase() === 'true') {
    const models = (process.env.FLOW_MODELS || 'Nano Banana Pro,Nano Banana 2.1,Nano Banana 2 Lite')
      .split(',').map(s => s.trim()).filter(Boolean);
    models.forEach(m => list.push({
      id: 'flow_' + m.toLowerCase().replace(/[^a-z0-9]+/g, '_'), kind: 'flow', group: 'flow', tier: 2,
      model: m, name: `Google Flow (${m})`, rateDelayMs: 0, cooldownMs: 120000,
    }));
  }

  list.forEach(p => {
    p.enabled = true; p.failCount = 0; p.lastFailed = 0; p.lastUsedMs = 0; p.busy = false;
    p.baseCooldownMs = p.cooldownMs; p.okCount = 0;
  });
  return list;
}

let providers = buildProviders();
const groupBusy = {};
const FLOW_CONCURRENCY = Math.max(1, parseInt(process.env.FLOW_CONCURRENCY) || 1);

function reload() { providers = buildProviders(); logStatus(); }

function inCooldown(p, now = Date.now()) { return now < p.lastFailed + p.cooldownMs; }
function isBusy(p) {
  if (p.busy) return true;
  return !!(p.group && (groupBusy[p.group] || 0) >= (p.group === 'flow' ? FLOW_CONCURRENCY : 1));
}
function readyAt(p) { return p.lastUsedMs + p.rateDelayMs; }

function setBusy(p, v) {
  p.busy = v;
  if (p.group) groupBusy[p.group] = Math.max(0, (groupBusy[p.group] || 0) + (v ? 1 : -1));
}

function logStatus() {
  const now = Date.now();
  providers.forEach(p => {
    const st = inCooldown(p, now) ? `🔴 cooldown ${Math.round((p.lastFailed + p.cooldownMs - now) / 1000)}s` : '🟢 sẵn sàng';
    logger.info(MODULE, `[T${p.tier}] ${p.name}: ${st} | ok=${p.okCount} fail=${p.failCount}`);
  });
}

function getStatus() {
  const now = Date.now();
  return providers.map(p => ({
    id: p.id, name: p.name, tier: p.tier, busy: p.busy,
    cooldownSec: inCooldown(p, now) ? Math.round((p.lastFailed + p.cooldownMs - now) / 1000) : 0,
    ok: p.okCount, fails: p.failCount,
  }));
}

// ── Chọn provider cho 1 request (đặt chỗ ngay để request khác không giành) ──
async function acquire() {
  const MAX_WAIT_COOLDOWN = 3 * 60 * 1000;
  for (;;) {
    const now = Date.now();
    const enabled = providers.filter(p => p.enabled);
    const usable = enabled.filter(p => !inCooldown(p, now));

    if (!usable.length) {
      const soonest = Math.min(...enabled.map(p => p.lastFailed + p.cooldownMs));
      if (!enabled.length || soonest - now > MAX_WAIT_COOLDOWN) {
        throw new Error('Tất cả image providers đều đang cooldown/hết quota. Thử lại sau.');
      }
      await sleep(Math.min(5000, Math.max(200, soonest - now + 100)));
      continue;
    }

    // Còn Cloudflare dùng được → chỉ dùng Cloudflare (chờ nếu đang bận), không tràn sang tier 2
    const tier1 = usable.filter(p => p.tier === 1);
    const pool = tier1.length ? tier1 : usable.filter(p => p.tier === 2);
    const free = pool.filter(p => !isBusy(p)).sort((a, b) => readyAt(a) - readyAt(b) || a.tier - b.tier);
    const best = free[0];

    if (best) {
      const wait = Math.max(0, readyAt(best) - now);
      // Nếu phải chờ lâu mà có provider khác đang bận (sắp rảnh) → đợi thêm thay vì khóa chỗ sớm
      const othersBusy = pool.some(p => isBusy(p));
      if (wait > 3000 && othersBusy) { await sleep(500); continue; }
      setBusy(best, true);
      if (wait > 0) {
        logger.info(MODULE, `⏳ [${best.name}] chờ ${Math.round(wait / 1000)}s (rate limit)...`);
        await sleep(wait);
      }
      return best;
    }
    await sleep(300); // mọi provider trong pool đang bận
  }
}

// ── Gọi từng loại provider ────────────────────────────────────────────
async function runCloudflare(p, prompt) {
  const model = '@cf/black-forest-labs/flux-1-schnell';
  const url = `https://api.cloudflare.com/client/v4/accounts/${p.accountId}/ai/run/${model}`;
  let response;
  try {
    response = await axios.post(url, { prompt }, {
      headers: { Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' },
      responseType: 'json', timeout: 90000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }), // mạng công ty
    });
  } catch (err) {
    const body = err.response && err.response.data;
    const bodyText = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    if (err.response && err.response.status === 429) {
      err.isDailyQuota = /4006|daily|neurons|free allocation/i.test(bodyText);
      err.cfBody = bodyText.slice(0, 200);
    }
    throw err;
  }
  const b64 = response.data && response.data.result && response.data.result.image;
  if (!b64) throw new Error('Cloudflare: không có image trong response: ' + JSON.stringify(response.data).slice(0, 200));
  return Buffer.from(b64, 'base64');
}

function pollinationsUrl(prompt, width, height, model) {
  const seed = Math.floor(Math.random() * 900000) + 100000;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&seed=${seed}&model=${model}&nologo=true`;
}

async function run(p, prompt, localPath, width, height) {
  const path = require('path');
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (p.kind === 'cloudflare') {
    fs.writeFileSync(localPath, await runCloudflare(p, prompt));
  } else if (p.kind === 'pollinations') {
    // retries=1: không tự ngủ 65s trong hàm download — việc chờ do scheduler (cooldown) quyết định
    await downloadImageToLocal(pollinationsUrl(prompt, width, height, p.model), localPath, 1);
  } else if (p.kind === 'flow') {
    const { generateImageFlow } = require('./flowClient');
    await generateImageFlow({ prompt, model: p.model, width, height, localPath });
  } else {
    throw new Error('Provider không hỗ trợ: ' + p.kind);
  }
}

// ── Phân loại lỗi → cooldown ──────────────────────────────────────────
function classifyFailure(p, e) {
  const status = e.response && e.response.status;
  let reason = (e.message || '').slice(0, 100);
  let cooldown;

  if (p.kind === 'cloudflare' && status === 429) {
    if (e.isDailyQuota) {
      // reset 00:00 UTC = 07:00 sáng giờ VN
      const n = new Date();
      cooldown = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 1, 0) - n.getTime();
      reason = 'HẾT QUOTA NGÀY Cloudflare (10k neurons) — reset 07:00 sáng VN';
    } else {
      cooldown = Math.min(60000 * Math.pow(2, Math.min(p.failCount, 5)), 30 * 60000);
      reason = `429 (${e.cfBody || 'no body'})`.slice(0, 140);
    }
  } else if (p.kind === 'pollinations') {
    if (e.message === 'HTTP 402') { cooldown = 10 * 60000; reason = 'HTTP 402 (Pollinations yêu cầu API key/credit cho model này)'; }
    else if (e.isRateLimit) { cooldown = 65000; }
  } else if (p.kind === 'flow') {
    if (e.flowNotConnected) cooldown = 5 * 60000;
    else if (e.flowQuota) cooldown = 30 * 60000;
    else cooldown = 2 * 60000;
  }
  return { reason, cooldown };
}

function markFailed(p, e) {
  const { reason, cooldown } = classifyFailure(p, e);
  p.failCount++;
  p.lastFailed = Date.now();
  p.cooldownMs = cooldown || p.baseCooldownMs;
  const cd = p.cooldownMs >= 120000 ? `${Math.round(p.cooldownMs / 60000)} phút` : `${Math.round(p.cooldownMs / 1000)}s`;
  logger.warn(MODULE, `❌ ${p.name} lỗi (${reason}) → fail=${p.failCount}, cooldown ${cd}`);
}

function markSuccess(p) {
  p.failCount = 0; p.lastFailed = 0; p.cooldownMs = p.baseCooldownMs; p.okCount++;
}

// ── MAIN ──────────────────────────────────────────────────────────────
async function generateImage(prompt, localPath, width = 1024, height = 576) {
  const maxAttempts = providers.filter(p => p.enabled).length + 2;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const p = await acquire();
    try {
      logger.info(MODULE, `🎨 Đang tạo ảnh qua ${p.name}...`);
      p.lastUsedMs = Date.now();
      await run(p, prompt, localPath, width, height);
      markSuccess(p);
      p.lastUsedMs = Date.now();
      logger.success(MODULE, `✅ ${p.name} OK`);
      return { provider: p.name, localPath };
    } catch (e) {
      lastErr = e;
      markFailed(p, e);
      logger.warn(MODULE, `⚠️  ${p.name} thất bại: ${(e.message || '').slice(0, 80)} → thử provider khác...`);
    } finally {
      setBusy(p, false);
    }
  }
  throw new Error(`Tất cả providers thất bại. Lỗi cuối: ${lastErr ? lastErr.message : 'unknown'}`);
}

module.exports = { init, generateImage, getStatus, logStatus, reload };
