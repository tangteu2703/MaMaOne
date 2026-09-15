// ==========================================
// API Client — Kết nối tới Express backend
// ==========================================

const BASE = '';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

export const api = {
  // System
  getStatus: () => request('GET', '/api/status'),
  reset: () => request('POST', '/api/reset'),

  // Config
  getConfig: () => request('GET', '/api/config'),
  saveConfig: (cfg) => request('POST', '/api/config', cfg),

  // Pipeline
  runPipeline: (opts) => request('POST', '/api/run', opts),

  // Videos
  getVideos: () => request('GET', '/api/videos'),
  getPipelineFiles: () => request('GET', '/api/pipeline-files'),
  getOutputVideos: () => request('GET', '/api/output-videos'),

  // Stories
  getStories: () => request('GET', '/api/stories'),
  getStory: (id, wordsPerEpisode) =>
    request('GET', `/api/stories/${id}${wordsPerEpisode ? `?wordsPerEpisode=${wordsPerEpisode}` : ''}`),
  createStory: (data) => request('POST', '/api/stories', data),
  deleteStory: (id) => request('DELETE', `/api/stories/${id}`),

  // Audio
  renderAudio: (data) => request('POST', '/api/render-audio', data),
  getAudioFiles: () => request('GET', '/api/audio-files'),
  deleteAudio: (filename) => request('DELETE', `/api/audio-files/${filename}`),
  deleteAllAudio: () => request('DELETE', '/api/audio-files/all'),

  // Video BG
  getVideoBgFiles: () => request('GET', '/api/video-bg-files'),
  renderVideo: (data) => request('POST', '/api/render-video', data),
  getOutputVideosList: () => request('GET', '/api/output-videos'),

  // AI Generator
  checkComfyStatus: () => request('GET', '/api/ai-generator/comfy-status'),
  generateAIVideo: (opts) => request('POST', '/api/ai-generator/generate', opts),
  getAIHistory: () => request('GET', '/api/ai-generator/history'),
};
