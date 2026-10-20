// Danh sách job: dựng/cập nhật thẻ, poll job đang chạy, đồng bộ danh sách định kỳ
import { api } from './api.js';
import { createJobCard, isActive } from './jobCard.js';

const POLL_ACTIVE_MS = 1500;
const SYNC_LIST_MS = 5000;

export function initJobList({ listEl, emptyEl, countEl, getFormOptions }) {
  const cards = new Map();
  const lastSeen = new Map(); // id -> updatedAt đã nạp bản đầy đủ

  const toggleEmpty = () => {
    emptyEl.hidden = cards.size > 0;
    countEl.textContent = cards.size;
  };

  async function loadFull(id) {
    try {
      const { job } = await api.job(id);
      const card = cards.get(id);
      if (card) { card.update(job); lastSeen.set(id, job.updatedAt); }
    } catch { /* job có thể vừa bị xoá */ }
  }

  function addCard(summary) {
    const card = createJobCard(summary, {
      getFormOptions,
      onDeleted: (id) => removeCard(id),
    });
    cards.set(summary.id, card);
    listEl.prepend(card.el);
    toggleEmpty();
    loadFull(summary.id);
    return card;
  }

  function removeCard(id) {
    const card = cards.get(id);
    if (card) card.el.remove();
    cards.delete(id);
    lastSeen.delete(id);
    toggleEmpty();
  }

  async function syncList() {
    let jobs;
    try { jobs = (await api.jobs()).jobs; } catch { return; }
    const ids = new Set(jobs.map((j) => j.id));
    [...cards.keys()].forEach((id) => { if (!ids.has(id)) removeCard(id); });

    // thêm theo thứ tự cũ → mới để thẻ mới nhất nằm trên cùng
    [...jobs].reverse().forEach((j) => {
      const card = cards.get(j.id);
      if (!card) { addCard(j); return; }
      const changed = lastSeen.get(j.id) !== j.updatedAt;
      card.update(j);
      if (changed && !isActive(j.status)) loadFull(j.id);
    });
    toggleEmpty();
  }

  async function pollActive() {
    const active = [...cards.values()].filter((c) => isActive(c.data.status));
    await Promise.all(active.map((c) => loadFull(c.id)));
  }

  syncList();
  setInterval(syncList, SYNC_LIST_MS);
  setInterval(pollActive, POLL_ACTIVE_MS);

  return {
    /** Thêm ngay job vừa tạo (không đợi vòng đồng bộ) */
    add(summary) { if (!cards.has(summary.id)) addCard(summary); },
    refresh: syncList,
  };
}
