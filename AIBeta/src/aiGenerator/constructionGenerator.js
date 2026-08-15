// ==========================================
// MODULE: AI VIDEO GENERATOR (0đ - Construction & Storytelling)
// Quy trình: Gemini AI -> Pollinations.ai (Free) -> Edge-TTS -> FFmpeg
// ==========================================
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const config = require('../../config/config');
const logger = require('../logger');
const { generateVoice } = require('../tts/voiceGenerator');

const MODULE = 'AIVideoGen';

/**
 * Tải file từ URL về máy
 */
function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirect
        return downloadFile(response.headers.location, outputPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`Tải ảnh thất bại HTTP Status: ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(outputPath));
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

/**
 * Gọi Gemini AI sinh kịch bản & prompt sinh ảnh 5 giai đoạn
 */
async function generateScriptAndPrompts(topic, stepCount = 5) {
  logger.info(MODULE, `Tạo kịch bản AI cho chủ đề: "${topic}" (${stepCount} bước)`);

  const apiKey = config.gemini.apiKey;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    logger.warn(MODULE, 'GEMINI_API_KEY chưa cấu hình, dùng kịch bản mẫu');
    return getMockConstructionScript(topic, stepCount);
  }

  const candidateModels = [
    'gemini-3.5-flash',
    'gemini-3.7-flash',
    'gemini-flash-latest',
    'gemini-1.5-flash',
    'gemini-2.5-flash',
    config.gemini.model,
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const genAI = new GoogleGenerativeAI(apiKey);
  const promptText = `Bạn là đạo diễn kịch bản video AI chuyên nghiệp cho TikTok/Shorts/Reels.
Chủ đề video người dùng yêu cầu: "${topic}"

NHIỆM VỤ:
Hãy phân tích kỹ chủ đề "${topic}" và chia quá trình này thành đúng ${stepCount} giai đoạn hình ảnh (từ khi bắt đầu/hỏng hóc/sơ khai đến khi hoàn thiện lộng lẫy).

QUY TẮC BẮT BUỘC ĐỂ CHUỖI ẢNH ĐÚNG CHỦ ĐỀ VÀ LIÊN MẠCH LOGIC:
1. KHÔNG ĐƯỢC NHẦM SANG XÂY NHÀ nếu chủ đề không phải xây nhà!
   - Nếu chủ đề là "Phục chế xe máy cổ": Bối cảnh BẮT BUỘC là garage/xưởng sửa xe (workshop). Bước 1: Xác xe máy cổ rỉ sét hỏng hóc. Bước 2: Tháo rời linh kiện động cơ. Bước 3: Sửa chữa sơn lại khung xe. Bước 4: Lắp ráp các bộ phận mới. Bước 5: Chiếc xe máy cổ hoàn thiện mới lộng lẫy kiêu hãnh.
   - Nếu chủ đề là "Lắp LEGO": Bối cảnh là bàn làm việc. Bước 1: Mảnh lego rời rạc -> ... -> Bước 5: Mô hình LEGO hoàn chỉnh.
   - Nếu chủ đề là "Xây nhà": Bối cảnh là công trường. Bước 1: Đất trống -> ... -> Bước 5: Biệt thự hoàn thiện.

2. QUY TẮC PHÂN ĐOẠN THEO THỜI GIAN (TIMELAPSE STAGE):
   - Phải giữ CÙNG MỘT BỐI CẢNH (workshop/garage/desk/construction site) và CÙNG GÓC MÁY CỐ ĐỊNH (same fixed tripod camera angle).
   - Tuyệt đối KHÔNG đưa từ khóa kết quả "completed/restored/new" vào Prompt của các bước ban đầu (Bước 1-4).

Yêu cầu output JSON duy nhất (không bọc thêm markdown):
{
  "title": "Tiêu đề hấp dẫn ngắn gọn (5-8 từ)",
  "script": "Lời đọc thuyết minh hấp dẫn 45-60 giây bằng Tiếng Việt",
  "caption": "Caption TikTok hấp dẫn kèm hashtag",
  "steps": [
    {
      "step": 1,
      "title": "Tên ngắn giai đoạn 1",
      "prompt": "Detailed English prompt for step 1 describing exact stage 1 visual, same fixed camera angle, photorealistic 8k",
      "narration": "Lời thuyết minh cho bước 1"
    }
  ]
}`;

  for (const modelName of candidateModels) {
    try {
      logger.info(MODULE, `Đang thử gọi Gemini model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(promptText);
      const text = result.response.text().trim();

      const cleanJson = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      if (parsed.steps && Array.isArray(parsed.steps)) {
        logger.success(MODULE, `Tạo kịch bản AI theo chủ đề "${topic}" thành công với model: ${modelName}`);
        return parsed;
      }
    } catch (err) {
      logger.warn(MODULE, `Model ${modelName} không phản hồi: ${err.message?.split('\n')[0]}`);
    }
  }

  logger.warn(MODULE, 'Tất cả model Gemini đều không phản hồi, chuyển sang kịch bản mẫu phù hợp chủ đề');
  return getMockConstructionScript(topic, stepCount);
}

