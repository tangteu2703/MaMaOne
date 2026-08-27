// ==========================================
// PIPELINE ORCHESTRATOR — STORY AUDIO MODE
// Luồng: Đọc Truyện → Phân Tập → Cào Video Nền → TTS → Ghép Video
// ==========================================
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const logger = require('./src/logger');
const { scrapeTrendingVideos } = require('./src/scraper/tiktokScraper');
const { downloadVideo } = require('./src/downloader/videoDownloader');
const { generateVoice } = require('./src/tts/voiceGenerator');
const { editVideo } = require('./src/editor/videoEditor');
const { uploadToTikTok } = require('./src/uploader/tiktokUploader');
const { loadAndSplitStory, generateEpisodeMetadata, saveEpisodesProgress, getEpisodesProgress, saveStoryToFile } = require('./src/story/storyReader');
const config = require('./config/config');

// Tạo thư mục làm việc nếu chưa có
function ensureDirectories() {
  const dirs = [
    config.paths.downloads,
    config.paths.audio,
    config.paths.output,
    config.paths.logs,
    config.paths.stories,
    config.paths.music,
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
 * Cào pool video nền từ TikTok (nhiều video để đủ độ dài)
 * @param {number} numEpisodes - Số tập cần xử lý
 * @param {string[]} hashtags - Hashtags cào
 * @returns {Promise<string[]>} Danh sách đường dẫn file video đã tải
 */
async function scrapeAndDownloadBackgroundPool(numEpisodes, hashtags, pipelineStartTime) {
  const separator = '─'.repeat(50);
  console.log(`\n${separator}`);
  logger.step('A', 'D', `PHASE 1: Cào ${Math.max(numEpisodes * 2, 5)} video nền chủ đề: ${hashtags.slice(0, 3).join(', ')}...`);

  emitProgress({
    videoIndex: 0,
    totalVideos: numEpisodes,
    step: 0,
    stepName: 'Cào Video Nền TikTok',
    stepPercent: 10,
    overallPercent: 3,
    elapsedSeconds: 0,
    etaSeconds: 300,
    details: `Đang quét video nền chủ đề: ${hashtags.slice(0, 3).join(', ')}...`,
  });

  const maxToScrape = Math.max(numEpisodes * 2, 5);
  const videos = await scrapeTrendingVideos(hashtags, maxToScrape);

  if (!videos || videos.length === 0) {
    throw new Error('Không cào được video nền nào!');
  }

  logger.success('Pipeline', `Tìm thấy ${videos.length} video nền ứng viên`);

  // Tải video nền
  const downloadedPaths = [];
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    emitProgress({
      videoIndex: i + 1,
      totalVideos: videos.length,
      step: 0,
      stepName: 'Tải Video Nền',
      stepPercent: Math.round(((i + 1) / videos.length) * 100),
      overallPercent: Math.round(3 + (i / videos.length) * 12),
      elapsedSeconds: Math.floor((Date.now() - pipelineStartTime) / 1000),
      etaSeconds: 120,
      details: `Đang tải video nền ${i + 1}/${videos.length}: @${video.author}...`,
    });

    try {
      const videoPath = await downloadVideo(video);
      downloadedPaths.push(videoPath);
      logger.success('Pipeline', `✅ Tải xong video nền ${i + 1}: ${path.basename(videoPath)}`);
    } catch (err) {
      logger.warn('Pipeline', `⏭️  Bỏ qua video nền ${video.id}: ${err.message}`);
    }
  }

  if (downloadedPaths.length === 0) {
    throw new Error('Không tải được video nền nào!');
  }

  logger.success('Pipeline', `Pool video nền sẵn sàng: ${downloadedPaths.length} clip`);
  return downloadedPaths;
}

/**
 * Xử lý 1 tập truyện: TTS + Ghép Video
 */
async function processEpisode(episode, episodeMetadata, backgroundPool, index, totalEpisodes, pipelineStartTime) {
  const separator = '─'.repeat(50);
  console.log(`\n${separator}`);
  logger.step(index, totalEpisodes, `Tập ${episode.index}: "${episodeMetadata.title}" (${episode.wordCount} từ ~${episode.estimatedDurationSeconds}s)`);
  console.log(separator);

  const videoId = `ep${String(episode.index).padStart(3, '0')}`;

  const result = {
    episodeIndex: episode.index,
    videoId,
    success: false,
    steps: {},
    outputFile: '',
    scriptBody: episode.content,
    script: episode.content,
  };


  const calcProgress = (step, stepName, stepPct, details) => {
    const elapsed = Math.floor((Date.now() - pipelineStartTime) / 1000);
    const totalSteps = totalEpisodes * 3; // 3 bước chính mỗi tập: TTS, Edit, Upload
    const completed = (index - 1) * 3 + (step - 1) + (stepPct / 100);
    const overall = Math.min(99, Math.round(15 + (completed / totalSteps) * 80)); // 15% đã dùng cho scrape/download
    const avgTime = elapsed > 0 && completed > 0 ? elapsed / completed : 60;
    const remaining = totalSteps - completed;

    const bgClip = backgroundPool && backgroundPool.length > 0 ? backgroundPool[(index - 1) % backgroundPool.length] : null;

    return {
      videoIndex: index,
      totalVideos: totalEpisodes,
      videoId,
      videoAuthor: `Tập ${episode.index}`,
      videoDesc: episodeMetadata.title,
      scriptTitle: episodeMetadata.title,
      scriptBody: episode.content,
      downloadFile: bgClip ? path.basename(bgClip) : undefined,
      finalFile: result.outputFile || undefined,
      step,
      stepName,
      stepPercent: stepPct,
      overallPercent: overall,
      elapsedSeconds: elapsed,
      etaSeconds: Math.max(5, Math.round(remaining * avgTime)),
      details,
    };
  };


  try {
    // BƯỚC 1: Tạo giọng đọc AI cho đoạn truyện
    emitProgress(calcProgress(1, 'TTS Tạo Giọng Đọc Truyện', 20, `Đang chuyển ${episode.wordCount} từ thành giọng đọc AI...`));
    logger.step('1', '3', `Tạo giọng đọc AI cho Tập ${episode.index}...`);

    const audioPath = await generateVoice(videoId, episode.content);
    result.steps.voice = '✅';
    emitProgress(calcProgress(1, 'TTS Tạo Giọng Đọc Truyện', 100, `Giọng đọc hoàn tất: ${path.basename(audioPath)}`));
    logger.success('Pipeline', `Giọng đọc Tập ${episode.index}: ${path.basename(audioPath)}`);

    // BƯỚC 2: Ghép video nền + voice + nhạc lofi + subtitle
    emitProgress(calcProgress(2, 'FFmpeg Render Video Truyện', 30, 'Đang ghép video nền + giọng đọc + nhạc lofi + phụ đề...'));
    logger.step('2', '3', `Ghép video Tập ${episode.index}...`);

    // Chọn ngẫu nhiên các clip từ pool làm video nền cho tập này
    const shuffledPool = [...backgroundPool].sort(() => Math.random() - 0.5);
    const bgForThisEpisode = shuffledPool.slice(0, Math.min(3, shuffledPool.length));

    const finalVideoPath = await editVideo(videoId, bgForThisEpisode, audioPath, {
      title: episodeMetadata.title,
      content: episode.content,
      index: episode.index,
    });

    result.outputFile = path.basename(finalVideoPath);
    result.steps.edit = '✅';
    emitProgress(calcProgress(2, 'FFmpeg Render Video Truyện', 100, `Render xong: ${result.outputFile}`));
    logger.success('Pipeline', `Video Tập ${episode.index}: ${result.outputFile}`);

    // BƯỚC 3: Upload (tạm bỏ qua)
    emitProgress(calcProgress(3, 'Hoàn Tất Tập Truyện', 100, `🎉 Tập ${episode.index} hoàn chỉnh! Lưu tại workspace/output/`));
    logger.info('Pipeline', `⏭️  Tạm bỏ qua upload TikTok. Video Tập ${episode.index} đã hoàn thiện!`);
    result.steps.upload = '⏭️ (Bỏ qua)';
    result.success = true;

    // Delay giữa các tập (15-30 giây)
    if (index < totalEpisodes) {
      const delay = Math.floor(Math.random() * 15000 + 15000);
      logger.info('Pipeline', `Chờ ${delay / 1000}s trước tập tiếp theo...`);
      await new Promise(r => setTimeout(r, delay));
    }

  } catch (error) {
    logger.error('Pipeline', `Lỗi Tập ${episode.index}: ${error.message}`);
    result.error = error.message;
    emitProgress(calcProgress(1, 'Lỗi Xử Lý Tập Truyện', 0, `❌ Lỗi: ${error.message}`));
  }

  return result;
}

/**
 * Chạy toàn bộ pipeline Story Audio
 * @param {object} options - { storyFilePath, storyContent, storyTitle, hashtags, maxEpisodes, wordsPerEpisode, startEpisode }
 */
async function runPipeline(options = {}) {
  const startTime = Date.now();

  console.log('\n' + '═'.repeat(60));
  console.log('📖  TRUYỆN AUDIO SYSTEM — Đang khởi động...');
  console.log('═'.repeat(60));

  ensureDirectories();
  const results = [];

  try {
    // ━━━━ PHASE 0: Đọc và phân đoạn truyện ━━━━
    logger.step('A', 'D', 'PHASE 0: Đọc và phân đoạn câu chuyện...');

    let storyData;
    if (options.storyContent) {
      // Nội dung truyện được paste từ Dashboard UI
      const title = options.storyTitle || config.story.activeStoryTitle;
      const savedPath = saveStoryToFile(options.storyContent, title);
      storyData = loadAndSplitStory(savedPath, options.wordsPerEpisode);
    } else {
      // Đọc từ file mặc định
      storyData = loadAndSplitStory(options.storyFilePath || null, options.wordsPerEpisode);
    }

    // Lọc tập cần xử lý
    let episodes = storyData.episodes;
    let startEpisode = options.startEpisode || 1;
    const maxEpisodes = options.maxEpisodes || config.pipeline.maxVideosPerRun;

    if (startEpisode > storyData.totalEpisodes) {
      logger.warn('Pipeline', `Tập bắt đầu (${startEpisode}) lớn hơn tổng số tập (${storyData.totalEpisodes}). Tự động đặt lại về Tập 1.`);
      startEpisode = 1;
    }

    episodes = episodes
      .filter(ep => ep.index >= startEpisode)
      .slice(0, maxEpisodes);

    if (episodes.length === 0) {
      throw new Error(`Không tìm thấy tập truyện hợp lệ để xử lý! (Truyện có ${storyData.totalEpisodes} tập)`);
    }


    logger.success('Pipeline', `Sẽ xử lý ${episodes.length} tập (${startEpisode} → ${startEpisode + episodes.length - 1}) của truyện "${storyData.title}"`);

    emitProgress({
      videoIndex: 0,
      totalVideos: episodes.length,
      step: 0,
      stepName: 'Phân Đoạn Truyện',
      stepPercent: 100,
      overallPercent: 2,
      elapsedSeconds: 0,
      etaSeconds: 600,
      details: `"${storyData.title}" → ${storyData.totalEpisodes} tập | Xử lý: Tập ${startEpisode}→${startEpisode + episodes.length - 1}`,
    });

    // ━━━━ PHASE 1: Cào & Tải video nền ━━━━
    const hashtags = options.hashtags || config.pipeline.hashtags;
    const backgroundPool = await scrapeAndDownloadBackgroundPool(episodes.length, hashtags, startTime);

    // ━━━━ PHASE 2: Tạo metadata AI cho từng tập ━━━━
    logger.step('B', 'D', 'PHASE 2: AI tạo metadata tiêu đề/caption cho từng tập...');
    const episodeMetadataList = [];
    for (const episode of episodes) {
      const meta = await generateEpisodeMetadata(storyData.title, episode);
      episodeMetadataList.push(meta);
      logger.info('Pipeline', `Metadata Tập ${episode.index}: "${meta.title}"`);
    }

    // ━━━━ PHASE 3-5: Xử lý từng tập ━━━━
    logger.step('C', 'D', 'PHASE 3: Render từng tập truyện audio...');
    for (let i = 0; i < episodes.length; i++) {
      const result = await processEpisode(
        episodes[i],
        episodeMetadataList[i],
        backgroundPool,
        i + 1,
        episodes.length,
        startTime
      );
      results.push(result);
    }

    // Lưu progress
    saveEpisodesProgress(storyData.title.replace(/\s+/g, '_'), {
      storyTitle: storyData.title,
      totalEpisodes: storyData.totalEpisodes,
      lastProcessedEpisode: startEpisode + episodes.length - 1,
      processedAt: new Date().toISOString(),
    });

  } catch (error) {
    logger.error('Pipeline', `Lỗi pipeline: ${error.message}`);
  }

  // Tổng kết
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  const successCount = results.filter(r => r.success).length;

  console.log('\n' + '═'.repeat(60));
  if (results.length > 0) {
    logger.success('Pipeline', `🎉 Hoàn tất! ${successCount}/${results.length} tập trong ${elapsed} phút`);
    console.log('═'.repeat(60));

    emitProgress({
      videoIndex: results.length,
      totalVideos: results.length,
      step: 4,
      stepName: 'Hoàn Thành Tất Cả Tập',
      stepPercent: 100,
      overallPercent: 100,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      etaSeconds: 0,
      details: `✅ Xong ${successCount}/${results.length} tập truyện audio!`,
    });
  } else {
    logger.error('Pipeline', `❌ Pipeline dừng lại: Không có tập nào được xử lý!`);
    console.log('═'.repeat(60));

    emitProgress({
      videoIndex: 0,
      totalVideos: 0,
      step: 0,
      stepName: 'Thất Bại',
      stepPercent: 0,
      overallPercent: 0,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      etaSeconds: 0,
      details: `❌ Pipeline chưa xử lý được tập nào. Vui lòng kiểm tra lại cấu hình truyện!`,
    });
  }

  return results;
}

// CLI run
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};

  if (args.includes('--hashtags')) {
    const idx = args.indexOf('--hashtags');
    options.hashtags = args[idx + 1]?.split(',') || config.pipeline.hashtags;
  }
  if (args.includes('--max')) {
    const idx = args.indexOf('--max');
    options.maxEpisodes = parseInt(args[idx + 1]) || config.pipeline.maxVideosPerRun;
  }
  if (args.includes('--start')) {
    const idx = args.indexOf('--start');
    options.startEpisode = parseInt(args[idx + 1]) || 1;
  }
  if (args.includes('--words')) {
    const idx = args.indexOf('--words');
    options.wordsPerEpisode = parseInt(args[idx + 1]) || config.story.wordsPerEpisode;
  }

  runPipeline(options).then(() => {
    process.exit(0);
  }).catch(error => {
    logger.error('Main', error.message);
    process.exit(1);
  });
}

module.exports = { runPipeline };
