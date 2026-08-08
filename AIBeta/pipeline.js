// ==========================================
// PIPELINE ORCHESTRATOR
// Điều phối toàn bộ pipeline từ A → Z + Realtime Progress Reporting
// ==========================================
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const logger = require('./src/logger');
const { scrapeTrendingVideos } = require('./src/scraper/tiktokScraper');
const { downloadVideo } = require('./src/downloader/videoDownloader');
const { generateVietnameseScript } = require('./src/translator/scriptWriter');
const { generateVoice } = require('./src/tts/voiceGenerator');
const { editVideo } = require('./src/editor/videoEditor');
const { uploadToTikTok } = require('./src/uploader/tiktokUploader');
const config = require('./config/config');

// Tạo thư mục làm việc nếu chưa có
function ensureDirectories() {
  const dirs = [
    config.paths.downloads,
    config.paths.audio,
    config.paths.output,
    config.paths.logs,
    path.dirname(config.tiktok.sessionFile),
  ];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

function emitProgress(progressData) {
  logger.emitter.emit('progress', progressData);
}

/**
 * Chạy pipeline cho 1 video
 */
async function processVideo(video, index, total, pipelineStartTime) {
  const separator = '─'.repeat(50);
  console.log(`\n${separator}`);
  logger.step(index, total, `Xử lý video: "${video.description.substring(0, 60)}..."`);
  logger.info('Pipeline', `Author: @${video.author} | Views: ${video.viewCount?.toLocaleString()}`);
  console.log(separator);

  const result = {
    videoId: video.id,
    success: false,
    steps: {},
  };

  const calculateProgress = (stepNum, stepName, stepPercent, details, scriptTitle = '') => {
    const elapsed = Math.floor((Date.now() - pipelineStartTime) / 1000);
    // Ước tính 45 giây cho mỗi bước
    const totalStepsInPipeline = total * 5;
    const completedSteps = (index - 1) * 5 + (stepNum - 1) + (stepPercent / 100);
    const overallPercent = Math.min(99, Math.round((completedSteps / totalStepsInPipeline) * 100));
    
    const avgTimePerStep = elapsed > 0 && completedSteps > 0 ? elapsed / completedSteps : 30;
    const remainingSteps = totalStepsInPipeline - completedSteps;
    const etaSeconds = Math.max(5, Math.round(remainingSteps * avgTimePerStep));

    return {
      videoIndex: index,
      totalVideos: total,
      videoId: video.id,
      videoAuthor: video.author,
      videoDesc: video.description,
      scriptTitle: scriptTitle || video.scriptTitle || '',
      step: stepNum,
      stepName: stepName,
      stepPercent: stepPercent,
      overallPercent: overallPercent,
      elapsedSeconds: elapsed,
      etaSeconds: etaSeconds,
      details: details,
    };
  };

  try {
    // BƯỚC 1: Tải video gốc
    emitProgress(calculateProgress(1, 'Tải Video Gốc (No Watermark)', 20, 'Đang tải file mp4 từ TikTok...'));
    logger.step('1', '5', 'Tải video gốc...');
    const videoPath = await downloadVideo(video);
    result.steps.download = '✅';
    emitProgress(calculateProgress(1, 'Tải Video Gốc (No Watermark)', 100, `Tải xong: ${path.basename(videoPath)}`));
    logger.success('Pipeline', `Tải xong: ${path.basename(videoPath)}`);

    // BƯỚC 2: Tạo kịch bản AI Tiếng Việt
    emitProgress(calculateProgress(2, 'Gemini AI Dịch & Viết Kịch Bản', 30, 'Đang phân tích kịch bản gốc và rewrite sang Tiếng Việt...'));
    logger.step('2', '5', 'Tạo kịch bản AI Tiếng Việt...');
    const scriptData = await generateVietnameseScript(video);
    video.scriptTitle = scriptData.title;
    result.steps.script = '✅';
    emitProgress(calculateProgress(2, 'Gemini AI Dịch & Viết Kịch Bản', 100, `Kịch bản xong: "${scriptData.title}"`, scriptData.title));
    logger.success('Pipeline', `Kịch bản: "${scriptData.title}"`);

    // BƯỚC 3: Tạo giọng đọc AI (TTS)
    emitProgress(calculateProgress(3, 'Edge-TTS Tạo Giọng Đọc AI', 40, `Đang chuyển kịch bản sang voiceover ${config.pipeline.voiceName}...`, scriptData.title));
    logger.step('3', '5', 'Tạo giọng đọc AI Tiếng Việt...');
    const audioPath = await generateVoice(video.id, scriptData.script);
    result.steps.voice = '✅';
    emitProgress(calculateProgress(3, 'Edge-TTS Tạo Giọng Đọc AI', 100, `Giọng đọc hoàn tất: ${path.basename(audioPath)}`, scriptData.title));
    logger.success('Pipeline', `Giọng đọc: ${path.basename(audioPath)}`);

    // BƯỚC 4: Ghép video FFmpeg
    emitProgress(calculateProgress(4, 'FFmpeg Render Video & Subtitle', 50, 'Đang crop 9:16, ghép voice AI và burn-in phụ đề TikTok...', scriptData.title));
    logger.step('4', '5', 'Ghép video + voice + subtitle...');
    const finalVideoPath = await editVideo(video.id, videoPath, audioPath, scriptData);
    result.steps.edit = '✅';
    emitProgress(calculateProgress(4, 'FFmpeg Render Video & Subtitle', 100, `Render xong: ${path.basename(finalVideoPath)}`, scriptData.title));
    logger.success('Pipeline', `Video output: ${path.basename(finalVideoPath)}`);

    // BƯỚC 5: Playwright Auto Upload TikTok
    emitProgress(calculateProgress(5, 'Playwright Đăng Video TikTok', 60, 'Mở trình duyệt Playwright, tải video, điền caption...', scriptData.title));
    logger.step('5', '5', 'Đang đăng lên TikTok...');
    const uploaded = await uploadToTikTok(finalVideoPath, scriptData);
    result.steps.upload = uploaded ? '✅' : '⚠️';

    if (uploaded) {
      emitProgress(calculateProgress(5, 'Playwright Đăng Video TikTok', 100, '🎉 Video đã được đăng lên TikTok thành công!', scriptData.title));
      logger.success('Pipeline', `🎉 Video đã đăng lên TikTok!`);
      result.success = true;
    } else {
      emitProgress(calculateProgress(5, 'Playwright Đăng Video TikTok', 100, '⚠️ Video lưu tại workspace/output (Upload chưa xong)', scriptData.title));
      logger.warn('Pipeline', 'Upload thất bại, video vẫn được lưu tại output/');
    }

    // Delay giữa các video (30-60 giây)
    if (index < total) {
      const delay = Math.floor(Math.random() * 20000 + 20000);
      emitProgress(calculateProgress(5, 'Nghỉ giữa các Video', 100, `Chờ ${Math.round(delay/1000)} giây trước video tiếp theo...`, scriptData.title));
      logger.info('Pipeline', `Chờ ${delay / 1000}s trước video tiếp theo...`);
      await new Promise(r => setTimeout(r, delay));
    }

  } catch (error) {
    logger.error('Pipeline', `Lỗi xử lý video ${video.id}: ${error.message}`);
    result.error = error.message;
    emitProgress(calculateProgress(1, 'Lỗi Xử Lý Video', 0, `❌ Lỗi: ${error.message}`));
  }

  return result;
}

/**
 * Chạy toàn bộ pipeline
 */
async function runPipeline(options = {}) {
  const startTime = Date.now();

  console.log('\n' + '═'.repeat(60));
  console.log('🤖  TIKTOK AUTO SYSTEM — Đang khởi động...');
  console.log('═'.repeat(60));

  ensureDirectories();
  const results = [];

  try {
    emitProgress({
      videoIndex: 0,
      totalVideos: options.maxVideos || config.pipeline.maxVideosPerRun,
      step: 0,
      stepName: 'Cào Video Trend TikTok',
      stepPercent: 10,
      overallPercent: 5,
      elapsedSeconds: 0,
      etaSeconds: 180,
      details: 'Đang kết nối Apify API quét video hot...'
    });

    // PHASE 1: Cào trend
    logger.step('A', 'D', 'PHASE 1: Cào video trending TikTok...');
    const videos = await scrapeTrendingVideos(
      options.hashtags || config.pipeline.hashtags,
      options.maxVideos || config.pipeline.maxVideosPerRun
    );

    if (!videos || videos.length === 0) {
      logger.warn('Pipeline', 'Không tìm thấy video nào phù hợp!');
      emitProgress({
        videoIndex: 0,
        totalVideos: 0,
        step: 0,
        stepName: 'Không tìm thấy video',
        stepPercent: 0,
        overallPercent: 0,
        elapsedSeconds: Math.floor((Date.now() - startTime)/1000),
        etaSeconds: 0,
        details: 'Không tìm thấy video phù hợp tiêu chí'
      });
      return results;
    }

    logger.success('Pipeline', `Tìm thấy ${videos.length} video đủ điều kiện`);

    // PHASE 2-5: Xử lý từng video
    for (let i = 0; i < videos.length; i++) {
      const result = await processVideo(videos[i], i + 1, videos.length, startTime);
      results.push(result);
    }

  } catch (error) {
    logger.error('Pipeline', `Lỗi pipeline: ${error.message}`);
  }

  // Tổng kết
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const successCount = results.filter(r => r.success).length;

  emitProgress({
    videoIndex: results.length,
    totalVideos: results.length,
    step: 5,
    stepName: 'Hoàn Thành Pipeline',
    stepPercent: 100,
    overallPercent: 100,
    elapsedSeconds: Math.floor((Date.now() - startTime)/1000),
    etaSeconds: 0,
    details: `✅ Đã xử lý ${successCount}/${results.length} video thành công!`
  });

  return results;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  if (args.includes('--hashtags')) {
    const idx = args.indexOf('--hashtags');
    options.hashtags = args[idx + 1]?.split(',') || config.pipeline.hashtags;
  }

  if (args.includes('--max')) {
    const idx = args.indexOf('--max');
    options.maxVideos = parseInt(args[idx + 1]) || config.pipeline.maxVideosPerRun;
  }

  runPipeline(options).then(() => {
    process.exit(0);
  }).catch(error => {
    logger.error('Main', error.message);
    process.exit(1);
  });
}

module.exports = { runPipeline };
