// ==========================================
// STUDIO / VIDEO BUILDER
// Dựng video: ảnh → clip Ken Burns (song song) → ghép + sub + tiêu đề + voice + nhạc nền → final.mp4
// ==========================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../config/config');
const { runFfmpeg, throwIfAborted, pad, probeDuration } = require('./mediaUtils');
const { assignMotions, zoompanExpr } = require('./motions');

const even = (n) => Math.round(n / 2) * 2;
const isValidFile = (f) => fs.existsSync(f) && fs.statSync(f).size > 1000;

/** Khung canvas chuẩn dùng cho phụ đề (độc lập chất lượng xuất) */
function canvasSize(aspect) {
  return aspect === '9:16' ? { W: 1080, H: 1920 } : { W: 1920, H: 1080 };
}

/** Kích thước video xuất theo chất lượng */
function outputSize(aspect, quality) {
  const vertical = aspect === '9:16';
  if (quality === 'fast') return vertical ? { W: 720, H: 1280 } : { W: 1280, H: 720 };
  return canvasSize(aspect);
}

/** Copy font Arial vào thư mục job để libass luôn tìm thấy (đường dẫn tương đối, tránh lỗi escape ổ đĩa Windows) */
function ensureFonts(dir) {
  const target = path.join(dir, 'fonts');
  fs.mkdirSync(target, { recursive: true });
  const sources = [process.env.STUDIO_FONTS_DIR, path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), '/usr/share/fonts/truetype/msttcorefonts']
    .filter(Boolean);
  for (const name of ['arial.ttf', 'arialbd.ttf']) {
    const dest = path.join(target, name);
    if (fs.existsSync(dest)) continue;
    const src = sources.map((d) => path.join(d, name)).find((f) => fs.existsSync(f));
    if (src) fs.copyFileSync(src, dest);
  }
  return fs.readdirSync(target).length > 0;
}

/** Lập kế hoạch clip: mỗi scene tách thành `parts` clip, số khung hình tính luỹ kế để không lệch tiếng */
function planClips(job, fps, dir) {
  const scenes = job.scenes;
  const files = scenes.map((sc) => {
    const abs = sc.imageFile ? path.join(dir, sc.imageFile) : null;
    return abs && isValidFile(abs) ? abs : null;
  });
  const pickImage = (i) => {
    if (files[i]) return files[i];
    for (let d = 1; d < files.length; d++) {
      if (files[i - d]) return files[i - d];
      if (files[i + d]) return files[i + d];
    }
    return null;
  };

  const totalClips = scenes.reduce((n, s) => n + Math.max(1, s.parts || 1), 0);
  const motions = assignMotions(totalClips, job.id);
  const clips = [];
  let elapsed = 0;
  let cumFrames = 0;
  scenes.forEach((sc) => {
    const parts = Math.max(1, sc.parts || 1);
    const partDur = sc.dur / parts;
    for (let p = 0; p < parts; p++) {
      elapsed += partDur;
      const endFrame = Math.round(elapsed * fps);
      const frames = Math.max(1, endFrame - cumFrames);
      cumFrames = endFrame;
      const n = clips.length;
      clips.push({
        n: n + 1, scene: sc.i, part: p, frames, motion: motions[n],
        img: pickImage(sc.i), fadeIn: p === 0, fadeOut: p === parts - 1,
      });
    }
  });
  return { clips, videoSec: cumFrames / fps };
}

