// ==========================================
// STUDIO / PLAN
// Từ thời lượng voice từng đoạn → lập kế hoạch cảnh (mỗi cảnh = 1 ảnh):
//  - đoạn có nhiều shots (nhiều prompt ảnh) được tách thành nhiều cảnh; ranh giới ảnh bám theo dấu câu
//    của lời đọc để ảnh đổi đúng lúc ý đổi, thời lượng mỗi cảnh chia theo độ dài phần lời tương ứng
//  - đoạn 1 prompt quá ngắn (< minSceneSec) được gộp với đoạn kế (nếu bật mergeShort và ảnh gộp không vượt maxSceneSec)
//  - mỗi ảnh chỉ chạy MỘT chuyển động liền mạch; chỉ tách clip khi cảnh dài bất thường (> LONG_SCENE_SEC)
// ==========================================
const store = require('../jobStore');
const { fmtDuration } = require('../mediaUtils');

const LONG_SCENE_SEC = 14;
const MIN_SHOT_SEC = 1.8;

/**
 * Chia thời lượng 1 đoạn text thành n phần theo tỉ lệ, cắt ở ranh giới câu (ưu tiên) hoặc mệnh đề
 * gần mốc i/n nhất. Trả về mảng n phần trăm (tổng = 1).
 */
function splitFractions(text, n) {
  const even = () => Array.from({ length: n }, () => 1 / n);
  if (n <= 1) return [1];
  const total = text.length || 1;
  const levels = [/[^.!?…]+[.!?…]+["”')\]]*|[^.!?…]+$/g, /[^.!?…,;:]+[.!?…,;:]+["”')\]]*|[^.!?…,;:]+$/g];
  for (const re of levels) {
    const pieces = text.match(re) || [];
    let acc = 0;
    const cuts = []; // vị trí (0..1) sau mỗi câu, trừ câu cuối
    pieces.slice(0, -1).forEach((p) => { acc += p.length; cuts.push(acc / total); });
    if (cuts.length < n - 1) continue;

    const picked = [];
    let prev = -1;
    for (let k = 1; k < n; k++) {
      const target = k / n;
      let best = -1;
      for (let c = prev + 1; c <= cuts.length - (n - k); c++) {
        if (best < 0 || Math.abs(cuts[c] - target) < Math.abs(cuts[best] - target)) best = c;
      }
      picked.push(cuts[best]);
      prev = best;
    }
    const bounds = [0, ...picked, 1];
    const fr = bounds.slice(1).map((b, i) => b - bounds[i]);
    // tránh cảnh quá ngắn so với đều nhau (tối thiểu 55% phần chia đều)
    if (fr.every((f) => f >= 0.55 / n)) return fr;
  }
  return even();
}

/** Gán mốc thời gian cho từng đoạn + tổng thời lượng */
function assignTimeline(job) {
  let t = 0;
  for (const seg of job.segments) {
    seg.start = t;
    seg.gap = job.options.gapSec;
    t += seg.voiceDur;
  }
  job.totalSec = t;
}

const shotCount = (seg) => (Array.isArray(seg.shots) ? seg.shots.length : 1);

function groupSegments(job) {
  const { minSceneSec, maxSceneSec, mergeShort } = job.options;
  const segs = job.segments;
  const groups = [];
  for (let i = 0; i < segs.length; i++) {
    const g = { segs: [segs[i]], dur: segs[i].voiceDur };
    // gộp đoạn ngắn (1 prompt) với đoạn kế (cũng 1 prompt) khi ảnh gộp vẫn không vượt maxSceneSec
    while (mergeShort && shotCount(segs[i]) <= 1 && g.dur < minSceneSec && i + 1 < segs.length
      && shotCount(segs[i + 1]) <= 1 && g.dur + segs[i + 1].voiceDur <= maxSceneSec) {
      i++;
      g.segs.push(segs[i]);
      g.dur += segs[i].voiceDur;
    }
    groups.push(g);
  }
  return groups;
}

/** Tạo job.scenes một lần (giữ nguyên khi chạy tiếp để không mất trạng thái ảnh) */
function run(job) {
  assignTimeline(job);
  if (job.scenes) return;

  const scenes = [];
  const pushScene = (segFrom, segTo, start, dur, prompt) => scenes.push({
    i: scenes.length,
    segFrom,
    segTo,
    start,
    dur,
    parts: Math.max(1, Math.ceil(dur / LONG_SCENE_SEC)),
    prompt,
    imageStatus: 'pending',
    imageFile: null,
    attempts: 0,
  });

  let multi = 0;
  for (const g of groupSegments(job)) {
    const seg = g.segs[0];
    const shots = g.segs.length === 1 && Array.isArray(seg.shots) ? seg.shots : [];
    // số ảnh tối đa mà thời lượng cho phép (mỗi ảnh tối thiểu MIN_SHOT_SEC)
    const n = Math.max(1, Math.min(shots.length, Math.floor(seg.voiceDur / MIN_SHOT_SEC)));

    if (n > 1) {
      const fr = splitFractions(seg.text, n);
      let t = seg.start;
      fr.forEach((f, k) => {
        const dur = k === n - 1 ? seg.start + seg.voiceDur - t : seg.voiceDur * f;
        pushScene(seg.i, seg.i, t, dur, shots[k]);
        t += dur;
      });
      multi += n - 1;
    } else {
      // prompt: lấy của đoạn có voice dài nhất trong nhóm
      const main = g.segs.reduce((best, s) => (s.voiceDur > best.voiceDur ? s : best), g.segs[0]);
      pushScene(g.segs[0].i, g.segs[g.segs.length - 1].i, g.segs[0].start, g.dur, main.imagePrompt);
    }
  }
  job.scenes = scenes;

  const merged = Math.max(0, job.segments.length - scenes.length + multi);
  const split = scenes.reduce((n, s) => n + (s.parts - 1), 0);
  store.jlog(job, 'info',
    `🗺️ Kế hoạch: ${job.segments.length} đoạn voice (${fmtDuration(job.totalSec)}) → ${scenes.length} ảnh `
    + `(~${(job.totalSec / scenes.length).toFixed(1)}s/ảnh), ${multi > 0 ? `tách thêm ${multi} ảnh từ shots, ` : ''}`
    + `${merged > 0 ? `gộp ${merged} đoạn ngắn, ` : ''}${split} lần tách chuyển động`);
  store.saveNow(job);
}

module.exports = { run };
