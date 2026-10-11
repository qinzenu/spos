// GET /api/diag → cek sumber mana yang bisa dipakai dari server ini (buka di browser)
const { spawn } = require('child_process');
const fs = require('fs');
const { ensureTools, isBotErr, YT, FF, COOKIES } = require('./_lib');

function run(args, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(YT, args, { env: { ...process.env, HOME: '/tmp' } });
    let out = '', err = '';
    const timer = setTimeout(() => { err += ' (timeout)'; p.kill(); }, ms);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { err += e.message; });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim(), ms: Date.now() - t0 }); });
  });
}

// Unduh sebagian lewat yt-dlp (pass=true: langsung hitung byte; false: lewat ffmpeg) → ok kalau ada data audio
function probeDownload(args, ms, pass) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const y = spawn(YT, args, { env: { ...process.env, HOME: '/tmp' } });
    const f = pass ? null : spawn(FF, ['-hide_banner', '-loglevel', 'error', '-t', '3', '-i', 'pipe:0', '-vn', '-f', 'mp3', 'pipe:1']);
    let bytes = 0, err = '', finished = false;
    const finish = () => {
      if (finished) return; finished = true; clearTimeout(timer);
      try { y.kill(); } catch (e) {} try { f && f.kill(); } catch (e) {}
      resolve({ bytes, err: err.trim(), ms: Date.now() - t0 });
    };
    const timer = setTimeout(() => { err += ' (timeout)'; finish(); }, ms);
    y.stderr.on('data', (d) => { err += d; });
    y.on('error', (e) => { err += e.message; });
    y.stdout.on('error', () => {});
    if (pass) {
      y.stdout.on('data', (d) => { bytes += d.length; if (bytes >= 20000) finish(); });
      y.on('close', finish);
    } else {
      f.stderr.on('data', (d) => { err += d; });
      y.stdout.pipe(f.stdin);
      f.stdin.on('error', () => {});
      f.stdout.on('data', (d) => { bytes += d.length; });
      f.on('close', finish);
      f.on('error', (e) => { err += e.message; });
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try { await ensureTools(); }
  catch (e) { res.statusCode = 503; return res.end(JSON.stringify({ ok: false, error: e.message })); }

  const base = ['--no-playlist', '-f', 'bestaudio/best', '--simulate', '--print', '%(title)s', '--no-warnings',
    '--cache-dir', '/tmp/yt-cache', '--js-runtimes', 'node:' + process.execPath];
  const ytOpts = [
    ...(fs.existsSync(COOKIES) ? ['--cookies', COOKIES] : []),
    ...(process.env.YT_PROXY ? ['--proxy', process.env.YT_PROXY] : []),
  ];
  const vid = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const tests = [
    { name: 'youtube_default', args: [...base, ...ytOpts, '--', vid] },
    { name: 'youtube_android_vr', args: [...base, ...ytOpts, '--extractor-args', 'youtube:player_client=android_vr', '--', vid] },
    { name: 'youtube_tv_simply', args: [...base, ...ytOpts, '--extractor-args', 'youtube:player_client=tv_simply', '--', vid] },
    { name: 'soundcloud_search', args: [...base, '--max-downloads', '1', '--', 'scsearch1:never gonna give you up'] },
  ];
  const dl = (fmt, pass) => probeDownload([
    '--no-playlist', '-f', fmt, '-o', '-', '--quiet', '--no-warnings', '--cache-dir', '/tmp/yt-cache',
    '--max-downloads', '1', '--', 'scsearch1:never gonna give you up',
  ], 30000, pass);

  const [ver, d1, d2, d3, ...results] = await Promise.all([
    run(['--version'], 10000),
    dl('hls_mp3_128', true),
    dl('http_mp3_128', true),
    dl('hls_opus_64', false),
    ...tests.map((t) => run(t.args, 25000)),
  ]);

  const out = tests.map((t, i) => {
    const r = results[i];
    const ok = r.out.length > 0 && !/^ERROR/m.test(r.err);
    return {
      test: t.name, ok, ms: r.ms,
      detail: ok ? r.out.split('\n')[0] : (isBotErr(r.err) ? 'diblokir verifikasi bot' : r.err.split('\n').pop().replace(/^ERROR:\s*/, '').slice(0, 160)),
    };
  });
  const dlRes = (name, r) => ({
    test: name, ok: r.bytes > 2000, ms: r.ms,
    detail: r.bytes > 2000 ? r.bytes + ' byte audio diterima' : (r.err.split('\n').pop().replace(/^ERROR:\s*/, '').slice(0, 160) || 'tidak ada data'),
  });
  const sc = [dlRes('soundcloud_unduh_hls_mp3', d1), dlRes('soundcloud_unduh_http_mp3', d2), dlRes('soundcloud_unduh_hls_opus', d3)];
  out.push(...sc);

  const yt = out.filter((o) => o.test.startsWith('youtube_')).some((o) => o.ok);
  const scOk = sc.some((o) => o.ok);
  res.end(JSON.stringify({
    ok: true,
    yt_dlp: ver.out,
    region: process.env.VERCEL_REGION || null,
    cookies_dipasang: fs.existsSync(COOKIES),
    proxy_dipasang: !!process.env.YT_PROXY,
    ringkasan: yt ? 'YouTube BISA dipakai' : (scOk ? 'YouTube diblokir, tapi unduh SoundCloud BISA dipakai' : 'YouTube dan SoundCloud sama-sama gagal'),
    hasil: out,
  }, null, 2));
};
