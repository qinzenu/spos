// GET /api/audio?q=judul artis&t=judul | ?id=VIDEO_ID | ?url=https://...   →  stream audio/mpeg
// ?q= : YouTube (beberapa varian klien) → SoundCloud (hanya hasil yang judulnya cocok).
const fs = require('fs');
const { spawn } = require('child_process');
const { friendlyError, isBotErr, ensureTools, titleRegex, YT, FF, COOKIES } = require('./_lib');

// Hanya platform ini yang boleh di-proxy lewat ?url= (mencegah penyalahgunaan)
const ALLOWED = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|instagram\.com|soundcloud\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|tiktok\.com|pinterest\.com|pin\.it)(\/|$|\?)/i;
const isYouTube = (t) => /^ytsearch|youtube\.com|youtu\.be/i.test(t);

// Varian klien YouTube — dicoba berurutan kalau kena verifikasi bot
const YT_VARIANTS = [
  [],
  ['--extractor-args', 'youtube:player_client=android_vr'],
  ['--extractor-args', 'youtube:player_client=tv_simply'],
];

function fail(res, code, msg) {
  if (res.headersSent) return res.end();
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: msg }));
}

// Coba satu sumber. Resolve {ok:true} begitu audio mulai mengalir, atau {ok:false,msg} kalau gagal.
function tryStream(res, target, extra = []) {
  return new Promise((resolve) => {
    const args = [
      '--no-playlist', '-f', 'bestaudio/best', '-o', '-',
      '--quiet', '--no-warnings', '--cache-dir', '/tmp/yt-cache',
      '--js-runtimes', 'node:' + process.execPath,
    ];
    if (isYouTube(target)) {
      if (fs.existsSync(COOKIES)) args.push('--cookies', COOKIES);
      if (process.env.YT_PROXY) args.push('--proxy', process.env.YT_PROXY);
    }
    args.push(...extra, '--', target);

    const ytdlp = spawn(YT, args, { env: { ...process.env, HOME: '/tmp' } });
    const ffmpeg = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-f', 'mp3', '-b:a', '128k', 'pipe:1']);

    let errText = '', ffErr = '', started = false, settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const stop = () => { try { ytdlp.kill(); } catch (e) {} try { ffmpeg.kill(); } catch (e) {} };

    ytdlp.stderr.on('data', (d) => { errText += d; });
    ffmpeg.stderr.on('data', (d) => { ffErr += d; });
    ytdlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdin.on('error', () => {});

    ffmpeg.stdout.once('data', (chunk) => {
      started = true;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', 'attachment; filename="audio.mp3"');
      res.write(chunk);
      ffmpeg.stdout.pipe(res);
      res.on('close', stop);
      done({ ok: true });
    });
    ffmpeg.on('close', () => { if (!started) done({ ok: false, msg: errText.trim() || ffErr.trim() }); });
    ytdlp.on('error', (e) => { errText += e.message; stop(); });
    ffmpeg.on('error', (e) => { errText += e.message; stop(); });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const u = new URL(req.url, 'http://localhost');
  const url = u.searchParams.get('url');
  const id = u.searchParams.get('id');
  const q = (u.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const t = (u.searchParams.get('t') || '').slice(0, 150);

  const sources = [];
  if (id && /^[\w-]{11}$/.test(id)) {
    sources.push({ src: 'youtube', target: 'https://www.youtube.com/watch?v=' + id });
  } else if (q) {
    sources.push({ src: 'youtube', target: 'ytsearch1:' + q });
    // SoundCloud: ambil 5 hasil, hanya yang judulnya cocok → tidak salah lagu
    const re = titleRegex(t);
    sources.push({
      src: 'soundcloud',
      target: 'scsearch5:' + q.replace(/\s+audio$/i, ''),
      extra: ['--max-downloads', '1', ...(re ? ['--match-filter', 'title ~= ' + re] : [])],
    });
  } else if (url) {
    if (!/^https?:\/\//i.test(url)) return fail(res, 400, 'URL tidak valid');
    if (!ALLOWED.test(url) && !process.env.ALLOW_ANY_URL) return fail(res, 400, 'Platform ini tidak diizinkan');
    sources.push({ src: 'url', target: url });
  } else {
    return fail(res, 400, 'Parameter url / id / q tidak valid');
  }

  try { await ensureTools(); } catch (e) { return fail(res, 503, 'Gagal menyiapkan yt-dlp/ffmpeg: ' + e.message); }

  const errors = [];
  for (const s of sources) {
    const variants = s.src === 'youtube' ? YT_VARIANTS : [s.extra || []];
    let last = null;
    for (const v of variants) {
      last = await tryStream(res, s.target, v);
      if (last.ok) return;
      // ganti varian klien hanya kalau penyebabnya verifikasi bot / klien tidak cocok
      if (!(isBotErr(last.msg) || /not available on this app|player response/i.test(last.msg || ''))) break;
    }
    errors.push({ src: s.src, msg: last.msg });
  }
  fail(res, 502, friendlyError(errors));
};