async function renderClip(clip, ctx) {
  const { W, H, fps, dir, signal, transition, prescale } = ctx;
  const out = path.join(dir, 'clips', `clip_${pad(clip.n, 5)}.mp4`);
  if (isValidFile(out)) return;
  const tmp = out.replace('.mp4', '.part.mp4');

  const fades = [];
  if (transition === 'fade') {
    const dur = clip.frames / fps;
    const d = Math.min(0.2, dur / 4).toFixed(3);
    if (clip.fadeIn) fades.push(`fade=t=in:st=0:d=${d}`);
    if (clip.fadeOut) fades.push(`fade=t=out:st=${Math.max(0, dur - Number(d)).toFixed(3)}:d=${d}`);
  }

  const encode = ['-c:v', 'libx264', '-preset', 'superfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-an', '-frames:v', String(clip.frames), tmp];
  let args;
  if (clip.img) {
    const PW = even(W * prescale);
    const PH = even(H * prescale);
    const e = zoompanExpr(clip.motion.params, clip.frames);
    const vf = [
      `scale=${PW}:${PH}:force_original_aspect_ratio=increase:flags=bicubic`,
      `crop=${PW}:${PH}`,
      'setsar=1',
      `zoompan=z='${e.z}':x='${e.x}':y='${e.y}':d=${clip.frames}:s=${W}x${H}:fps=${fps}`,
      ...fades,
      'format=yuv420p',
    ].join(',');
    args = ['-loglevel', 'error', '-i', clip.img, '-vf', vf, ...encode];
  } else {
    // Không có ảnh nào → nền màu để video vẫn dựng được
    args = ['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x0f172a:s=${W}x${H}:r=${fps}`, ...(fades.length ? ['-vf', fades.join(',')] : []), ...encode];
  }
  await runFfmpeg(args, { signal, label: `clip ${clip.n}` });
  fs.renameSync(tmp, out);
}

/** Render toàn bộ clip với số luồng song song, có tiến độ + ETA, bỏ qua clip đã có (chạy tiếp được) */
async function renderClips(clips, ctx, onProgress) {
  const concurrency = Math.max(1, parseInt(process.env.STUDIO_RENDER_CONCURRENCY, 10)
    || Math.min(4, Math.max(1, Math.floor(os.cpus().length / 3))));
  fs.mkdirSync(path.join(ctx.dir, 'clips'), { recursive: true });
  let next = 0;
  let done = 0;
  let failed = null;
  const t0 = Date.now();

  const worker = async () => {
    while (!failed && next < clips.length) {
      throwIfAborted(ctx.signal);
      const clip = clips[next++];
      try {
        await renderClip(clip, ctx);
      } catch (e) { failed = failed || e; return; }
      done++;
      const elapsed = (Date.now() - t0) / 1000;
      onProgress({ done, total: clips.length, etaSec: done ? (elapsed / done) * (clips.length - done) : 0, concurrency });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failed) throw failed;
}

/**
 * Lập playlist nhạc nền: các bài theo thứ tự chọn, lặp vòng cho đủ dài video.
 * Các bài nối nhau bằng crossfade (nếu mọi bài đều > 10s).
 * @returns {Promise<null|{seq:Array<{file:string,name:string,dur:number}>, xf:number, unique:number}>}
 */
async function planMusic(tracks, totalSec) {
  const items = [];
  for (const name of tracks) {
    const file = path.join(config.paths.music, path.basename(name));
    if (!fs.existsSync(file)) continue;
    const dur = await probeDuration(file);
    if (dur > 1) items.push({ file, name, dur });
  }
  if (!items.length) return null;
  const xf = items.every((i) => i.dur > 10) ? 3 : 0;
  const seq = [];
  let covered = 0;
  while (covered < totalSec + 1 && seq.length < 120) {
    const it = items[seq.length % items.length];
    covered += it.dur - (seq.length ? xf : 0);
    seq.push(it);
  }
  return { seq, xf, unique: items.length };
}

/** Các nhãn filter_complex ghép playlist thành 1 luồng [mc]; firstIdx = chỉ số input đầu tiên của nhạc */
function musicFilters(plan, firstIdx) {
  const { seq, xf } = plan;
  const f = seq.map((_, k) => `[${firstIdx + k}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[m${k}]`);
  if (seq.length === 1) { f.push('[m0]anull[mc]'); return f; }
  if (xf > 0) {
    let prev = 'm0';
    for (let k = 1; k < seq.length; k++) {
      const out = k === seq.length - 1 ? 'mc' : `x${k}`;
      f.push(`[${prev}][m${k}]acrossfade=d=${xf}:c1=tri:c2=tri[${out}]`);
      prev = out;
    }
  } else {
    f.push(`${seq.map((_, k) => `[m${k}]`).join('')}concat=n=${seq.length}:v=0:a=1[mc]`);
  }
  return f;
}

/** Ghép tất cả: clip + voice + nhạc nền + ASS (sub + tiêu đề) → mp4 */
async function muxFinal(job, ctx, clips, videoSec, onProgress) {
  const { dir, signal, fps } = ctx;
  const o = job.options;

  fs.writeFileSync(path.join(dir, 'clips.txt'), clips.map((c) => `file 'clips/clip_${pad(c.n, 5)}.mp4'`).join('\n'), 'utf8');
  fs.writeFileSync(path.join(dir, 'voice.txt'), job.segments.map((s) => `file '${s.voiceFile}'`).join('\n'), 'utf8');

  const totalSec = Math.min(videoSec, job.totalSec) || videoSec;
  const tracks = Array.isArray(o.musicTracks) ? o.musicTracks : (o.music ? [o.music] : []);
  const musicPlan = tracks.length ? await planMusic(tracks, totalSec) : null;
  const hasMusic = !!musicPlan;
  const hasAss = fs.existsSync(path.join(dir, 'sub.ass'));
  const hasFonts = fs.existsSync(path.join(dir, 'fonts'));

  const inputs = ['-f', 'concat', '-safe', '0', '-i', 'clips.txt', '-f', 'concat', '-safe', '0', '-i', 'voice.txt'];
  if (hasMusic) musicPlan.seq.forEach((it) => inputs.push('-i', it.file));

  const vChain = [hasAss ? `ass=sub.ass${hasFonts ? ':fontsdir=fonts' : ''}` : null, 'format=yuv420p'].filter(Boolean).join(',');
  const parts = [`[0:v]${vChain}[v]`];
  if (hasMusic) {
    const vol = Math.max(0, Math.min(1, Number(o.musicVolume))).toFixed(3);
    parts.push('[1:a]aresample=44100[a1]');
    parts.push(...musicFilters(musicPlan, 2));
    parts.push(`[mc]volume=${vol},afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, totalSec - 3).toFixed(2)}:d=3[m]`);
    parts.push('[a1][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]');
  } else {
    parts.push('[1:a]aresample=44100[a]');
  }

  const tmpOut = path.join(dir, 'final.part.mp4');
  const finalOut = path.join(dir, 'final.mp4');
  const args = [
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[v]', '-map', '[a]',
    '-t', totalSec.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-movflags', '+faststart',
    tmpOut,
  ];
  await runFfmpeg(args, { cwd: dir, signal, label: 'ghép video', onProgress: (t) => onProgress(Math.min(1, t / totalSec)) });
  fs.renameSync(tmpOut, finalOut);
  return { file: 'final.mp4', durationSec: totalSec, sizeMB: Math.round((fs.statSync(finalOut).size / 1048576) * 10) / 10, withMusic: hasMusic, musicTracks: hasMusic ? musicPlan.unique : 0 };
}

/**
 * Pipeline render hoàn chỉnh.
 * @param {(info:{phase:'clips'|'mux', percent:number, message:string})=>void} report
 */
async function renderVideo(job, { dir, signal, report }) {
  const o = job.options;
  const fps = o.fps;
  const { W, H } = outputSize(o.aspect, o.quality);
  const { clips, videoSec } = planClips(job, fps, dir);
  // zoompan làm tròn vị trí crop theo pixel của ảnh đầu vào → phóng ảnh lên thật lớn (cạnh dài ~5120px)
  // trước khi zoompan để bước nhảy < 0.25px đầu ra, chuyển động mới mượt (không bị giật/khựng).
  const prescale = Math.max(2, 5120 / Math.max(W, H));
  const ctx = { W, H, fps, dir, signal, transition: o.transition, prescale };

  await renderClips(clips, ctx, ({ done, total, etaSec, concurrency }) => {
    report({
      phase: 'clips',
      percent: (done / total) * 0.85,
      message: `Clip ${done}/${total} · ${concurrency} luồng${etaSec > 5 ? ` · còn ~${Math.ceil(etaSec / 60)} phút` : ''}`,
    });
  });

  report({ phase: 'mux', percent: 0.86, message: 'Đang ghép voice + nhạc + phụ đề + tiêu đề...' });
  const output = await muxFinal(job, ctx, clips, videoSec, (p) => report({
    phase: 'mux', percent: 0.86 + p * 0.14, message: `Đang ghép & mã hoá video ${Math.round(p * 100)}%`,
  }));

  if (!process.env.STUDIO_KEEP_CLIPS) {
    fs.rmSync(path.join(dir, 'clips'), { recursive: true, force: true });
  }
  return { ...output, clips: clips.length, width: W, height: H };
}

module.exports = { renderVideo, ensureFonts, canvasSize, outputSize };
