/**
 * Kiểu vẽ ảnh (art style) — được áp dụng cho TẤT CẢ prompt nhân vật + cảnh để ảnh cùng một phong cách.
 * Prompt do Gemini sinh ra chỉ nên mô tả NỘI DUNG; phần phong cách được ghép tự động ở đây.
 *
 * Lưu ý: đây là prompt TẠO ẢNH TĨNH (1 khung hình). Không dùng các từ gợi video/phim/animation
 * (animation, animated movie, whiteboard animation...) để tránh model hiểu sai hoặc sinh kết quả lỗi gây tốn chi phí gọi API.
 * Giữ prefix/suffix ngắn gọn (một số model như SD-Turbo chỉ đọc ~77 token đầu).
 */
const STYLES = {
  
  inkwash: {
    label: 'Thủy mặc cổ phong',
    prefix: 'Single still traditional Chinese ink wash painting',
    suffix: 'sumi-e brush strokes, misty atmosphere, muted tones with subtle red accents, rice paper texture, elegant minimalism',
  },
  manga: {
    label: 'Manga đen trắng',
    prefix: 'Single black and white Japanese manga illustration',
    suffix: 'high contrast ink linework, screentone shading, dramatic lighting, monochrome, detailed hatching',
  },
  anime: {
    label: 'Anime hoạt hình đáng yêu (ngộ nghĩnh)',
    prefix: 'Single still cute anime illustration, kawaii cartoon characters with chibi proportions',
    suffix: 'big sparkling eyes, soft pastel colors, clean bright lineart, cheerful whimsical mood, adorable charming anime look',
  },
  hd: {
    label: 'Ảnh HD chân thực (8K)',
    prefix: 'Single photorealistic photograph, cinematic still',
    suffix: 'ultra realistic, natural lighting, sharp focus, shallow depth of field, 8K ultra detailed, film grain',
  },
  eerie: {
    label: 'Ảnh cổ quái u ám (trinh thám kinh dị)',
    prefix: 'Single still eerie photograph, uncanny dark mystery atmosphere',
    suffix: 'soft focus, hazy low-key lighting, desaturated cold tones, deep murky shadows, heavy film grain, slightly surreal, unsettling mood',
  },
  anime2d: {
    label: 'Hoạt hình 2D (cartoon)',
    prefix: 'Single still 2D cartoon illustration',
    suffix: 'flat colors, bold clean outlines, cel shading, vibrant palette, simple shapes, hand-drawn cartoon look',
  },
  stickman: {
    label: 'Người que (stick figure)',
    prefix: 'Single still stick figure drawing, 2D black line art on plain white background',
    suffix: 'round circle head and thin stick lines for body and limbs, hand-drawn doodle, xkcd webcomic style, child drawing, no 3D, no realistic shading, no dark silhouette',
    simpleChars: true,
  },
  ghibli: {
    label: 'Ghibli màu nước',
    prefix: 'Single still hand-painted watercolor illustration, Studio Ghibli inspired',
    suffix: 'soft watercolor textures, warm natural colors, lush painted background, gentle lighting',
  },
};

// Prefix/suffix của phiên bản cũ — vẫn được bỏ ra nếu prompt đã lưu trước đó bị bọc bằng style cũ
const LEGACY_PARTS = [
  'Anime cinematic style',
  'Single still anime illustration, cinematic composition',
  'Makoto Shinkai style, rich atmospheric lighting, ultra detailed background',
  'Makoto Shinkai style, anime film quality, rich atmospheric lighting, ultra detailed background',
  'Photorealistic cinematic photograph',
  '2D cartoon animation style',
  'flat colors, bold clean outlines, cel shading, vibrant palette, simple shapes, hand-drawn animation look',
  'Simple minimalist stick figure drawing, 2D black line art on plain white background',
  'round circle head and thin stick lines for body and limbs, hand-drawn doodle, xkcd webcomic style, child drawing, no 3D, no realistic shading, no dark silhouette, no cloak',
  'Studio Ghibli inspired hand-painted watercolor animation style',
  'Korean manhwa webtoon style',
  '3D animated movie style, Pixar-like',
  'Traditional Chinese ink wash painting style',
  'Black and white Japanese manga style',
  'high contrast ink linework, screentone shading, dramatic panels lighting, monochrome, detailed hatching',
];

