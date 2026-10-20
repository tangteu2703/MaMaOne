// ==========================================
// STUDIO / STORY SPEC
// Đọc truyện (JSON hoặc TXT) → chuẩn hoá thành { title, segments:[{text,imagePrompt}], globalPrompt }
// ==========================================

const TEXT_KEYS = ['text', 'voice', 'narration', 'content', 'script', 'caption'];
const PROMPT_KEYS = ['imagePrompt', 'image_prompt', 'prompt', 'imageprompt', 'promptImage', 'image'];
const LIST_KEYS = ['segments', 'scenes', 'items', 'parts', 'paragraphs', 'sentences'];
const GLOBAL_KEYS = ['globalPrompt', 'global_prompt', 'stylePrompt', 'style_prompt', 'commonPrompt', 'characterPrompt'];
// Nhiều ảnh cho 1 đoạn text: "shots": ["prompt", {"imagePrompt": "..."}, ...] hoặc "imagePrompts": [...]
const SHOT_KEYS = ['shots', 'imagePrompts', 'image_prompts', 'prompts'];

/** Lấy danh sách prompt ảnh (shots) của 1 phần tử; trả [] nếu không khai báo */
function pickShots(it) {
  if (!it || typeof it !== 'object') return [];
  const key = SHOT_KEYS.find((k) => Array.isArray(it[k]));
  if (!key) return [];
  return it[key]
    .map((s) => (typeof s === 'string' ? s.trim() : pickString(s || {}, PROMPT_KEYS)))
    .filter(Boolean);
}

const pickString = (obj, keys) => {
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
  return '';
};

const cleanText = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Chia văn bản thuần thành các đoạn ~targetWords từ theo ranh giới câu */
function splitTextToSegments(text, targetWords = 18) {
  const sentences = String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .flatMap((para) => para.match(/[^.!?…]+[.!?…]+["”')\]]*|[^.!?…]+$/g) || [])
    .map(cleanText)
    .filter(Boolean);

  const segments = [];
  let cur = [];
  let words = 0;
  for (const s of sentences) {
    const w = s.split(' ').length;
    if (cur.length && words + w > targetWords * 1.4) {
      segments.push(cur.join(' '));
      cur = [];
      words = 0;
    }
    cur.push(s);
    words += w;
    if (words >= targetWords) {
      segments.push(cur.join(' '));
      cur = [];
      words = 0;
    }
  }
  if (cur.length) segments.push(cur.join(' '));
  return segments;
}

/**
 * @param {string} content  nội dung file (JSON hoặc TXT)
 * @param {string} fileName tên file (để đặt tiêu đề mặc định)
 */
function parseStory(content, fileName = '') {
  const warnings = [];
  const raw = String(content || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('File truyện rỗng');

  const defaultTitle = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Truyện không tên';
  let title = defaultTitle;
  let globalPrompt = '';
  let items = [];

  if (/^[[{]/.test(raw)) {
    let data;
    try { data = JSON.parse(raw); } catch (e) { throw new Error('JSON không hợp lệ: ' + e.message); }
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === 'object') {
      title = pickString(data, ['title', 'name', 'tieuDe']) || title;
      globalPrompt = pickString(data, GLOBAL_KEYS);
      const listKey = LIST_KEYS.find((k) => Array.isArray(data[k]));
      if (listKey) items = data[listKey];
      else if (typeof data.text === 'string') items = splitTextToSegments(data.text).map((text) => ({ text }));
      else throw new Error('JSON cần có mảng "segments" (mỗi phần tử gồm text + imagePrompt)');
    } else {
      throw new Error('JSON không đúng định dạng');
    }
  } else {
    items = splitTextToSegments(raw).map((text) => ({ text }));
    warnings.push('File TXT không có prompt ảnh → dùng chính câu văn làm prompt. Nên dùng JSON có imagePrompt để ảnh đẹp và đúng nội dung.');
  }

  const segments = [];
  let missingPrompt = 0;
  items.forEach((it, idx) => {
    const text = cleanText(typeof it === 'string' ? it : pickString(it || {}, TEXT_KEYS));
    if (!text) { warnings.push(`Bỏ qua phần tử #${idx + 1}: không có text`); return; }
    const shots = pickShots(it);
    let imagePrompt = typeof it === 'object' && it ? pickString(it, PROMPT_KEYS) : '';
    if (!imagePrompt && shots.length) imagePrompt = shots[0];
    if (!imagePrompt) { missingPrompt++; imagePrompt = `Illustration for the narration: ${text}`; }
    segments.push({ text, imagePrompt, shots: shots.length ? shots : [imagePrompt] });
  });

  if (!segments.length) throw new Error('Không tìm thấy đoạn nào có text');
  if (missingPrompt && missingPrompt !== segments.length) warnings.push(`${missingPrompt} đoạn thiếu imagePrompt → dùng câu văn làm prompt`);

  const words = segments.reduce((n, s) => n + s.text.split(' ').length, 0);
  const images = segments.reduce((n, s) => n + s.shots.length, 0);
  return {
    title,
    globalPrompt,
    segments,
    warnings,
    stats: {
      segments: segments.length,
      withPrompt: segments.length - missingPrompt,
      images,
      words,
      estMinutes: Math.round((words / 2.5 / 60) * 10) / 10, // ~150 từ/phút
    },
  };
}

module.exports = { parseStory, splitTextToSegments };
