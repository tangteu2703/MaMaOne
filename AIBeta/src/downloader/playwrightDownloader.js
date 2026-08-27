// ==========================================
// MODULE 2B: TIKTOK PLAYWRIGHT DOWNLOADER
// Download video TikTok bằng Playwright — intercept CDN URL
// Bypass TikTok bot detection, không cần login
// ==========================================
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'PlDownloader';

/**
 * Download video TikTok bằng cách dùng Playwright intercept network
 * @param {object} video - { id, url, author }
 * @param {string} outputPath - Đường dẫn file đầu ra .mp4
 * @returns {Promise<string>} outputPath nếu thành công
 */
async function downloadWithPlaywright(video, outputPath) {
  logger.info(MODULE, `Playwright download: ${video.url}`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Load session nếu đã login
    storageState: (() => {
      const sessionFile = path.resolve(config.tiktok.sessionFile);
      return fs.existsSync(sessionFile) ? sessionFile : undefined;
    })(),
  });

  // Bypass bot detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Bắt URL video từ network requests
  let videoDownloadUrl = null;

  // Intercept tất cả response để tìm CDN video URL
  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';

    // TikTok CDN video URLs thường chứa các pattern này
    if (
      !videoDownloadUrl &&
      (url.includes('v19-webapp') || url.includes('v26-webapp') || url.includes('v9-webapp') ||
       url.includes('tiktokcdn') || url.includes('muscdn')) &&
      (contentType.includes('video') || url.includes('.mp4')) &&
      !url.includes('thumbnail') && !url.includes('cover') && !url.includes('image')
    ) {
      videoDownloadUrl = url;
      logger.info(MODULE, `Bắt được CDN URL: ${url.substring(0, 80)}...`);
    }
  });

  try {
    // Mở trang TikTok
    logger.info(MODULE, 'Đang mở trang TikTok...');
    await page.goto(video.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Đợi video element xuất hiện
    await page.waitForTimeout(3000);

    // Thử click play để trigger video load nếu chưa có URL
    if (!videoDownloadUrl) {
      try {
        const videoEl = page.locator('video').first();
        await videoEl.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
      } catch {}
    }

    // Nếu vẫn chưa có URL từ intercept, thử lấy từ video element src
    if (!videoDownloadUrl) {
      try {
        const videoSrc = await page.evaluate(() => {
          const videos = document.querySelectorAll('video');
          for (const v of videos) {
            if (v.src && v.src.startsWith('http') && !v.src.includes('blob:')) {
              return v.src;
            }
            // Kiểm tra source elements
            const sources = v.querySelectorAll('source');
            for (const s of sources) {
              if (s.src && s.src.startsWith('http')) return s.src;
            }
          }
          return null;
        });
        if (videoSrc) {
          videoDownloadUrl = videoSrc;
          logger.info(MODULE, `Lấy được src từ <video>: ${videoSrc.substring(0, 80)}...`);
        }
      } catch {}
    }

    // Thử lấy từ __NEXT_DATA__ hoặc window.__data__
    if (!videoDownloadUrl) {
      try {
        const urlFromData = await page.evaluate(() => {
          // Tìm trong NEXT data
          const nextData = window.__NEXT_DATA__;
          if (nextData) {
            const str = JSON.stringify(nextData);
            const match = str.match(/"downloadAddr":"([^"]+)"/);
            if (match) return match[1].replace(/\\u002F/g, '/');
          }
          // Tìm trong itemInfo
          if (window.__ITEM_INFO__) {
            const info = window.__ITEM_INFO__;
            return info?.itemStruct?.video?.downloadAddr ||
                   info?.itemStruct?.video?.playAddr;
          }
          return null;
        });
        if (urlFromData) {
          videoDownloadUrl = urlFromData;
          logger.info(MODULE, `Lấy được URL từ page data`);
        }
      } catch {}
    }

    await browser.close();

    if (!videoDownloadUrl) {
      throw new Error('Không tìm thấy CDN URL video trong trang');
    }

    // Download file từ CDN URL
    logger.info(MODULE, 'Đang download từ CDN...');
    await downloadFromUrl(videoDownloadUrl, outputPath);

    // Validate
    if (!fs.existsSync(outputPath)) {
      throw new Error('File không tồn tại sau download');
    }
    const size = fs.statSync(outputPath).size;
    if (size < 100 * 1024) {
      fs.unlinkSync(outputPath);
      throw new Error(`File quá nhỏ: ${size} bytes`);
    }

    const sizeMB = (size / 1024 / 1024).toFixed(2);
    logger.success(MODULE, `✅ Playwright download thành công: ${video.id}.mp4 (${sizeMB} MB)`);
    return outputPath;

  } catch (err) {
    try { await browser.close(); } catch {}
    throw err;
  }
}

/**
 * Download file từ URL về local
 */
function downloadFromUrl(url, destPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.tiktok.com/',
      'Range': 'bytes=0-',
      ...headers,
    };

    const request = (urlStr, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Quá nhiều redirect'));
        return;
      }

      const parsedUrl = new URL(urlStr);
      const lib = parsedUrl.protocol === 'https:' ? https : http;

      lib.get(urlStr, {
        headers: defaultHeaders,
        rejectUnauthorized: false,
        timeout: 60000,
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          file.destroy();
          const redirectFile = fs.createWriteStream(destPath);
          request(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject).on('timeout', () => {
        reject(new Error('Download timeout'));
      });
    };

    request(url);
  });
}

module.exports = { downloadWithPlaywright };
