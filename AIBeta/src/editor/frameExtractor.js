// ==========================================
// MODULE: FRAME EXTRACTOR (FFmpeg Frame Extraction)
// Trích xuất khung hình cuối cùng (Last Frame) của video để gối đầu I2V
// ==========================================
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'FrameExtractor';

/**
 * Trích xuất khung hình cuối cùng của tệp video MP4
 * @param {string} inputVideoPath - Đường dẫn video đầu vào
 * @param {string} outputImagePath - Đường dẫn lưu file ảnh JPG
 * @returns {Promise<string>}
 */
function extractLastFrame(inputVideoPath, outputImagePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputVideoPath)) {
      return reject(new Error(`Tệp video đầu vào không tồn tại: ${inputVideoPath}`));
    }

    // Lấy 1 frame ở cuối video (-sseof -1 lấy giây cuối)
    const cmd = [
      `"${config.paths.ffmpeg}"`,
      '-sseof', '-1',
      '-i', `"${inputVideoPath}"`,
      '-update', '1',
      '-q:v', '2',
      '-y',
      `"${outputImagePath}"`
    ].join(' ');

    logger.info(MODULE, `Đang trích xuất khung hình cuối từ: ${path.basename(inputVideoPath)}...`);

    exec(cmd, { timeout: 30000 }, (error) => {
      if (!error && fs.existsSync(outputImagePath) && fs.statSync(outputImagePath).size > 500) {
        logger.success(MODULE, `Trích xuất last frame thành công: ${path.basename(outputImagePath)}`);
        resolve(outputImagePath);
      } else {
        logger.warn(MODULE, `Trích xuất frame thất bại với -sseof, thử lệnh fallback...`);
        // Fallback: Lấy frame ở timestamp 4s
        const fallbackCmd = [
          `"${config.paths.ffmpeg}"`,
          '-ss', '00:00:04',
          '-i', `"${inputVideoPath}"`,
          '-vframes', '1',
          '-q:v', '2',
          '-y',
          `"${outputImagePath}"`
        ].join(' ');

        exec(fallbackCmd, (fbErr) => {
          if (!fbErr && fs.existsSync(outputImagePath)) {
            resolve(outputImagePath);
          } else {
            reject(new Error(`Không thể trích xuất last frame từ video: ${fbErr?.message || error?.message}`));
          }
        });
      }
    });
  });
}

module.exports = {
  extractLastFrame,
};
