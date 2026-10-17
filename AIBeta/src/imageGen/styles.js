/**
 * Kiểu vẽ ảnh (art style) — được áp dụng cho TẤT CẢ prompt nhân vật + cảnh để ảnh cùng một phong cách.
 * Prompt do Gemini sinh ra chỉ nên mô tả NỘI DUNG; phần phong cách được ghép tự động ở đây.
 */
const STYLES = {
  anime: {
    label: 'Anime điện ảnh (Makoto Shinkai)',
    prefix: 'Anime cinematic style',
    suffix: 'Makoto Shinkai style, anime film quality, rich atmospheric lighting, ultra detailed background',
  },
  hd: {
    label: 'Ảnh HD chân thực (8K)',
    prefix: 'Photorealistic cinematic photograph',
    suffix: 'ultra realistic, natural lighting, sharp focus, shallow depth of field, 8K ultra detailed, film grain',
  },
  anime2d: {
    label: 'Hoạt hình 2D (cartoon)',
    prefix: '2D cartoon animation style',
    suffix: 'flat colors, bold clean outlines, cel shading, vibrant palette, simple shapes, hand-drawn animation look',
  },
  stickman: {
    label: 'Người que (stick figure)',
    prefix: 'Simple minimalist stick figure drawing, 2D black line art on plain white background',
    suffix: 'round circle head and thin stick lines for body and limbs, hand-drawn doodle, xkcd webcomic style, child drawing, no 3D, no realistic shading, no dark silhouette, no cloak',
    simpleChars: true,
  },
  ghibli: {
    label: 'Ghibli màu nước',
    prefix: 'Studio Ghibli inspired hand-painted watercolor animation style',
    suffix: 'soft watercolor textures, warm natural colors, lush painted background, gentle lighting',
  },
  webtoon: {
    label: 'Webtoon / Manhwa',
    prefix: 'Korean manhwa webtoon style',
    suffix: 'clean sharp line art, soft cel shading, vivid colors, dramatic composition, detailed digital illustration',
  },
  pixar3d: {
    label: '3D hoạt hình (Pixar)',
    prefix: '3D animated movie style, Pixar-like',
    suffix: 'stylized 3D render, soft global illumination, expressive characters, smooth textures, vibrant colors',
  },
  inkwash: {
    label: 'Thủy mặc cổ phong',
    prefix: 'Traditional Chinese ink wash painting style',
    suffix: 'sumi-e brush strokes, misty atmosphere, muted tones with subtle red accents, rice paper texture, elegant minimalism',
  },
  manga: {
    label: 'Manga đen trắng',
    prefix: 'Black and white Japanese manga style',
    suffix: 'high contrast ink linework, screentone shading, dramatic panels lighting, monochrome, detailed hatching',
  },
};

const DEFAULT_STYLE = 'anime';

// Các cụm (ngăn cách bằng dấu phẩy) mang tính "phong cách/chất lượng" cần bỏ khỏi prompt gốc để không mâu thuẫn với style đã chọn
const STYLE_WORDS = /\b(anime|makoto shinkai|studio ghibli|8k|4k|ultra[- ]?detailed|photorealistic|photo-?realistic|hyper-?realistic|masterpiece|film quality|cinematic style|art style|digital art|high quality|best quality|cel[- ]?shad\w*|manhwa|webtoon|pixar|3d render|watercolor|ink wash|manga|stick figure|stickman)\b/i;

function getStyle(id) {
  const key = STYLES[id] ? id : DEFAULT_STYLE;
  return { id: key, ...STYLES[key] };
}

function listStyles() {
  return Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label, isDefault: id === DEFAULT_STYLE }));
}

/** Bỏ các cụm style cũ (anime / 8K / Makoto Shinkai...) và prefix/suffix cũ nếu prompt đã bị bọc */
function stripStyleWords(prompt) {
  let str = String(prompt || '');
  Object.values(STYLES).forEach(s => {
    if (s.prefix && str.includes(s.prefix)) str = str.split(s.prefix).join('');
    if (s.suffix && str.includes(s.suffix)) str = str.split(s.suffix).join('');
  });
  return str
    .split(',')
    .map(p => p.trim())
    .filter(p => p && !(p.length <= 80 && STYLE_WORDS.test(p)))
    .join(', ');
}

/** Ghép style vào prompt: "<prefix>, <nội dung>, <suffix>" */
function applyStyle(prompt, styleId) {
  const st = getStyle(styleId);
  let body = stripStyleWords(prompt);

  // Riêng với style người que: lọc các từ khóa gây "bẫy sát thủ/concept art 3D" trong Stable Diffusion (SD-Turbo)
  if (st.id === 'stickman') {
    body = body
      .replace(/\b(corpse fisher|corpse|cadaver)\b/gi, 'fisherman')
      .replace(/\b(subtle eerie river fog ambiance|eerie fog|mist|fog|atmospheric lighting|volumetric lighting)\b/gi, '')
      .replace(/\b(straw cape|cape|cloak|robes?|trenchcoat)\b/gi, 'simple triangle doodle cape outline')
      .replace(/\b(realistic detail|hyperrealistic|photorealistic|cinematic|detailed|intricate)\b/gi, '')
      .replace(/,\s*,+/g, ',')
      .trim()
      .replace(/^,\s*|,\s*$/g, '');
  }

  return `${st.prefix}, ${body}, ${st.suffix}`;
}

module.exports = { STYLES, DEFAULT_STYLE, getStyle, listStyles, stripStyleWords, applyStyle };
