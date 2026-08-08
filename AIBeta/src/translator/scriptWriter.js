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

  const prompt = `Bạn là chuyên gia tạo nội dung TikTok Việt Nam trong lĩnh vực công nghệ/lập trình.

${sourceContent}

Hashtags gốc: ${video.hashtags?.join(' ') || ''}

Nhiệm vụ của bạn:
1. Phân tích nội dung video gốc (Tiếng Anh)
2. Tạo kịch bản HOÀN TOÀN MỚI bằng Tiếng Việt (KHÔNG dịch từng từ, hãy viết lại theo phong cách riêng)
3. Phong cách: Ngắn gọn, hấp dẫn, phù hợp TikTok 60-90 giây
4. Thêm góc nhìn thực tế từ developer Việt Nam

Trả về JSON format CHÍNH XÁC như sau (không thêm markdown code blocks):
{
  "script": "Kịch bản đọc to cho video (60-90 giây, khoảng 150-200 từ Tiếng Việt)",
  "caption": "Caption TikTok hấp dẫn dưới 150 ký tự Tiếng Việt",
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"],
  "title": "Tiêu đề ngắn gọn cho video (5-8 từ)"
}`;

  try {
    const model = ai.getGenerativeModel({ model: config.gemini.model });
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Parse JSON từ response
    let parsed;
    try {
      // Xử lý nếu Gemini bọc trong ```json ... ```
      const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      logger.warn(MODULE, 'Không parse được JSON, dùng kịch bản mẫu');
      return getMockScript(video);
    }

    logger.success(MODULE, `Kịch bản tạo xong: "${parsed.title}"`);
    logger.info(MODULE, `Script preview: ${parsed.script.substring(0, 100)}...`);

    return parsed;
  } catch (error) {
    logger.error(MODULE, `Gemini API lỗi: ${error.message}`);
    return getMockScript(video);
  }
}

/**
 * Tạo kịch bản mẫu khi chưa có API key
 */
function getMockScript(video) {
  const mockScripts = [
    {
      title: '5 Mẹo Python Bạn Chưa Biết',
      script: 'Chào mọi người! Hôm nay mình chia sẻ 5 mẹo Python siêu hữu ích mà ít developer biết đến. Thứ nhất, dùng f-string thay vì format để code ngắn hơn nhiều. Thứ hai, list comprehension giúp code của bạn pythonic hơn. Thứ ba, walrus operator trong Python 3.8 giúp gán và kiểm tra trong cùng một dòng. Thứ tư, dùng dataclass thay vì namedtuple cho code dễ đọc hơn. Và thứ năm, pathlib thay thế os.path giúp xử lý đường dẫn file dễ hơn nhiều. Thử ngay và cho mình biết bạn thích mẹo nào nhất nhé!',
      caption: '5 mẹo Python mà 90% developer Việt chưa biết 🐍🔥 #python #coding #developer',
      hashtags: ['#python', '#lậptrình', '#developer', '#coding', '#tips'],
    },
    {
      title: 'AI Tool Tiết Kiệm 3 Giờ Mỗi Ngày',
      script: 'Mình đã tìm ra công cụ AI này và nó thay đổi hoàn toàn cách mình làm việc. Thay vì mất cả buổi viết code từ đầu, giờ mình chỉ cần mô tả vấn đề và AI tự động sinh code. Không phải lúc nào cũng hoàn hảo nhưng tiết kiệm ít nhất 3 tiếng mỗi ngày. Mình sẽ làm video chi tiết về cách dùng hiệu quả nhất. Follow để không bỏ lỡ nhé!',
      caption: 'Tool AI này giúp mình code nhanh gấp 3x 🤖💻 Chia sẻ anh em dev cùng biết!',
      hashtags: ['#ai', '#developer', '#productivity', '#coding', '#aitools'],
    },
  ];

  const mock = mockScripts[Math.floor(Math.random() * mockScripts.length)];
  logger.warn(MODULE, `⚠️  Dùng kịch bản MẪU: "${mock.title}" — Cấu hình GEMINI_API_KEY để dùng thật!`);
  return mock;
}

module.exports = { generateVietnameseScript };
