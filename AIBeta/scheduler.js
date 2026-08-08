// ==========================================
// SCHEDULER - Chạy pipeline tự động theo lịch
// ==========================================
require('dotenv').config();
const cron = require('node-cron');
const { runPipeline } = require('./pipeline');
const config = require('./config/config');
const logger = require('./src/logger');

const MODULE = 'Scheduler';

let isRunning = false;

logger.info(MODULE, '🕐 Scheduler đã khởi động!');
logger.info(MODULE, `Lịch chạy: ${config.schedule.cron} (8h, 12h, 18h mỗi ngày)`);
logger.info(MODULE, 'Nhấn Ctrl+C để dừng.\n');

// Lịch tự động
cron.schedule(config.schedule.cron, async () => {
  if (isRunning) {
    logger.warn(MODULE, 'Pipeline đang chạy, bỏ qua lần này...');
    return;
  }

  isRunning = true;
  logger.info(MODULE, `⏰ Đến giờ chạy pipeline! (${new Date().toLocaleString('vi-VN')})`);

  try {
    await runPipeline();
  } catch (error) {
    logger.error(MODULE, `Pipeline lỗi: ${error.message}`);
  } finally {
    isRunning = false;
  }
}, {
  timezone: 'Asia/Ho_Chi_Minh'
});

// Chạy ngay 1 lần khi khởi động (để test)
const args = process.argv.slice(2);
if (args.includes('--run-now')) {
  logger.info(MODULE, '🚀 --run-now flag: Chạy pipeline ngay!');
  (async () => {
    isRunning = true;
    try {
      await runPipeline();
    } finally {
      isRunning = false;
    }
  })();
}
