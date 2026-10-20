// ==========================================
// STUDIO / MOTIONS
// Bộ hiệu ứng Ken Burns (zoom / pan) cho từng clip ảnh, sinh biểu thức cho filter zoompan của FFmpeg
// ==========================================

/** PRNG có seed → cùng job luôn ra cùng chuyển động (an toàn khi chạy tiếp) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// z0/z1: mức zoom đầu/cuối; ax*/ay*: vị trí khung nhìn (0 = sát trái/trên, 1 = sát phải/dưới)
const zoomAmount = (r) => 0.14 + r() * 0.10;   // 14% – 24%
const panZoom = (r) => 1.18 + r() * 0.08;      // zoom cố định khi pan

const MOTIONS = {
  zoom_in:         (r) => ({ z0: 1, z1: 1 + zoomAmount(r), ax0: 0.5, ax1: 0.5, ay0: 0.5, ay1: 0.5 }),
  zoom_out:        (r) => ({ z0: 1 + zoomAmount(r), z1: 1, ax0: 0.5, ax1: 0.5, ay0: 0.5, ay1: 0.5 }),
  zoom_in_left:    (r) => ({ z0: 1, z1: 1 + zoomAmount(r), ax0: 0.2, ax1: 0.2, ay0: 0.45, ay1: 0.45 }),
  zoom_in_right:   (r) => ({ z0: 1, z1: 1 + zoomAmount(r), ax0: 0.8, ax1: 0.8, ay0: 0.45, ay1: 0.45 }),
  zoom_out_top:    (r) => ({ z0: 1 + zoomAmount(r), z1: 1, ax0: 0.5, ax1: 0.5, ay0: 0.1, ay1: 0.1 }),
  pan_right:       (r) => { const z = panZoom(r); return { z0: z, z1: z, ax0: 0, ax1: 1, ay0: 0.5, ay1: 0.5 }; },
  pan_left:        (r) => { const z = panZoom(r); return { z0: z, z1: z, ax0: 1, ax1: 0, ay0: 0.5, ay1: 0.5 }; },
  pan_down:        (r) => { const z = panZoom(r); return { z0: z, z1: z, ax0: 0.5, ax1: 0.5, ay0: 0, ay1: 1 }; },
  pan_up:          (r) => { const z = panZoom(r); return { z0: z, z1: z, ax0: 0.5, ax1: 0.5, ay0: 1, ay1: 0 }; },
  diag_down_right: (r) => { const z = panZoom(r); return { z0: z, z1: z, ax0: 0, ax1: 1, ay0: 0, ay1: 1 }; },
  diag_up_left:    (r) => { const z = panZoom(r); return { z0: z, z1: z, ax0: 1, ax1: 0, ay0: 1, ay1: 0 }; },
  diag_down_left:  (r) => { const z = panZoom(r); return { z0: z, z1: z, ax0: 1, ax1: 0, ay0: 0, ay1: 1 }; },
};
const MOTION_NAMES = Object.keys(MOTIONS);

/** Chọn chuyển động cho từng clip, tránh lặp lại 2 clip gần nhất */
function assignMotions(count, seedText) {
  const rng = mulberry32(hashString(String(seedText)));
  const out = [];
  for (let i = 0; i < count; i++) {
    const recent = out.slice(-2).map((m) => m.name);
    const pool = MOTION_NAMES.filter((n) => !recent.includes(n));
    const name = pool[Math.floor(rng() * pool.length)];
    out.push({ name, params: MOTIONS[name](rng) });
  }
  return out;
}

const r4 = (n) => Number(n.toFixed(4));

/**
 * Biểu thức zoompan, chuyển động TUYẾN TÍNH (đều tốc độ). Không dùng easing ở đầu/cuối vì mỗi clip
 * nối bằng cú cắt → clip tăng/giảm tốc về 0 sẽ gây cảm giác "khựng" tại mỗi mốc chuyển ảnh.
 * @param {object} p  tham số chuyển động
 * @param {number} frames số khung hình của clip
 */
function zoompanExpr(p, frames) {
  const e = `(on/${Math.max(1, frames)})`;
  const lerp = (a, b) => (a === b ? `${r4(a)}` : `(${r4(a)}+(${r4(b - a)})*${e})`);
  return {
    z: lerp(p.z0, p.z1),
    x: `(iw-iw/zoom)*${lerp(p.ax0, p.ax1)}`,
    y: `(ih-ih/zoom)*${lerp(p.ay0, p.ay1)}`,
  };
}

module.exports = { assignMotions, zoompanExpr, MOTION_NAMES };
