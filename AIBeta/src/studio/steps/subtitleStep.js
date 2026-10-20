// ==========================================
// STUDIO / STEP 3 — SUBTITLES
// Sinh file ASS (phụ đề khớp từng đoạn voice + tiêu đề) và chép font vào thư mục job
// ==========================================
const fs = require('fs');
const path = require('path');
const store = require('../jobStore');
const { buildAss } = require('../subtitles');
const { canvasSize, ensureFonts } = require('../videoBuilder');

const STEP = 'subtitle';

async function run(job) {
  const dir = store.jobDir(job);
  const assFile = path.join(dir, 'sub.ass');
  if (job.steps[STEP].status === 'done' && fs.existsSync(assFile) && !job.renderStale) return;

  store.beginStep(job, STEP, { total: job.segments.length, done: 0, percent: 0, message: 'Đang tạo phụ đề...' });
  const { W, H } = canvasSize(job.options.aspect);
  const ass = buildAss({
    title: job.title,
    segments: job.segments,
    totalSec: job.totalSec,
    W, H,
    titlePosition: job.options.titlePosition,
    titleIntro: job.options.titleIntro,
  });
  fs.writeFileSync(assFile, ass, 'utf8');
  const hasFonts = ensureFonts(dir);
  if (!hasFonts) store.jlog(job, 'warn', 'Không tìm thấy font Arial để chép — phụ đề dùng font mặc định của hệ thống');

  const cues = (ass.match(/^Dialogue: 1,/gm) || []).length;
  store.endStep(job, STEP, 'done', { done: job.segments.length, total: job.segments.length, message: `${cues} dòng phụ đề · tiêu đề: ${job.options.titlePosition === 'none' ? 'tắt' : job.options.titlePosition === 'bottom' ? 'dưới' : 'trên'}` });
  store.jlog(job, 'success', `📝 Phụ đề: ${cues} dòng (sub.ass)`);
}

module.exports = { run };
