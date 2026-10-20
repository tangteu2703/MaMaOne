// Tiện ích DOM / định dạng dùng chung

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tạo phần tử DOM: h('div', {class:'a', onclick}, 'text', child) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (hh) return `${hh}g ${String(mm).padStart(2, '0')}p`;
  return mm ? `${mm}p ${String(ss).padStart(2, '0')}s` : `${ss}s`;
}

export const fmtClock = (ts) => new Date(ts).toLocaleTimeString('vi-VN', { hour12: false });
export const fmtDateTime = (ts) => new Date(ts).toLocaleString('vi-VN', { hour12: false });

export function toast(message, type = 'ok') {
  const el = h('div', { class: `toast toast--${type}` }, message);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 3200);
}

export const storage = {
  get(key, fallback) {
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* bỏ qua */ } },
};
