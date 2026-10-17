/**
 * Google Flow image client — điều khiển composer của Flow (Playwright qua CDP) trong Chrome ĐÃ ĐĂNG NHẬP.
 *  - Kết nối Chrome đang chạy với --remote-debugging-port (mặc định http://127.0.0.1:9222, xem start-flow-chrome.bat)
 *  - Dùng đúng ô "Bạn muốn tạo những gì?" ở cuối trang project (không qua agent chat nên nhanh ~30s/ảnh)
 *  - Chọn model (Nano Banana Pro / 2.1 / 2 Lite), tỉ lệ khung, x1 rồi tải ảnh về.
 * Lưu ý: Flow không có API chính thức → selector có thể đổi khi Google cập nhật giao diện.
 */
const fs = require('fs');
const { chromium } = require('playwright');
const logger = require('../logger');

const MODULE = 'Flow';
const CDP_URL = process.env.FLOW_CDP_URL || 'http://127.0.0.1:9222';
const PROJECT_URL = process.env.FLOW_PROJECT_URL || '';
const GEN_TIMEOUT_MS = (parseInt(process.env.FLOW_TIMEOUT_SEC) || 150) * 1000;

const SEL = {
  prompt: '[role="textbox"][contenteditable="true"]',
  settings: 'button[aria-label="Điều kiện kích hoạt cài đặt"]',
  modelPicker: 'button[aria-label="Chọn nhóm mô hình"]',
  submit: 'button[aria-label="Bắt đầu tạo"]',
  resultImg: 'img.image[data-media-id]',
};
const ASPECT_ICON = { '16:9': 'crop_16_9', '4:3': 'crop_landscape', '1:1': 'crop_square', '3:4': 'crop_portrait', '9:16': 'crop_9_16' };

let browser = null;
let lock = Promise.resolve();

function flowError(msg, flags = {}) { return Object.assign(new Error(msg), flags); }

function aspectFor(width, height) {
  if (width === height) return '1:1';
  if (width > height) return '16:9';
  return '3:4';
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 8000 });
    browser.on('disconnected', () => { browser = null; });
    logger.success(MODULE, `Đã kết nối Chrome (${CDP_URL})`);
    return browser;
  } catch (e) {
    throw flowError(`Flow: không kết nối được Chrome tại ${CDP_URL}. Chạy start-flow-chrome.bat, đăng nhập Google và mở project Flow.`, { flowNotConnected: true });
  }
}

