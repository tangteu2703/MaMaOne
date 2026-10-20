// ==========================================
// STUDIO / SUBTITLES
// Tạo file ASS: phụ đề (khớp thời gian giọng đọc từng đoạn) + tiêu đề video
// ==========================================

const toAssTime = (sec) => {
  sec = Math.max(0, sec);
  const cs = Math.round(sec * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

const escapeAss = (t) => String(t || '').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();

/** Chèn \N ở khoảng trắng gần giữa nhất nếu dòng dài hơn lineChars */
function breakLines(text, lineChars) {
  if (text.length <= lineChars) return text;
  const mid = text.length / 2;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return best < 0 ? text : `${text.slice(0, best)}\\N${text.slice(best + 1)}`;
}

/** Chia 1 đoạn văn thành các cue (tối đa 2 dòng, ưu tiên ngắt sau dấu câu) */
function splitCues(text, lineChars) {
  const limit = lineChars * 2;
  const cues = [];
  let cur = '';
  for (const w of text.trim().split(/\s+/)) {
    cur = cur ? `${cur} ${w}` : w;
    const next = cur.length;
    if (/[.!?…:;]$/.test(w) && next >= limit * 0.5) { cues.push(cur); cur = ''; continue; }
    if (next >= limit) { cues.push(cur); cur = ''; }
  }
  if (cur) cues.push(cur);
  // gộp cue cuối quá ngắn vào cue trước
  if (cues.length > 1 && cues[cues.length - 1].length < 12 && (cues[cues.length - 2].length + cues[cues.length - 1].length) <= limit * 1.25) {
    cues[cues.length - 2] += ' ' + cues.pop();
  }
  return cues.map((c) => breakLines(c, lineChars));
}

/** Kích thước/vị trí chữ theo khung hình */
function layoutFor(W, H) {
  const vertical = H > W;
  return vertical
    ? { sub: 62, title: 46, intro: 100, subMargin: 300, titleMargin: 130, lineChars: 24 }
    : { sub: 56, title: 40, intro: 84, subMargin: 64, titleMargin: 44, lineChars: 44 };
}

/**
 * @param {{title:string, segments:Array<{text:string,start:number,voiceDur:number,gap:number}>,
 *          totalSec:number, W:number, H:number, titlePosition:'top'|'bottom'|'none', titleIntro:boolean}} p
 */
function buildAss(p) {
  const { W, H } = p;
  const L = layoutFor(W, H);
  const font = 'Arial';
  const titleBottom = p.titlePosition === 'bottom';
  const titleAlign = titleBottom ? 2 : 8;
  const titleMargin = titleBottom ? L.subMargin + Math.round(L.sub * 2.7) : L.titleMargin;

  const lines = [];
  lines.push('[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '');
  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  lines.push(`Style: Sub,${font},${L.sub},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3.4,1,2,70,70,${L.subMargin},1`);
  lines.push(`Style: Title,${font},${L.title},&H0000D7FF,&H000000FF,&H8C000000,&H00000000,-1,0,0,0,100,100,1,0,3,12,0,${titleAlign},60,60,${titleMargin},1`);
  lines.push(`Style: Intro,${font},${L.intro},&H0000D7FF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,2,0,1,5,3,5,90,90,40,1`);
  lines.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  const title = escapeAss(p.title);
  if (title && p.titlePosition !== 'none') {
    lines.push(`Dialogue: 0,${toAssTime(0)},${toAssTime(p.totalSec)},Title,,0,0,0,,${title}`);
    if (p.titleIntro) {
      const end = Math.min(4.5, Math.max(2, p.totalSec * 0.5));
      lines.push(`Dialogue: 2,${toAssTime(0.2)},${toAssTime(end)},Intro,,0,0,0,,{\\fad(700,700)}${title}`);
    }
  }

  for (const seg of p.segments) {
    const speech = Math.max(0.4, seg.voiceDur - (seg.gap || 0));
    const cues = splitCues(seg.text.replace(/[{}]/g, ''), L.lineChars);
    const weights = cues.map((c) => c.replace(/\\N/g, ' ').length);
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    let t = seg.start;
    cues.forEach((cue, i) => {
      const dur = speech * (weights[i] / sum);
      const end = i === cues.length - 1 ? seg.start + seg.voiceDur : t + dur;
      lines.push(`Dialogue: 1,${toAssTime(t)},${toAssTime(end)},Sub,,0,0,0,,${cue}`);
      t += dur;
    });
  }
  return lines.join('\n') + '\n';
}

module.exports = { buildAss, splitCues, toAssTime };
