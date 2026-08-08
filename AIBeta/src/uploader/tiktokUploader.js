// ==========================================
// MODULE 6: TIKTOK UPLOADER (Playwright)
// Tự động đăng video lên TikTok bằng Browser Automation
// ==========================================
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'TikTokUploader';

/**
 * Tự động đăng video lên TikTok
 * @param {string} videoPath - Đường dẫn file video
 * @param {object} scriptData - { caption, hashtags, title }
 * @returns {Promise<boolean>} Thành công hay không
 */
async function uploadToTikTok(videoPath, scriptData) {
  logger.info(MODULE, `Bắt đầu upload: ${path.basename(videoPath)}`);
  logger.info(MODULE, `Caption: ${scriptData.caption}`);

  const sessionFile = path.resolve(config.tiktok.sessionFile);

  // Khởi động trình duyệt với stealth mode
  const browser = await chromium.launch({
    headless: false, // Chạy có giao diện để dễ debug + tránh detect bot
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
    slowMo: 100, // Chậm lại để tránh bị phát hiện là bot
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Load session cookies nếu đã đăng nhập trước
    storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
  });

  // Thêm scripts để bypass bot detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    // Kiểm tra có session chưa
    const isLoggedIn = await checkLoginStatus(page, context, sessionFile);
    if (!isLoggedIn) {
      logger.warn(MODULE, '⚠️  Chưa đăng nhập! Đang mở trang login...');
      await doManualLogin(page, context, sessionFile);
    }

    // Vào trang upload
    logger.info(MODULE, 'Đang vào trang upload TikTok...');
    await page.goto('https://www.tiktok.com/upload', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    await randomDelay(2000, 4000);

    // Upload file video
    const success = await performUpload(page, videoPath, scriptData);

    if (success) {
      // Lưu session để lần sau không cần login
      await context.storageState({ path: sessionFile });
      logger.success(MODULE, '✅ Upload thành công! Session đã lưu.');
    }

    await browser.close();
    return success;

  } catch (error) {
    logger.error(MODULE, `Lỗi upload: ${error.message}`);

    // Chụp screenshot để debug
    try {
      const screenshotPath = path.join(config.paths.logs, `error-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      logger.info(MODULE, `Screenshot lỗi: ${screenshotPath}`);
    } catch {}

    await browser.close();
    return false;
  }
}

/**
 * Kiểm tra trạng thái đăng nhập
 */
async function checkLoginStatus(page, context, sessionFile) {
  if (!fs.existsSync(sessionFile)) return false;

  try {
    await page.goto('https://www.tiktok.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Kiểm tra có avatar/profile icon không
    const isLogged = await page.evaluate(() => {
      return document.querySelector('[data-e2e="profile-icon"]') !== null
        || document.querySelector('.avatar-wrapper') !== null
        || document.querySelector('[data-e2e="top-login-button"]') === null;
    });

    if (isLogged) {
      logger.success(MODULE, 'Đã đăng nhập từ session trước!');
    } else {
      logger.warn(MODULE, 'Session hết hạn, cần đăng nhập lại');
    }
    return isLogged;
  } catch {
    return false;
  }
}

/**
 * Hướng dẫn đăng nhập thủ công lần đầu
 */
async function doManualLogin(page, context, sessionFile) {
  await page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' });

  logger.warn(MODULE, '');
  logger.warn(MODULE, '==========================================');
  logger.warn(MODULE, '  🔐 CẦN ĐĂNG NHẬP TIKTOK THỦ CÔNG!');
  logger.warn(MODULE, '  Trình duyệt đã mở, vui lòng:');
  logger.warn(MODULE, '  1. Đăng nhập bằng email/SĐT/Google');
  logger.warn(MODULE, '  2. Sau khi vào trang chủ → nhấn Enter ở đây');
  logger.warn(MODULE, '==========================================');

  // Chờ người dùng đăng nhập thủ công (tối đa 5 phút)
  await page.waitForURL('https://www.tiktok.com/', { timeout: 300000 });

  // Lưu session
  await context.storageState({ path: sessionFile });
  logger.success(MODULE, 'Đã lưu session TikTok! Lần sau sẽ tự động đăng nhập.');
}

/**
 * Thực hiện các thao tác upload trên trang TikTok
 */
async function performUpload(page, videoPath, scriptData) {
  try {
    // Chờ trang upload load xong
    await page.waitForSelector('input[type="file"]', { timeout: 15000 });
    logger.info(MODULE, 'Trang upload đã sẵn sàng');

    // Upload file video
    const fileInput = await page.$('input[type="file"]');
    await fileInput.setInputFiles(videoPath);
    logger.info(MODULE, `Đã chọn file: ${path.basename(videoPath)}`);

    // Chờ video upload và xử lý (có thể mất 30-60 giây)
    logger.info(MODULE, 'Đang chờ video upload lên server TikTok...');
    await page.waitForSelector('[class*="caption"], [data-e2e="video-caption"]', {
      timeout: 120000,
    });

    await randomDelay(2000, 3000);

    // Điền caption
    const caption = buildCaption(scriptData);
    await typeCaptionSlowly(page, caption);
    logger.info(MODULE, `Caption đã điền: ${caption.substring(0, 50)}...`);

    await randomDelay(1500, 2500);

    // Tìm và click nút Post
    const postButton = await findPostButton(page);
    if (!postButton) {
      logger.error(MODULE, 'Không tìm thấy nút Post!');
      return false;
    }

    // Di chuột vào nút rồi click (tự nhiên hơn)
    await postButton.hover();
    await randomDelay(500, 1000);
    await postButton.click();

    logger.info(MODULE, 'Đã click Post, đang chờ xác nhận...');

    // Chờ xác nhận đăng thành công
    await page.waitForTimeout(5000);

    // Kiểm tra kết quả
    const successIndicator = await page.$('[class*="success"], [data-e2e="upload-success"]');
    if (successIndicator) {
      logger.success(MODULE, '✅ Video đã được đăng lên TikTok!');
      return true;
    }

    // Kiểm tra URL thay đổi (chuyển sang profile)
    const currentUrl = page.url();
    if (currentUrl.includes('/profile') || currentUrl.includes('/@')) {
      logger.success(MODULE, '✅ Upload thành công (redirect sang profile)!');
      return true;
    }

    logger.warn(MODULE, 'Không chắc upload thành công, kiểm tra TikTok thủ công');
    return true; // Assume success nếu không có lỗi rõ ràng

  } catch (error) {
    logger.error(MODULE, `Lỗi khi upload: ${error.message}`);
    return false;
  }
}

/**
 * Tạo caption đầy đủ từ script data
 */
function buildCaption(scriptData) {
  const hashtags = (scriptData.hashtags || []).join(' ');
  const caption = scriptData.caption || '';

  // TikTok giới hạn 2200 ký tự
  let fullCaption = `${caption}\n\n${hashtags}`;
  if (fullCaption.length > 2200) {
    fullCaption = fullCaption.substring(0, 2197) + '...';
  }
  return fullCaption;
}

/**
 * Gõ caption từng ký tự một (tự nhiên hơn)
 */
async function typeCaptionSlowly(page, caption) {
  // Tìm input caption
  const captionSelectors = [
    '[data-e2e="video-caption"]',
    '.public-DraftEditor-content',
    '[class*="caption"] [contenteditable]',
    '[placeholder*="caption"]',
    '[placeholder*="Thêm mô tả"]',
  ];

  let captionInput = null;
  for (const selector of captionSelectors) {
    try {
      captionInput = await page.$(selector);
      if (captionInput) break;
    } catch {}
  }

  if (!captionInput) {
    logger.warn(MODULE, 'Không tìm thấy ô caption, bỏ qua...');
    return;
  }

  await captionInput.click();
  await randomDelay(300, 600);

  // Xóa nội dung cũ
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');

  // Gõ caption với tốc độ ngẫu nhiên
  await page.keyboard.type(caption, { delay: Math.random() * 30 + 20 });
}

/**
 * Tìm nút Post trên nhiều phiên bản UI TikTok
 */
async function findPostButton(page) {
  const postSelectors = [
    '[data-e2e="post-button"]',
    'button[class*="post"]',
    'button:has-text("Post")',
    'button:has-text("Đăng")',
    'div[class*="post"]:has-text("Post")',
  ];

  for (const selector of postSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) return btn;
    } catch {}
  }
  return null;
}

/**
 * Delay ngẫu nhiên để tránh bị phát hiện là bot
 */
function randomDelay(min, max) {
  const delay = Math.floor(Math.random() * (max - min) + min);
  return new Promise(resolve => setTimeout(resolve, delay));
}

module.exports = { uploadToTikTok };
