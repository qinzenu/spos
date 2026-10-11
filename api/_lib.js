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

const YT = '/tmp/yt-dlp';
const FF = '/tmp/ffmpeg';
const COOKIES = '/tmp/cookies.txt';

// Siapkan yt-dlp + ffmpeg di /tmp (sekali per instance)
let _setup = null;
function ensureTools() {
  if (!_setup) {
    _setup = (async () => {
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
    })().catch((e) => { _setup = null; throw e; });
  }
  return _setup;
}

// Regex judul untuk --match-filter yt-dlp: hanya huruf/angka, dipisah \W* (tahan beda tanda baca)
function titleRegex(t) {
  const clean = String(t || '').replace(/[\(\[].*?[\)\]]/g, '').split(' - ')[0];
  const toks = clean.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
  return toks.length ? '(?i)' + toks.join('\\W*') : null;
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
    // Judul bisa berbahasa lain: "... by X" / "... oleh X"
    const m = decodeEntities(t[1]).trim().match(/^.* (?:by|oleh) (.+?) \| Spotify$/i);
    if (m) artist = m[1].trim();
  }
  if (!artist && desc) {
    const parts = desc.split(' · ');
    if (parts.length >= 2) artist = parts[0].trim();
  }
  return { title, artist, thumbnail };
}

const isBotErr = (t) => /sign in to confirm|not a bot|--cookies/i.test(t || '');

function shortMsg(t) {
  const line = String(t || '').trim().split('\n').pop().replace(/^ERROR:\s*/i, '');
  return line.slice(0, 110) || 'tidak ada hasil yang cocok dengan judul lagu';
}

// errors: [{ src: 'youtube'|'soundcloud'|'url', msg }]
function friendlyError(errors) {
  return errors.map((e) => {
    const name = { youtube: 'YouTube', soundcloud: 'SoundCloud' }[e.src] || 'Sumber';
    if (isBotErr(e.msg)) return name + ': diblokir verifikasi bot (isi YT_COOKIES_B64 atau YT_PROXY di Vercel)';
    return name + ': ' + shortMsg(e.msg);
  }).join(' | ').slice(0, 300);
}

module.exports = { download, parseSpotifyHtml, friendlyError, isBotErr, ensureTools, titleRegex, YT, FF, COOKIES };
