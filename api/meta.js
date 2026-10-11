// GET /api/meta?url=https://open.spotify.com/track/ID  →  { ok, title, artist, thumbnail }
// Menggabungkan 3 sumber: halaman track, halaman embed, dan oEmbed — satu gagal tidak masalah.
const { parseSpotifyHtml, parseEmbedHtml } = require('./_lib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function get(url, asJson) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return asJson ? r.json() : r.text();
}

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
  const id = target.split('/').pop();

  const info = { title: null, artist: null, thumbnail: null };
  const merge = (o) => { for (const k of Object.keys(info)) if (!info[k] && o && o[k]) info[k] = o[k]; };

  try { merge(parseSpotifyHtml(await get(target))); } catch (e) { /* lanjut ke sumber berikut */ }
  if (!info.title || !info.artist) {
    try { merge(parseEmbedHtml(await get('https://open.spotify.com/embed/track/' + id))); } catch (e) {}
  }
  if (!info.title || !info.thumbnail) {
    try {
      const j = await get('https://open.spotify.com/oembed?url=' + encodeURIComponent(target), true);
      merge({ title: j.title, thumbnail: j.thumbnail_url });
    } catch (e) {}
  }

  if (!info.title) return send(502, { ok: false, error: 'Info lagu tidak ditemukan' });
  res.setHeader('Cache-Control', 'public, s-maxage=86400');
  send(200, { ok: true, ...info });
};
