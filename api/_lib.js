// Helper bersama untuk fungsi Vercel (file berawalan "_" tidak dijadikan endpoint)
const fs = require('fs');
const https = require('https');

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects > 8) return reject(new Error('Terlalu banyak redirect'));
        return resolve(download(new URL(res.headers.location, url).href, dest, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const tmp = dest + '.part';
      const f = fs.createWriteStream(tmp);
      res.pipe(f);
      f.on('finish', () => f.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      f.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (x) {} reject(e); });
      res.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (x) {} reject(e); });
    }).on('error', reject);
  });
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function metaContent(html, prop) {
  const re1 = new RegExp('<meta[^>]+(?:property|name)="' + prop + '"[^>]*content="([^"]*)"', 'i');
  const re2 = new RegExp('<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="' + prop + '"', 'i');
  const m = html.match(re1) || html.match(re2);
  return m ? decodeEntities(m[1]) : null;
}

// Ambil judul, artis, dan cover dari HTML halaman track Spotify
function parseSpotifyHtml(html) {
  const title = metaContent(html, 'og:title');
  const thumbnail = metaContent(html, 'og:image');
  const desc = metaContent(html, 'og:description');
  let artist = null;
  const t = html.match(/<title>([^<]*)<\/title>/i);
  if (t) {
    // "Lagu - song and lyrics by Artis | Spotify"
    const m = decodeEntities(t[1]).trim().match(/^.* by (.+?) \| Spotify$/i);
    if (m) artist = m[1].trim();
  }
  if (!artist && desc) {
    const parts = desc.split(' · ');
    if (parts.length >= 2) artist = parts[0].trim();
  }
  return { title, artist, thumbnail };
}

module.exports = { download, parseSpotifyHtml };