/**
 * Kịch bản mẫu thông minh tự điều chỉnh theo từ khóa chủ đề (Xe cổ / LEGO / Xây nhà)
 */
function getMockConstructionScript(topic, stepCount = 5) {
  const t = topic.toLowerCase();
  const isCarOrBike = t.includes('xe') || t.includes('phục chế') || t.includes('restoration') || t.includes('motor') || t.includes('car');
  const isLego = t.includes('lego');

  if (isCarOrBike) {
    return {
      title: 'Hành Trình Phục Chế Xe Cổ Rỉ Sét',
      script: 'Bắt đầu từ một xác xe máy cổ cũ hỏng, phủ đầy rỉ sét và bụi bẩn trong góc xưởng. Công đoạn tháo rời toàn bộ chi tiết máy và đánh bóng làm sạch từng bánh răng. Tiến hành sơn lại lớp vỏ kiêm tân trang khung gầm kiên cố. Lắp ráp lại hệ thống động cơ sáng bóng cùng phuộc nhún mới. Và đây là kết quả tuyệt vời: chiếc xe máy cổ được phục chế hoàn toàn mới lộng lẫy!',
      caption: 'Hành trình phục chế xe máy cổ từ xác xe cũ thành siêu phẩm 🛠️🏍️ #phucchexe #xeco #restoration #diy',
      steps: [
        {
          step: 1,
          title: "Giai Đoạn 1: Xác Xe Cổ Rỉ Sét",
          prompt: "An abandoned rusty damaged vintage motorcycle sitting inside a mechanic garage workshop, covered in dirt and rust, flat tires, NO restored car, same fixed eye-level tripod camera angle, realistic lighting, photorealistic 8k",
          narration: "Bắt đầu từ một xác xe máy cổ cũ hỏng, phủ đầy rỉ sét và bụi bẩn trong góc xưởng..."
        },
        {
          step: 2,
          title: "Giai Đoạn 2: Tháo Rời & Làm Sạch",
          prompt: "The vintage motorcycle completely disassembled into individual engine parts, gears, and frame on mechanic garage floor, mechanic tools around, rusty parts being cleaned, same fixed eye-level tripod camera angle, photorealistic 8k",
          narration: "Công đoạn tháo rời toàn bộ chi tiết máy và đánh bóng làm sạch từng bánh răng."
        },
        {
          step: 3,
          title: "Giai Đoạn 3: Sơn Tân Trang Khung Xe",
          prompt: "The motorcycle frame being painted with fresh shiny metallic paint inside a professional spray booth in workshop, bare metallic frame, same fixed eye-level tripod camera angle, photorealistic 8k",
          narration: "Tiến hành sơn lại lớp vỏ kiêm tân trang khung gầm kiên cố."
        },
        {
          step: 4,
          title: "Giai Đoạn 4: Lắp Động Cơ & Bánh Xe",
          prompt: "Mechanic reassembling the clean shiny engine and chrome wheels back onto the freshly painted motorcycle frame inside workshop, same fixed eye-level tripod camera angle, photorealistic 8k",
          narration: "Lắp ráp lại hệ thống động cơ sáng bóng cùng phuộc nhún mới."
        },
        {
          step: 5,
          title: "Giai Đoạn 5: Phục Chế Hoàn Thiện",
          prompt: "Fully restored pristine condition vintage classic motorcycle, gleaming chrome accents, glossy custom paint job, polished leather seat, standing proud inside clean workshop, same fixed eye-level tripod camera angle, automotive photography, photorealistic 8k",
          narration: "Và đây là kết quả tuyệt vời: chiếc xe máy cổ được phục chế hoàn toàn mới lộng lẫy!"
        }
      ].slice(0, stepCount)
    };
  }

  if (isLego) {
    return {
      title: 'Hành Trình Lắp Ráp LEGO Siêu Xe',
      script: 'Bắt đầu mở hộp với hàng trăm mảnh nhựa LEGO rời rạc trên bàn. Công đoạn lắp ráp bộ khung gầm dầm thép cốt lõi đầu tiên. Dần dần gắn động cơ V12 và hệ thống truyền động bánh xe. Lắp ráp vỏ xe màu đỏ kiêu hãnh và kính chắn gió. Và đây là chiếc LEGO siêu xe hoàn chỉnh lộng lẫy!',
      caption: 'Hành trình lắp ráp siêu xe LEGO từ A-Z 🧩🏎️ #lego #legotechnic #diy',
      steps: [
        {
          step: 1,
          title: "Giai Đoạn 1: Mở Hộp & Mảnh Rời",
          prompt: "Unopened LEGO box and hundreds of loose red and black plastic LEGO bricks scattered on wooden desk, NO completed car, sorting trays, top-down camera angle, sunny indoor studio lighting, photorealistic 8k",
          narration: "Bắt đầu mở hộp với hàng trăm mảnh nhựa LEGO rời rạc trên bàn..."
        },
        {
          step: 2,
          title: "Giai Đoạn 2: Dựng Khung Gầm",
          prompt: "Half-built LEGO chassis frame with visible gears and axle axles, loose bricks around, under construction, NO finished car body, wooden desk, top-down camera angle, photorealistic 8k",
          narration: "Công đoạn lắp ráp bộ khung gầm dầm thép cốt lõi đầu tiên."
        },
        {
          step: 3,
          title: "Giai Đoạn 3: Lắp Động Cơ & Bánh Xe",
          prompt: "LEGO model with engine block and 4 rubber sports tires attached to chassis, NO outer red car body shell, workbench, top-down camera angle, photorealistic 8k",
          narration: "Dần dần gắn động cơ V12 và hệ thống truyền động bánh xe."
        },
        {
          step: 4,
          title: "Giai Đoạn 4: Gắn Vỏ Xe Ngoại Thất",
          prompt: "Nearly finished red LEGO sports car with half of outer body panels installed, windscreen fitted, top-down camera angle, photorealistic 8k",
          narration: "Lắp ráp vỏ xe màu đỏ kiêu hãnh và kính chắn gió."
        },
        {
          step: 5,
          title: "Giai Đoạn 5: Siêu Xe LEGO Hoàn Thiện",
          prompt: "Fully completed shiny red LEGO Technic Lamborghini sports car model, perfectly assembled on polished wooden desk, studio showcase lighting, photorealistic 8k",
          narration: "Và đây là chiếc LEGO siêu xe hoàn chỉnh lộng lẫy!"
        }
      ].slice(0, stepCount)
    };
  }

  // Mặc định: Kịch bản Xây Nhà 5 Giai Đoạn Thi Công Thật
  const steps = [
    {
      step: 1,
      title: "Giai Đoạn 1: Nền Đất Trống & Cắm Cọc",
      prompt: "Overcast empty vacant dirt land plot, wooden measuring stakes stuck in ground, land surveyor equipment tripod, NO house, NO building, raw empty soil, same fixed eye-level tripod camera angle from front yard, sunny daytime, photorealistic 8k",
      narration: "Bắt đầu từ một mảnh đất trống chưa có gì ngoài cỏ dại và các cọc mốc định vị..."
    },
    {
      step: 2,
      title: "Giai Đoạn 2: Đào Móng & Đan Thép",
      prompt: "Deep muddy excavated foundation pit on empty land plot, steel rebar mesh grid laid out, yellow CAT excavator in background, heavy construction site in progress, NO completed house, raw foundation stage, same fixed eye-level tripod camera angle from front yard, sunny daytime, photorealistic 8k",
      narration: "Công đoạn đào móng sâu và đan khung thép cốt thép được thực hiện cẩn thận."
    },
    {
      step: 3,
      title: "Giai Đoạn 3: Dựng Khung & Tường Thô",
      prompt: "Unfinished raw red brick wall house structure under construction, bare grey concrete columns, bamboo and steel scaffolding, open ceiling NO roof, construction site in progress, NO white paint, same fixed eye-level tripod camera angle from front yard, sunny daytime, photorealistic 8k",
      narration: "Từng dầm cột bê tông và hàng gạch thô mọc lên, định hình kiên cố nên căn nhà."
    },
    {
      step: 4,
      title: "Giai Đoạn 4: Trát Tường Xám & Lợp Mái",
      prompt: "House under construction stage, wet grey cement plaster being applied to exterior walls, dark roof tiles being installed, window frames fitted, unfinished house, scaffolding, same fixed eye-level tripod camera angle from front yard, sunny daytime, photorealistic 8k",
      narration: "Lợp mái hiện đại và trát hoàn thiện bề mặt tường ngoại thất."
    },
    {
      step: 5,
      title: "Giai Đoạn 5: Biệt Thự Hoàn Thiện",
      prompt: "Fully completed 2-storey modern minimalist white villa, pristine painted white exterior walls, dark slate roof tiles, black window frames, floor-to-ceiling glass, green manicured lawn, same fixed eye-level tripod camera angle from front yard, sunny daytime, architectural photography, photorealistic 8k",
      narration: "Và đây là kết quả hoàn chỉnh lộng lẫy, đúng chuẩn ngôi nhà mơ ước!"
    }
  ];

  return {
    title: topic.includes('nhà') ? 'Hành Trình Xây Nhà 2 Tầng' : 'Hành Trình Xây Dựng Hoàn Thiện',
    script: 'Bắt đầu từ một mảnh đất trống chưa có gì ngoài cỏ dại. Công đoạn đào móng và đổ bê tông cốt thép được thực hiện cẩn thận. Từng dầm cột bê tông và hàng gạch thô mọc lên, định hình kiên cố nên căn nhà. Lợp mái hiện đại và trát hoàn thiện bề mặt tường ngoại thất. Và đây là kết quả hoàn chỉnh lộng lẫy, đúng chuẩn ngôi nhà mơ ước!',
    caption: `Hành trình biến đất trống thành ngôi nhà mơ ước 🏡✨ #${topic.replace(/\s+/g, '')} #xaydung #timelapse`,
    steps: steps.slice(0, stepCount)
  };
}

