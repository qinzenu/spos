// GET /api/audio?q=judul artis | ?id=VIDEO_ID | ?url=https://...   →  stream audio/mpeg
// Pakai yt-dlp (diunduh ke /tmp saat cold start) + ffmpeg-static untuk konversi MP3.
const fs = require('fs');
const { spawn } = require('child_process');
const { download } = require('./_lib');

const YT = '/tmp/yt-dlp';
const FF = '/tmp/ffmpeg';
const COOKIES = '/tmp/cookies.txt';

// Hanya platform ini yang boleh di-proxy lewat ?url= (mencegah penyalahgunaan)
const ALLOWED = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|instagram\.com|soundcloud\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|tiktok\.com|pinterest\.com|pin\.it)(\/|$|\?)/i;

let setup = null;
function ensure() {
  if (!setup) {
    setup = (async () => {
      if (!fs.existsSync(YT) || fs.statSync(YT).size < 1e6) {
        await download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', YT);
        fs.chmodSync(YT, 0o755);
      }
      if (!fs.existsSync(FF)) {
        fs.copyFileSync(require('ffmpeg-static'), FF);
        fs.chmodSync(FF, 0o755);
      }
      if (process.env.YT_COOKIES_B64) {
        fs.writeFileSync(COOKIES, Buffer.from(process.env.YT_COOKIES_B64, 'base64'));
      }
    })().catch((e) => { setup = null; throw e; });
  }
  return setup;
}

function fail(res, code, msg) {
  if (res.headersSent) return res.end();
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: msg }));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const u = new URL(req.url, 'http://localhost');
  let target = u.searchParams.get('url');
  const id = u.searchParams.get('id');
  const q = u.searchParams.get('q');
  if (id && /^[\w-]{11}$/.test(id)) target = 'https://www.youtube.com/watch?v=' + id;
  else if (q) target = 'ytsearch1:' + q.slice(0, 200);
  else if (target && !ALLOWED.test(target) && !process.env.ALLOW_ANY_URL) {
    return fail(res, 400, 'Platform ini tidak diizinkan');
  }
  if (!target || !(/^https?:\/\//i.test(target) || target.startsWith('ytsearch1:'))) {
    return fail(res, 400, 'Parameter url / id / q tidak valid');
  }

  try { await ensure(); } catch (e) { return fail(res, 503, 'Gagal menyiapkan yt-dlp/ffmpeg: ' + e.message); }

  const env = { ...process.env, HOME: '/tmp' };
  const args = [
    '--no-playlist', '-f', 'bestaudio/best', '-o', '-',
    '--quiet', '--no-warnings', '--cache-dir', '/tmp/yt-cache',
    '--js-runtimes', 'node:' + process.execPath,
  ];
  if (fs.existsSync(COOKIES)) args.push('--cookies', COOKIES);
  args.push('--', target);

  const ytdlp = spawn(YT, args, { env });
  const ffmpeg = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-f', 'mp3', '-b:a', '128k', 'pipe:1']);

  let errText = '', ffErr = '', started = false;
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
  });
  ffmpeg.on('close', () => {
    if (!started) fail(res, 502, ((errText.trim() || ffErr.trim()).split('\n').pop() || 'Gagal mengambil audio').slice(0, 300));
  });
  const stop = () => { try { ytdlp.kill(); } catch (e) {} try { ffmpeg.kill(); } catch (e) {} };
  res.on('close', stop);
  ytdlp.on('error', (e) => { errText += e.message; stop(); });
  ffmpeg.on('error', (e) => { errText += e.message; stop(); });
};
