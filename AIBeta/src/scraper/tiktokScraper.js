// ==========================================
// MODULE 1: TIKTOK SCRAPER
// Cào video trend từ TikTok qua Apify API
// ==========================================
const axios = require('axios');
const https = require('https');
const config = require('../../config/config');
const logger = require('../logger');

// SSL bypass cho mạng công ty (proxy SSL inspection)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const MODULE = 'TikTokScraper';

/**
 * Lấy danh sách video trending theo hashtag
 * @param {string[]} hashtags - Mảng hashtag cần cào
 * @param {number} maxResults - Số lượng video tối đa
 * @returns {Promise<Array>} Danh sách video đã lọc
 */
async function scrapeTrendingVideos(hashtags = null, maxResults = null) {
  const tags = hashtags || config.pipeline.hashtags;
  const limit = maxResults || config.pipeline.maxVideosPerRun;

  logger.info(MODULE, `Bắt đầu cào trend với hashtags: ${tags.join(', ')}`);
  logger.info(MODULE, `Giới hạn: ${limit} video, min views: ${config.pipeline.minViewCount.toLocaleString()}`);

  if (!config.apify.token || config.apify.token === 'your_apify_token_here') {
    logger.warn(MODULE, 'APIFY_API_TOKEN chưa được cấu hình! Dùng dữ liệu mẫu để test...');
    return getMockData(limit);
  }

  try {
    const allVideos = [];

    for (const hashtag of tags) {
      logger.info(MODULE, `Đang cào hashtag: #${hashtag}`);

      // Khởi động Apify Actor
      const runResponse = await axios.post(
        `https://api.apify.com/v2/acts/${config.apify.tiktokScraperActorId}/runs`,
        {
          hashtags: [hashtag],
          resultsPerPage: 20,
          maxProfilesPerQuery: 1,
          shouldDownloadVideos: false,
          shouldDownloadCovers: false,
        },
        {
          headers: {
            Authorization: `Bearer ${config.apify.token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const runId = runResponse.data.data.id;
      logger.info(MODULE, `Actor đang chạy với ID: ${runId}`);

      // Chờ Actor hoàn thành
      const results = await waitForActorRun(runId);
      logger.success(MODULE, `#${hashtag}: Lấy được ${results.length} video`);

      allVideos.push(...results);

      // Delay giữa các hashtag
      await sleep(2000);
    }

    // Lọc video theo tiêu chí
    const filtered = filterVideos(allVideos, limit);
    logger.success(MODULE, `Sau lọc: ${filtered.length} video đủ điều kiện`);

    return filtered;
  } catch (error) {
    logger.error(MODULE, `Lỗi cào dữ liệu: ${error.message}`);
    logger.warn(MODULE, 'Fallback về dữ liệu mẫu...');
    return getMockData(limit);
  }
}

/**
 * Chờ Apify Actor chạy xong và lấy kết quả
 */
async function waitForActorRun(runId, maxWait = 120000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWait) {
    const statusRes = await axios.get(
      `https://api.apify.com/v2/actor-runs/${runId}`,
      { headers: { Authorization: `Bearer ${config.apify.token}` } }
    );

    const status = statusRes.data.data.status;
    logger.info(MODULE, `Actor status: ${status}`);

    if (status === 'SUCCEEDED') {
      const datasetId = statusRes.data.data.defaultDatasetId;
      const dataRes = await axios.get(
        `https://api.apify.com/v2/datasets/${datasetId}/items?limit=50`,
        { headers: { Authorization: `Bearer ${config.apify.token}` } }
      );
      return dataRes.data;
    }

    if (status === 'FAILED' || status === 'ABORTED') {
      throw new Error(`Actor thất bại với status: ${status}`);
    }

    await sleep(5000);
  }

  throw new Error('Actor timeout sau ' + maxWait / 1000 + 's');
}

/**
 * Lọc video theo tiêu chí chất lượng
 */
function filterVideos(videos, limit) {
  return videos
    .filter(v => {
      const views = v.playCount || v.stats?.playCount || 0;
      const hasUrl = v.webVideoUrl || v.videoUrl || v.id;
      return views >= config.pipeline.minViewCount && hasUrl;
    })
    .sort((a, b) => {
      const viewsA = a.playCount || a.stats?.playCount || 0;
      const viewsB = b.playCount || b.stats?.playCount || 0;
      return viewsB - viewsA; // Sắp xếp view nhiều nhất trước
    })
    .slice(0, limit)
    .map(v => ({
      id: v.id || v.videoId,
      url: v.webVideoUrl || `https://www.tiktok.com/@${v.authorMeta?.name}/video/${v.id}`,
      description: v.text || v.desc || '',
      author: v.authorMeta?.name || v.author?.uniqueId || 'unknown',
      viewCount: v.playCount || v.stats?.playCount || 0,
      likeCount: v.diggCount || v.stats?.diggCount || 0,
      hashtags: extractHashtags(v.text || v.desc || ''),
    }));
}

function extractHashtags(text) {
  const matches = text.match(/#[\w\u00C0-\u024F]+/g) || [];
  return matches.slice(0, 5);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Dữ liệu mẫu khi chưa có API key - để test pipeline
 */
function getMockData(limit) {
  logger.warn(MODULE, '⚠️  Đang dùng dữ liệu MẪU - Cấu hình APIFY_API_TOKEN để dùng thật!');
  const mockVideos = [
    {
      id: 'mock_001',
      url: 'https://www.tiktok.com/@programmingwithmosh/video/7000000000000000001',
      description: '5 Python tips every developer should know #python #coding #programming',
      author: 'programmingwithmosh',
      viewCount: 1200000,
      likeCount: 85000,
      hashtags: ['#python', '#coding', '#programming'],
    },
    {
      id: 'mock_002',
      url: 'https://www.tiktok.com/@ai_shorts/video/7000000000000000002',
      description: 'ChatGPT prompt trick that saves hours #chatgpt #ai #productivity',
      author: 'ai_shorts',
      viewCount: 980000,
      likeCount: 72000,
      hashtags: ['#chatgpt', '#ai', '#productivity'],
    },
    {
      id: 'mock_003',
      url: 'https://www.tiktok.com/@devhacks/video/7000000000000000003',
      description: 'Build a web scraper in 60 seconds #webdev #javascript #automation',
      author: 'devhacks',
      viewCount: 750000,
      likeCount: 54000,
      hashtags: ['#webdev', '#javascript', '#automation'],
    },
  ];
  return mockVideos.slice(0, limit);
}

module.exports = { scrapeTrendingVideos };
