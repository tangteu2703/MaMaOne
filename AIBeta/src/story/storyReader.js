// ==========================================
// MODULE: STORY READER & EPISODE SPLITTER
// Đọc câu chuyện dài → Phân đoạn thành từng Tập (Episode)
// Mỗi tập ~150-250 từ ≈ 60–90 giây audio đọc truyện
// ==========================================
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'StoryReader';

/**
 * Đọc file truyện từ thư mục workspace/stories
 * @returns {string|null} Nội dung truyện
 */
function readStoryFromFile(storyFilePath = null) {
  const filePath = storyFilePath || config.story.storyFile;
  if (!fs.existsSync(filePath)) {
    logger.warn(MODULE, `Không tìm thấy file truyện: ${filePath}`);
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8').trim();
  logger.info(MODULE, `Đã đọc file truyện: ${path.basename(filePath)} (${content.length} ký tự)`);
  return content;
}

function removeVietnameseTones(str) {
  if (!str) return '';
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, 'a');
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, 'e');
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, 'i');
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, 'o');
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, 'u');
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, 'y');
  str = str.replace(/đ/g, 'd');
  str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, 'A');
  str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, 'E');
  str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, 'I');
  str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, 'O');
  str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, 'U');
  str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, 'Y');
  str = str.replace(/Đ/g, 'D');
  return str;
}

/**
 * Lưu nội dung truyện (từ UI paste) vào file
 * @param {string} storyContent - Nội dung truyện
 * @param {string} storyTitle - Tiêu đề truyện (dùng làm tên file/folder)
 */
function saveStoryToFile(storyContent, storyTitle = 'my_story') {
  const storiesDir = config.story.storiesDir;
  if (!fs.existsSync(storiesDir)) {
    fs.mkdirSync(storiesDir, { recursive: true });
  }
  const asciiTitle = removeVietnameseTones(storyTitle);
  const safeFileName = asciiTitle.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').substring(0, 50) || 'my_story';
  const filePath = path.join(storiesDir, `${safeFileName}.txt`);
  const metaPath = path.join(storiesDir, `${safeFileName}.json`);

  fs.writeFileSync(filePath, storyContent, 'utf8');
  fs.writeFileSync(metaPath, JSON.stringify({ originalTitle: storyTitle, title: storyTitle }, null, 2), 'utf8');

  logger.success(MODULE, `Đã lưu truyện: ${path.basename(filePath)} ("${storyTitle}")`);
  return filePath;
}

/**
 * Lấy trạng thái các tập đã render của một truyện
 */
function getEpisodesProgress(storyTitle) {
  const progressFile = path.join(config.story.storiesDir, `${storyTitle}_progress.json`);
  if (fs.existsSync(progressFile)) {
    try {
      return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    } catch { return null; }
  }
  return null;
}

/**
 * Lưu trạng thái tiến độ tập truyện
 */
function saveEpisodesProgress(storyTitle, progressData) {
  const storiesDir = config.story.storiesDir;
  if (!fs.existsSync(storiesDir)) fs.mkdirSync(storiesDir, { recursive: true });
  const progressFile = path.join(storiesDir, `${storyTitle}_progress.json`);
  fs.writeFileSync(progressFile, JSON.stringify(progressData, null, 2), 'utf8');
}

/**
 * Phân đoạn câu chuyện thành các Episode tự nhiên
 * Ưu tiên tách theo đoạn văn → ngắt theo câu nếu đoạn quá dài
 * @param {string} storyContent - Nội dung toàn bộ truyện
 * @param {number} wordsPerEpisode - Số từ mỗi tập (0 = không chia)
 * @returns {Array<{index, title, content, wordCount}>} Danh sách tập
 */
function splitStoryIntoEpisodes(storyContent, wordsPerEpisode = null) {
  // wordsPerEpisode = 0 → không chia tập, trả về 1 tập duy nhất
  if (wordsPerEpisode === 0 || wordsPerEpisode === '0') {
    const ep = buildEpisode(1, storyContent.replace(/\r\n/g, '\n').trim());
    logger.info(MODULE, `Không chia tập — 1 tập duy nhất (${ep.wordCount} từ)`);
    return [ep];
  }

  const targetWords = wordsPerEpisode || config.story.wordsPerEpisode;
  const maxWords = Math.round(targetWords * 1.3); // 30% buffer

  // Chuẩn hóa nội dung: xử lý line break
  const cleanContent = storyContent
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Tách theo đoạn văn trước
  const paragraphs = cleanContent.split(/\n\n+/).filter(p => p.trim().length > 0);

  const episodes = [];
  let currentChunk = [];
  let currentWordCount = 0;

  for (const paragraph of paragraphs) {
    const paragraphWords = paragraph.trim().split(/\s+/).length;

    // Nếu đoạn văn quá dài (> maxWords), tách theo câu
    if (paragraphWords > maxWords) {
      const sentences = paragraph.match(/[^.!?。！？]+[.!?。！？]+/g) || [paragraph];
      for (const sentence of sentences) {
        const sentenceWords = sentence.trim().split(/\s+/).length;
        if (currentWordCount + sentenceWords > maxWords && currentWordCount >= Math.round(targetWords * 0.7)) {
          episodes.push(buildEpisode(episodes.length + 1, currentChunk.join('\n\n')));
          currentChunk = [];
          currentWordCount = 0;
        }
        currentChunk.push(sentence.trim());
        currentWordCount += sentenceWords;
      }
    } else {
      // Nếu thêm đoạn này vào sẽ vượt giới hạn → flush
      if (currentWordCount + paragraphWords > maxWords && currentWordCount >= Math.round(targetWords * 0.7)) {
        episodes.push(buildEpisode(episodes.length + 1, currentChunk.join('\n\n')));
        currentChunk = [];
        currentWordCount = 0;
      }
      currentChunk.push(paragraph.trim());
      currentWordCount += paragraphWords;
    }
  }

  // Flush phần còn lại
  if (currentChunk.length > 0) {
    episodes.push(buildEpisode(episodes.length + 1, currentChunk.join('\n\n')));
  }

  logger.success(MODULE, `Phân đoạn xong: ${episodes.length} tập | Trung bình ${Math.round(episodes.reduce((s, e) => s + e.wordCount, 0) / episodes.length)} từ/tập`);
  return episodes;
}