/**
 * Sinh chuỗi ảnh qua Pollinations.ai API với callback realtime khi từng ảnh hoàn thành
 */
async function generateImagesFromPollinations(steps, videoId, isVertical = true, onStepImageCreated = null) {
  logger.info(MODULE, `Sinh ${steps.length} ảnh AI miễn phí qua Pollinations.ai...`);
  const imageResults = [];
  const width = isVertical ? 1080 : 1920;
  const height = isVertical ? 1920 : 1080;
  const seed = Math.floor(Math.random() * 900000) + 100000;

  for (let i = 0; i < steps.length; i++) {
    const item = steps[i];
    const encodedPrompt = encodeURIComponent(item.prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux`;
    const localFileName = `ai_${videoId}_step_${i + 1}.jpg`;
    const localPath = path.join(config.paths.downloads, localFileName);

    logger.info(MODULE, `[Giai đoạn ${i + 1}/${steps.length}] Tải ảnh từ Pollinations.ai...`);
    let imgObj = null;
    try {
      await downloadFile(imageUrl, localPath);
      imgObj = {
        step: item.step,
        title: item.title,
        prompt: item.prompt,
        narration: item.narration,
        localPath: localPath,
        publicUrl: `/downloads/${localFileName}`,
      };
      logger.success(MODULE, `Ảnh giai đoạn ${i + 1} tải thành công: ${localFileName}`);
    } catch (err) {
      logger.warn(MODULE, `Tải ảnh bước ${i + 1} thất bại: ${err.message}, dùng fallback placeholder`);
      imgObj = {
        step: item.step,
        title: item.title,
        prompt: item.prompt,
        narration: item.narration,
        localPath: null,
        publicUrl: 'https://via.placeholder.com/1080x1920?text=AI+Step+' + (i + 1),
      };
    }

    imageResults.push(imgObj);

    // Báo callback ngay khi sinh xong ảnh này
    if (typeof onStepImageCreated === 'function') {
      onStepImageCreated({
        videoId,
        totalSteps: steps.length,
        currentStepIndex: i + 1,
        image: imgObj,
      });
    }
  }

  return imageResults;
}

/**
 * Ghép chuỗi ảnh thành Video Slideshow Zoom/Pan với FFmpeg
 */
async function buildSlideshowVideo(images, audioPath, outputPath, isVertical = true) {
  return new Promise((resolve, reject) => {
    const width = isVertical ? 1080 : 1920;
    const height = isVertical ? 1920 : 1080;

    const validImages = images.filter(img => img.localPath && fs.existsSync(img.localPath));
    if (validImages.length === 0) {
      return reject(new Error('Không có ảnh hợp lệ nào để tạo video slideshow'));
    }

    const perImageDuration = 6; 
    const concatTxtPath = outputPath.replace('.mp4', '_concat.txt');
    let concatContent = '';
    validImages.forEach(img => {
      const escapedPath = img.localPath.replace(/\\/g, '/');
      concatContent += `file '${escapedPath}'\n`;
      concatContent += `duration ${perImageDuration}\n`;
    });
    const lastEscaped = validImages[validImages.length - 1].localPath.replace(/\\/g, '/');
    concatContent += `file '${lastEscaped}'\n`;

    fs.writeFileSync(concatTxtPath, concatContent, 'utf8');

    const cmd = [
      `"${config.paths.ffmpeg}"`,
      '-f', 'concat',
      '-safe', '0',
      '-i', `"${concatTxtPath}"`,
      '-i', `"${audioPath}"`,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(zoom+0.0015,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=${width}x${height}`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast',
      '-shortest',
      '-y',
      `"${outputPath}"`
    ].join(' ');

    logger.info(MODULE, 'Đang chạy FFmpeg dựng Slideshow Video AI...');

    exec(cmd, { timeout: 300000 }, (error) => {
      try { fs.unlinkSync(concatTxtPath); } catch {}

      if (error) {
        logger.warn(MODULE, `FFmpeg Zoompan thất bại (${error.message}), thử fallback đơn giản...`);
        buildSlideshowSimple(concatTxtPath, audioPath, outputPath, width, height)
          .then(resolve)
          .catch(reject);
      } else {
        logger.success(MODULE, 'Dựng Slideshow Video AI thành công!');
        resolve(outputPath);
      }
    });
  });
}

