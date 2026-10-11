// GET /api/meta?url=https://open.spotify.com/track/ID  →  { ok, title, artist, thumbnail }
const { parseSpotifyHtml } = require('./_lib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const u = new URL(req.url, 'http://localhost');
  const target = (u.searchParams.get('url') || '').split('?')[0];
  if (!/^https:\/\/open\.spotify\.com\/(intl-[a-z-]+\/)?track\/[A-Za-z0-9]+$/.test(target)) {
    return send(400, { ok: false, error: 'URL track Spotify tidak valid' });
  }
  try {
    const r = await fetch(target, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error('Spotify HTTP ' + r.status);
    const info = parseSpotifyHtml(await r.text());
    if (!info.artist) {
      // Cadangan: halaman embed memuat daftar artis dalam JSON
      try {
        const er = await fetch('https://open.spotify.com/embed/track/' + target.split('/').pop(), {
          headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
          signal: AbortSignal.timeout(8000),
        });
        const eh = await er.text();
        const am = eh.match(/"artists":\s*\[\s*\{\s*"name":\s*"((?:[^"\\]|\\.)*)"/);
        if (am) info.artist = JSON.parse('"' + am[1] + '"');
      } catch (e) { /* abaikan */ }
    }
    if (!info.title) throw new Error('Info lagu tidak ditemukan');
    res.setHeader('Cache-Control', 'public, s-maxage=86400');
    send(200, { ok: true, ...info });
  } catch (e) {
    send(502, { ok: false, error: e.message });
  }
};
