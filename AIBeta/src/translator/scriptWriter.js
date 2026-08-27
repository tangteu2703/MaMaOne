// ==========================================
// MODULE 3: SCRIPT WRITER (Dịch + Rewrite)
// Dùng Gemini AI dịch sang Tiếng Việt và viết kịch bản mới
// ==========================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../../config/config');
const logger = require('../logger');

const MODULE = 'ScriptWriter';
let genAI = null;

function getGemini() {
  if (!genAI) {
    if (!config.gemini.apiKey || config.gemini.apiKey === 'your_gemini_api_key_here') {
      return null;
    }
    genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return genAI;
}

/**
 * Tạo kịch bản Tiếng Việt từ mô tả video gốc (Tiếng Anh)
 * @param {object} video - Object video với description
 * @param {string|null} transcript - Transcript từ video (nếu có)
 * @returns {Promise<object>} Kịch bản mới { script, caption, hashtags }
 */
async function generateVietnameseScript(video, transcript = null) {
  logger.info(MODULE, `Đang tạo kịch bản cho video: ${video.id}`);

  const ai = getGemini();
  if (!ai) {
    logger.warn(MODULE, 'GEMINI_API_KEY chưa cấu hình, dùng kịch bản mẫu');
    return getMockScript(video);
  }

  const sourceContent = transcript
    ? `Transcript video gốc:\n${transcript}`
    : `Mô tả video gốc:\n${video.description}`;

  const prompt = `Bạn là chuyên gia sáng tạo nội dung TikTok Việt Nam hàng đầu.

${sourceContent}

Hashtags gốc: ${video.hashtags?.join(' ') || ''}

Nhiệm vụ của bạn:
1. Phân tích chính xác tình huống, cảm xúc và nhân vật trong video gốc.
2. Tạo kịch bản Tiếng Việt hấp dẫn, BÁM SÁT 100% VÀO ĐÚNG CHỦ ĐỀ GỐC (Ví dụ: Em bé/Baby -> Thuyết minh lồng tiếng em bé hài hước cute; Funny -> Câu thoại troll nhí nhảnh; Gym -> Động lực thể thao; Code -> Mẹo lập trình).
3. ĐỘ DÀI KỊCH BẢN CỰC KỲ NẮNG GỌN:
   - Chỉ viết khoảng 25 - 45 từ Tiếng Việt (khoảng 1-3 câu ngắn).
   - Tuyệt đối KHÔNG viết dài lê thê lan man. Cần cô đọng, tự nhiên, nhịp điệu nhanh để đọc vừa khít với thời lượng video ngắn TikTok.
4. Ngôn từ gần gũi, dí dỏm, phong cách GenZ TikTok Việt Nam.

Trả về JSON format CHÍNH XÁC như sau (không thêm markdown code blocks):
{
  "script": "Kịch bản đọc thoại Tiếng Việt ngắn gọn (25-45 từ, nhịp điệu nhanh dí dỏm)",
  "caption": "Caption TikTok cuốn hút dưới 100 ký tự Tiếng Việt",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "title": "Tiêu đề tiếng Việt ngắn gọn cho video (3-6 từ)"
}`;

  const modelsToTry = [config.gemini.model, 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-2.0-flash'];

  for (const modelName of modelsToTry) {
    try {
      logger.info(MODULE, `Đang gọi Gemini AI model: ${modelName}...`);
      const model = ai.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();

      // Parse JSON từ response
      let parsed;
      try {
        const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        parsed = JSON.parse(clean);
      } catch {
        logger.warn(MODULE, 'Không parse được JSON từ response AI');
        continue;
      }

      logger.success(MODULE, `✅ Kịch bản AI tạo xong (${modelName}): "${parsed.title}"`);
      logger.info(MODULE, `Script preview: ${parsed.script.substring(0, 100)}...`);
      return parsed;

    } catch (error) {
      logger.warn(MODULE, `Model ${modelName} báo lỗi: ${error.message.split('\n')[0]}`);
      // Nếu là lỗi 429 -> chờ 3 giây rồi thử model tiếp theo
      if (error.message.includes('429') || error.message.includes('Quota')) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  logger.warn(MODULE, 'Tất cả model Gemini đều bận/hết quota, dùng kịch bản mẫu');
  return getMockScript(video);
}

/**
 * Tạo kịch bản mẫu khi chưa có API key
 */
function getMockScript(video) {
  const desc = (video.description || video.title || '').toLowerCase();
  const tags = (video.hashtags || []).join(' ').toLowerCase();
  const fullText = desc + ' ' + tags;

  if (fullText.includes('baby') || fullText.includes('kid') || fullText.includes('cute') || fullText.includes('child')) {
    return {
      title: 'Em Bé Siêu Đáng Yêu Dễ Thương',
      script: 'Mọi người xem khoảnh khắc em bé đáng yêu này nè! Đúng là sự cute có thể chữa lành mọi mệt mỏi sau một ngày làm việc vất vả. Thả tim và follow để xem thêm nhiều clip đáng yêu mỗi ngày nhé!',
      caption: 'Sự đáng yêu chữa lành mọi mệt mỏi 👶❤️ #baby #cute #family #viral',
      hashtags: ['#baby', '#cute', '#family', '#beiu', '#tiktok'],
    };
  }

  if (fullText.includes('prank') || fullText.includes('funny') || fullText.includes('lol') || fullText.includes('humor')) {
    return {
      title: 'Khoảnh Khắc Hài Hước Cười Bể Bụng',
      script: 'Bó tay với tình huống hài hước này luôn mọi người ơi! Xem đi xem lại vẫn không nhặt được mồm. Ai thấy hài thì thả tim và tag đứa bạn thân vào coi chung nha!',
      caption: 'Xem xong cười bể bụng luôn kkk 😂 #funny #humor #haihuoc #prank',
      hashtags: ['#funny', '#haihuoc', '#prank', '#cuoi', '#viral'],
    };
  }

  return {
    title: video.description ? video.description.substring(0, 30) : 'Video Trend Hấp Dẫn',
    script: `Khoảnh khắc siêu cuốn hút từ @${video.author || 'creator'}! Cùng xem và thảo luận phía dưới bình luận nhé. Đừng quên thả tim và đăng ký kênh!`,
    caption: `${video.description ? video.description.substring(0, 80) : 'Video trend hot hôm nay!'} 🚀 #trending #viral`,
    hashtags: video.hashtags && video.hashtags.length ? video.hashtags : ['#trending', '#viral', '#video'],
  };
}

module.exports = { generateVietnameseScript };