function buildSlideshowSimple(concatTxtPath, audioPath, outputPath, width, height) {
  return new Promise((resolve, reject) => {
    const cmd = [
      `"${config.paths.ffmpeg}"`,
      '-f', 'concat',
      '-safe', '0',
      '-i', `"${concatTxtPath}"`,
      '-i', `"${audioPath}"`,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-pix_fmt', 'yuv420p',
      '-shortest',
      '-y',
      `"${outputPath}"`
    ].join(' ');

    exec(cmd, (error) => {
      if (error) reject(new Error(`FFmpeg Slideshow Simple lỗi: ${error.message}`));
      else resolve(outputPath);
    });
  });
}

/**
 * Main Pipeline Orchestrator cho Tạo Video AI 0đ
 */
async function generateAIVideoPipeline(options, onProgress, onStepImageCreated) {
  const { topic = 'Xây dựng ngôi nhà 2 tầng hiện đại', stepCount = 5, isVertical = true } = options;
  const videoId = 'aivideo_' + Date.now();

  const report = (stepNum, stepName, percent, details) => {
    if (typeof onProgress === 'function') {
      onProgress({
        videoId,
        step: stepNum,
        stepName,
        stepPercent: percent,
        overallPercent: Math.round(((stepNum - 1) * 25) + (percent * 0.25)),
        details,
      });
    }
  };

  try {
    report(1, 'Gemini AI Tạo Kịch Bản 5 Giai Đoạn', 30, `Đang phân tích chủ đề: "${topic}"...`);
    const scriptData = await generateScriptAndPrompts(topic, stepCount);
    report(1, 'Gemini AI Tạo Kịch Bản 5 Giai Đoạn', 100, `Kịch bản xong: "${scriptData.title}"`);

    report(2, 'Pollinations.ai Sinh Ảnh HD', 40, `Đang sinh ${scriptData.steps.length} bức ảnh giai đoạn...`);
    const images = await generateImagesFromPollinations(scriptData.steps, videoId, isVertical, onStepImageCreated);
    report(2, 'Pollinations.ai Sinh Ảnh HD', 100, `Tải xong ${images.length} ảnh AI HD!`);

    report(3, 'Tạo Giọng Đọc Thuyết Minh (TTS)', 50, 'Đang tổng hợp giọng đọc Tiếng Việt...');
    const audioPath = await generateVoice(videoId, scriptData.script);
    report(3, 'Tạo Giọng Đọc Thuyết Minh (TTS)', 100, 'Giọng đọc xong!');

    report(4, 'FFmpeg Dựng Video Slideshow', 60, 'Đang ghép ảnh + audio + hiệu ứng zoom...');
    const finalVideoPath = path.join(config.paths.output, `${videoId}_final.mp4`);
    await buildSlideshowVideo(images, audioPath, finalVideoPath, isVertical);
    report(4, 'FFmpeg Dựng Video Slideshow', 100, 'Dựng video hoàn tất!');

    return {
      success: true,
      videoId,
      title: scriptData.title,
      script: scriptData.script,
      caption: scriptData.caption,
      images,
      videoUrl: `/output/${videoId}_final.mp4`,
    };
  } catch (error) {
    logger.error(MODULE, `Lỗi Pipeline Video AI: ${error.message}`);
    throw error;
  }
}

module.exports = {
  generateAIVideoPipeline,
  generateScriptAndPrompts,
};
