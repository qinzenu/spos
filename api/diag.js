// GET /api/diag → cek sumber mana yang bisa dipakai dari server ini (buka di browser)
const { spawn } = require('child_process');
const fs = require('fs');
const { ensureTools, isBotErr, YT, COOKIES } = require('./_lib');

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

  const [ver, ...results] = await Promise.all([run(['--version'], 10000), ...tests.map((t) => run(t.args, 25000))]);
  const out = tests.map((t, i) => {
    const r = results[i];
    const ok = r.out.length > 0 && !/^ERROR/m.test(r.err);
    return {
      test: t.name, ok, ms: r.ms,
      detail: ok ? r.out.split('\n')[0] : (isBotErr(r.err) ? 'diblokir verifikasi bot' : r.err.split('\n').pop().replace(/^ERROR:\s*/, '').slice(0, 160)),
    };
  });
  const yt = out.filter((o) => o.test.startsWith('youtube_')).some((o) => o.ok);
  const sc = out.find((o) => o.test === 'soundcloud_search').ok;
  res.end(JSON.stringify({
    ok: true,
    yt_dlp: ver.out,
    region: process.env.VERCEL_REGION || null,
    cookies_dipasang: fs.existsSync(COOKIES),
    proxy_dipasang: !!process.env.YT_PROXY,
    ringkasan: yt ? 'YouTube BISA dipakai' : (sc ? 'YouTube diblokir, tapi SoundCloud bisa dipakai' : 'YouTube dan SoundCloud sama-sama gagal'),
    hasil: out,
  }, null, 2));
};