async function getPage() {
  const b = await getBrowser();
  const ctx = b.contexts()[0];
  let page = ctx.pages().find(p => /flow\.google\.com\/project\//.test(p.url()));
  if (!page) {
    if (!PROJECT_URL) throw flowError('Flow: chưa mở tab project Flow và chưa đặt FLOW_PROJECT_URL trong .env', { flowNotConnected: true });
    page = await ctx.newPage();
    await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  if (/accounts\.google\.com/.test(page.url())) throw flowError('Flow: chưa đăng nhập Google trong Chrome này', { flowNotConnected: true });
  await page.waitForSelector(SEL.prompt, { timeout: 30000 }).catch(() => {
    throw flowError('Flow: không thấy ô nhập prompt (đang ở trang khác?). Hãy mở project Flow ở chế độ tạo ảnh.', { flowNotConnected: true });
  });
  return page;
}

/** Chọn model / tỉ lệ / x1 nếu khác hiện tại (đọc từ nhãn nút cài đặt để tránh mở popover thừa) */
async function configure(page, model, aspect) {
  const settingsBtn = page.locator(SEL.settings).first();
  let isVisible = await settingsBtn.isVisible().catch(() => false);
  if (!isVisible) {
    const dismissBtn = page.locator('button:has-text("Agree"), button:has-text("No thanks"), button:has-text("Đồng ý"), button[aria-label="Đóng"]').first();
    if (await dismissBtn.isVisible().catch(() => false)) {
      await dismissBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    isVisible = await settingsBtn.isVisible().catch(() => false);
  }
  if (!isVisible) return; // Nếu nút settings ẩn, dùng cấu hình mặc định của composer

  const label = ((await settingsBtn.innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  const okModel = label.includes(model);
  const okAspect = label.includes(ASPECT_ICON[aspect]);
  const okCount = /\bx1\b/.test(label);
  if (okModel && okAspect && okCount) return;

  for (let i = 0; i < 3 && (await page.locator('.cdk-overlay-backdrop-showing').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await settingsBtn.click().catch(() => {});
  const pop = page.locator('.cdk-overlay-container');
  await pop.locator('button[role="radio"]:has-text("Hình ảnh")').first().waitFor({ timeout: 8000 });

  const img = pop.locator('button[role="radio"]:has-text("Hình ảnh")').first();
  const imgSelected = await img.evaluate(el => ['aria-checked', 'aria-pressed', 'aria-selected'].some(a => el.getAttribute(a) === 'true') || el.closest('.mat-button-toggle-checked') !== null);
  if (!imgSelected) await img.click();
  if (!okAspect) await pop.locator(`button[role="radio"]:has-text("${aspect}")`).first().click();
  if (!okCount) await pop.locator('button[role="radio"]', { hasText: /^\s*x1\s*$/ }).first().click();
  if (!okModel) {
    await pop.locator(SEL.modelPicker).first().click();
    await page.locator('[role="menuitem"]', { hasText: new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') }).first().click({ timeout: 8000 });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // đóng popover còn sót
  if (await page.locator('.cdk-overlay-container button[role="radio"]').count()) await page.keyboard.press('Escape');
}

async function mediaIds(page) {
  return page.evaluate(sel => [...document.querySelectorAll(sel)].map(i => i.getAttribute('data-media-id')), SEL.resultImg);
}

async function findNewImage(page, before) {
  return page.evaluate(({ sel, before }) => {
    const imgs = [...document.querySelectorAll(sel)];
    for (const i of imgs) {
      const id = i.getAttribute('data-media-id');
      if (!before.includes(id) && i.complete && i.naturalWidth > 200) return { id, src: i.src };
    }
    return null;
  }, { sel: SEL.resultImg, before });
}

async function snackText(page) {
  return page.evaluate(() => [...document.querySelectorAll('.mat-mdc-snack-bar-container, simple-snack-bar, [role="alert"]')].map(e => e.innerText).join(' | ').trim());
}

async function download(page, src, localPath) {
  const ctx = page.context();
  const resp = await ctx.request.get(src, { timeout: 60000 });
  if (resp.ok()) { fs.writeFileSync(localPath, await resp.body()); return; }
  // fallback: tải trong ngữ cảnh trang (có cookie/session)
  const b64 = await page.evaluate(async url => {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, src);
  fs.writeFileSync(localPath, Buffer.from(b64, 'base64'));
}

async function generateOnce({ prompt, model, width, height, localPath }) {
  const page = await getPage();
  const aspect = aspectFor(width, height);
  await configure(page, model, aspect);

  const before = await mediaIds(page);
  const box = page.locator(SEL.prompt).first();
  await box.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(prompt.replace(/\s+/g, ' ').trim());

  const submit = page.locator(SEL.submit).first();
  await page.waitForFunction(sel => { const b = document.querySelector(sel); return b && !b.disabled; }, SEL.submit, { timeout: 10000 });
  const t0 = Date.now();
  await submit.click();

  let lastSnack = '';
  while (Date.now() - t0 < GEN_TIMEOUT_MS) {
    await page.waitForTimeout(1500);
    const found = await findNewImage(page, before);
    if (found) {
      await download(page, found.src, localPath);
      logger.info(MODULE, `${model}: ảnh xong sau ${Math.round((Date.now() - t0) / 1000)}s`);
      return;
    }
    const snack = await snackText(page);
    if (snack && snack !== lastSnack) {
      lastSnack = snack;
      logger.warn(MODULE, `Thông báo Flow: ${snack.slice(0, 160)}`);
      if (/giới hạn|hết lượt|quota|limit|vượt quá|too many/i.test(snack)) throw flowError('Flow: ' + snack.slice(0, 120), { flowQuota: true });
      if (/không thể|thất bại|lỗi|failed|error|unsafe|chính sách|policy/i.test(snack)) throw flowError('Flow: ' + snack.slice(0, 120));
    }
  }
  throw flowError(`Flow: quá thời gian chờ ${GEN_TIMEOUT_MS / 1000}s (${model})`);
}

/** Tuần tự hoá mọi lệnh Flow (một tab = một composer) */
function generateImageFlow(opts) {
  const run = lock.then(() => generateOnce(opts));
  lock = run.catch(() => {});
  return run;
}

module.exports = { generateImageFlow };