const DEFAULT_STYLE = 'anime';

// Các cụm (ngăn cách bằng dấu phẩy) mang tính "phong cách/chất lượng" cần bỏ khỏi prompt gốc để không mâu thuẫn với style đã chọn
// (gồm cả các từ gợi video/animation như whiteboard, animation, animated để prompt luôn rõ ràng là tạo ảnh tĩnh)
const STYLE_WORDS = /\b(anime|makoto shinkai|studio ghibli|8k|4k|ultra[- ]?detailed|photorealistic|photo-?realistic|hyper-?realistic|masterpiece|film quality|cinematic style|art style|digital art|high quality|best quality|cel[- ]?shad\w*|manhwa|webtoon|pixar|3d render|watercolor|ink wash|manga|stick figure|stickman|whiteboard|animation|animated|doodle)\b/i;

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
  const wrapped = [
    ...Object.values(STYLES).flatMap(s => [s.prefix, s.suffix]),
    ...LEGACY_PARTS,
  ];
  wrapped.forEach(part => {
    if (part && str.includes(part)) str = str.split(part).join('');
  });
  return str
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      // Cụm ngắn chứa từ khóa style nhưng có chủ thể ("stick figure of a ghost bride") → giữ lại phần chủ thể
      if (p.length <= 80 && STYLE_WORDS.test(p)) {
        const m = p.match(/\bof\s+((?:an?|the)\s+.+)$/i);
        return m ? m[1].trim() : '';
      }
      return p;
    })
    .filter(Boolean)
    .join(', ');
}

/** Ghép style vào prompt: "<prefix>, <nội dung>, <suffix>" */
function applyStyle(prompt, styleId) {
  const st = getStyle(styleId);
  let body = stripStyleWords(prompt);

  if (st.id === 'stickman') {
    // Riêng với style người que: lọc các từ khóa gây "bẫy sát thủ/concept art 3D" trong Stable Diffusion (SD-Turbo)
    body = body
      .replace(/\b(corpse fisher|corpse|cadaver)\b/gi, 'fisherman')
      .replace(/\b(subtle eerie river fog ambiance|eerie fog|mist|fog|atmospheric lighting|volumetric lighting)\b/gi, '')
      .replace(/\b(straw cape|cape|cloak|trenchcoat)\b/gi, 'simple triangle outfit')
      .replace(/\brobes?\b/gi, 'gown')
      // bỏ cả "no realistic detail" (tránh để sót chữ "no" lẻ) và các từ gây nhiễu style
      .replace(/\b(?:no\s+)?(realistic details?|hyperrealistic|photorealistic|cinematic|detailed|intricate)\b/gi, '')
      .split(',')
      .map(p => p.trim())
      // nền đã được prefix quy định (trắng) → bỏ mô tả nền trong body để không mâu thuẫn
      .filter(p => p && !/\bbackground\b/i.test(p) && !/\bevery character drawn as\b/i.test(p))
      .join(', ');
  } else {
    // Style khác người que: bỏ mọi cụm nhắc "stick figure/stickman" (kể cả cụm dài) để không làm nhiễu style đã chọn
    body = body
      .split(',')
      .map(p => p.trim())
      .filter(p => p && !/\b(stick figure|stickman)\b/i.test(p) && !/^no realistic detail/i.test(p))
      .join(', ');
  }

  return [st.prefix, body, st.suffix].filter(Boolean).join(', ');
}

module.exports = { STYLES, DEFAULT_STYLE, getStyle, listStyles, stripStyleWords, applyStyle };
