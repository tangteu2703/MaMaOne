// Thanh kéo chỉnh độ rộng khung trái (form) / phải (tiến trình)
// Kéo chuột/cảm ứng, phím ← →, bấm đúp để về mặc định; lưu lại độ rộng giữa các lần mở.
import { $, storage } from './utils.js';

const KEY = 'studio.layout.v1';
const DEFAULT_W = 340;
const MIN_W = 260;
const KEY_STEP = 20;

export function initSplitter() {
  const layout = $('.layout');
  const bar = $('#splitter');
  if (!layout || !bar) return;

  const maxW = () => Math.max(MIN_W + 40, Math.min(900, layout.clientWidth - 360));
  const clamp = (w) => Math.round(Math.min(maxW(), Math.max(MIN_W, w)));
  let width = clamp(Number(storage.get(KEY, { panelW: DEFAULT_W }).panelW) || DEFAULT_W);

  const apply = (w, save = true) => {
    width = clamp(w);
    layout.style.setProperty('--panel-w', `${width}px`);
    bar.setAttribute('aria-valuenow', String(width));
    bar.setAttribute('aria-valuemin', String(MIN_W));
    bar.setAttribute('aria-valuemax', String(maxW()));
    if (save) storage.set(KEY, { panelW: width });
  };
  apply(width, false);

  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('is-active');
    layout.classList.add('is-resizing');
    const startX = e.clientX;
    const startW = width;
    const move = (ev) => apply(startW + (ev.clientX - startX), false);
    const up = (ev) => {
      bar.releasePointerCapture(ev.pointerId);
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      bar.classList.remove('is-active');
      layout.classList.remove('is-resizing');
      apply(width);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });

  bar.addEventListener('dblclick', () => apply(DEFAULT_W));
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); apply(width - KEY_STEP); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); apply(width + KEY_STEP); }
    else if (e.key === 'Home') { e.preventDefault(); apply(DEFAULT_W); }
  });

  // Cửa sổ thu nhỏ → giữ độ rộng panel không vượt giới hạn mới
  window.addEventListener('resize', () => apply(width, false));
}