function buildEpisode(index, content) {
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
  return {
    index,
    episodeNum: index,
    title: `Tập ${index}`,
    content: content.trim(),
    wordCount,
    estimatedDurationSeconds: Math.round(wordCount / 2.8), // ~2.8 từ/giây TTS tiếng Việt
  };
}

/**
 * Dùng Gemini AI đặt tiêu đề hấp dẫn + caption + hashtag cho từng tập
 * @param {string} storyTitle - Tên truyện
 * @param {object} episode - { index, content }
 * @returns {Promise<object>} { title, caption, hashtags }
 */
async function generateEpisodeMetadata(storyTitle, episode) {
  const genKey = config.gemini.apiKey;
  if (!genKey || genKey === 'your_gemini_api_key_here') {
    return getDefaultEpisodeMetadata(storyTitle, episode);
  }

  const genAI = new GoogleGenerativeAI(genKey);
  const prompt = `Bạn là chuyên gia viết content TikTok Truyện Audio Việt Nam.

Tên truyện: "${storyTitle}"
Tập ${episode.index} — Nội dung đoạn truyện:
"""
${episode.content.substring(0, 400)}...
"""

Hãy tạo metadata cuốn hút cho video TikTok Truyện Audio này. Trả về JSON CHÍNH XÁC (không markdown):
{
  "title": "Tiêu đề tập ngắn gọn kịch tính (ví dụ: Tập 1: Ngày Trùng Sinh Đẫm Máu)",
  "hook": "Câu hook đầu video đọc trong 3 giây để giữ chân khán giả (dưới 15 từ, kịch tính)",
  "caption": "Caption TikTok cuốn hút dưới 100 ký tự, có emoji",
  "hashtags": ["#truyenaudio", "#truyen", "#audiobook", "#tamly", "#xaydung"]
}`;

  if (!process.env.GEMINI_API_KEY) {
    return getDefaultEpisodeMetadata(storyTitle, episode);
  }

  const modelsToTry = [config.gemini.model, 'gemini-2.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash-exp'].filter(Boolean);
  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean);
      logger.success(MODULE, `AI tạo metadata Tập ${episode.index}: "${parsed.title}"`);
      return parsed;
    } catch (err) {
      // Quiet fail to fallback
    }
  }

  return getDefaultEpisodeMetadata(storyTitle, episode);
}

function getDefaultEpisodeMetadata(storyTitle, episode) {
  return {
    title: `${storyTitle} — Tập ${episode.index}`,
    hook: `Tập ${episode.index} của câu chuyện đầy kịch tính này...`,
    caption: `🎧 ${storyTitle} | Tập ${episode.index} | Nghe truyện audio mỗi ngày! #truyenaudio`,
    hashtags: ['#truyenaudio', '#truyen', '#audiobook', '#tamly', '#viral'],
  };
}

/**
 * Load và phân đoạn toàn bộ truyện từ file
 * @param {string|null} storyFilePath - Đường dẫn file. null = dùng file mặc định
 * @param {number|null} wordsPerEpisode - Số từ/tập
 * @returns {{ title, episodes, totalEpisodes, totalWords }}
 */
function loadAndSplitStory(storyFilePath = null, wordsPerEpisode = null) {
  const filePath = storyFilePath || config.story.storyFile;
  const content = readStoryFromFile(filePath);
  if (!content) throw new Error('Không tìm thấy nội dung truyện. Vui lòng tạo file truyện hoặc paste qua Dashboard.');

  let storyTitle = path.basename(filePath, '.txt').replace(/_/g, ' ');
  const metaPath = filePath.replace(/\.txt$/, '.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta && (meta.originalTitle || meta.title)) {
        storyTitle = meta.originalTitle || meta.title;
      }
    } catch (e) {}
  } else if (config.story.activeStoryTitle) {
    storyTitle = config.story.activeStoryTitle;
  }

  const totalWords = content.split(/\s+/).filter(w => w.length > 0).length;
  const episodes = splitStoryIntoEpisodes(content, wordsPerEpisode);

  logger.info(MODULE, `Truyện: "${storyTitle}" | ${totalWords} từ | ${episodes.length} tập`);

  return {
    title: storyTitle,
    filePath,
    content,
    episodes,
    totalEpisodes: episodes.length,
    totalWords,
  };
}

module.exports = {
  readStoryFromFile,
  saveStoryToFile,
  splitStoryIntoEpisodes,
  generateEpisodeMetadata,
  loadAndSplitStory,
  getEpisodesProgress,
  saveEpisodesProgress,
};
