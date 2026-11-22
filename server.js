const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

const send = (res, status, data, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
};

const safeText = s => String(s || '').replace(/[<>]/g, '').slice(0, 180);

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
  'https://api.piped.yt'
];

const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://invidious.jing.rocks'
];

async function fetchJsonWithTimeout(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'SonoraMusicFinder/1.4' },
      signal: controller.signal
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function spotifyResource(input) {
  try {
    const u = new URL(input);
    if (!/(^|\.)spotify\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(album|track|playlist)\/([A-Za-z0-9]+)\/?$/);
    return m ? { type: m[1], id: m[2], url: `https://open.spotify.com/${m[1]}/${m[2]}` } : null;
  } catch {
    return null;
  }
}

function youtubeVideoId(input) {
  try {
    const u = new URL(input);
    if (/^(www\.|m\.|music\.)?youtube\.com$/i.test(u.hostname)) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[2];
    }
    if (/^youtu\.be$/i.test(u.hostname)) {
      const m = u.pathname.match(/^\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function runCommandJson(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => (out += d.toString()));
    proc.stderr.on('data', d => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0 && !out.trim()) return reject(new Error(err || `${cmd} exited with ${code}`));
      resolve(out);
    });
  });
}

async function searchViaYtDlp(query, limit = 1) {
  const isUrl = /^https?:\/\//i.test(query);
  const target = isUrl ? query : `ytsearch${limit}:${query}`;
  const raw = await runCommandJson('yt-dlp', [
    '--dump-single-json',
    '--flat-playlist',
    '--no-warnings',
    target
  ]);
  const parsed = JSON.parse(raw);
  const entries = parsed.entries ? parsed.entries : [parsed];
  return entries
    .filter(e => e && e.id)
    .slice(0, 1)
    .map(e => ({
      videoId: e.id,
      title: safeText(e.title || 'Track'),
      artist: safeText(e.uploader || e.channel || 'Artist'),
      artwork: e.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
      durationMs: Number(e.duration) > 0 ? Number(e.duration) * 1000 : null
    }));
}

async function searchViaPiped(query) {
  for (const base of PIPED_INSTANCES) {
    try {
      const data = await fetchJsonWithTimeout(`${base}/search?q=${encodeURIComponent(query)}&filter=all`);
      const items = (data.items || []).filter(i => i.type === 'stream' && i.url);
      if (items.length) {
        const i = items[0];
        const m = String(i.url).match(/[?&]v=([A-Za-z0-9_-]{11})/);
        const vid = m ? m[1] : '';
        if (vid) {
          return [{
            videoId: vid,
            title: safeText(i.title),
            artist: safeText(i.uploaderName || 'Artist'),
            artwork: i.thumbnail || `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
            durationMs: Number(i.duration) > 0 ? Number(i.duration) * 1000 : null
          }];
        }
      }
    } catch {}
  }
  throw new Error('Piped unavailable');
}

async function searchViaInvidious(query) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const items = await fetchJsonWithTimeout(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
      if (Array.isArray(items) && items.length && items[0].videoId) {
        const i = items[0];
        return [{
          videoId: i.videoId,
          title: safeText(i.title),
          artist: safeText(i.author || 'Artist'),
          artwork: i.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${i.videoId}/hqdefault.jpg`,
          durationMs: Number(i.lengthSeconds) > 0 ? Number(i.lengthSeconds) * 1000 : null
        }];
      }
    } catch {}
  }
  throw new Error('Invidious unavailable');
}

async function findTopTrack(query) {
  const directVid = youtubeVideoId(query);
  if (directVid) {
    try {
      const oembed = await fetchJsonWithTimeout(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${directVid}`)}&format=json`);
      return [{
        videoId: directVid,
        title: safeText(oembed.title || 'Track'),
        artist: safeText(oembed.author_name || 'Artist'),
        artwork: oembed.thumbnail_url || `https://i.ytimg.com/vi/${directVid}/hqdefault.jpg`,
        durationMs: null
      }];
    } catch {}
  }

  try {
    const res = await searchViaYtDlp(query, 1);
    if (res.length) return res;
  } catch {}

  try {
    const res = await searchViaPiped(query);
    if (res.length) return res;
  } catch {}

  try {
    const res = await searchViaInvidious(query);
    if (res.length) return res;
  } catch {}

  throw new Error('Song nahi mil saka. Check karein ke internet connected hai aur yt-dlp install hai.');
}

async function search(q) {
  const sp = spotifyResource(q);
  if (sp) {
    const meta = await fetchJsonWithTimeout(`https://open.spotify.com/oembed?url=${encodeURIComponent(sp.url)}`);
    const title = safeText(meta.title || '');
    const artist = safeText(meta.author_name || '');
    const searchTerm = `${title} ${artist}`.trim() || q;
    const tracks = await findTopTrack(searchTerm);
    return { tracks, heading: tracks[0]?.title || title || q };
  }

  const tracks = await findTopTrack(q);
  return { tracks, heading: tracks[0]?.title || q };
}

// Cache direct audio stream URLs briefly so browser <audio> seeking & instant play work smoothly
const streamUrlCache = new Map();

function getDirectAudioUrl(videoId) {
  const cached = streamUrlCache.get(videoId);
  if (cached && cached.expires > Date.now()) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const proc = spawn('yt-dlp', [
      '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
      '--no-playlist',
      '--no-warnings',
      '-J',
      watchUrl
    ], { windowsHide: true });

    let out = '';
    let err = '';
    proc.stdout.on('data', d => (out += d.toString()));
    proc.stderr.on('data', d => (err += d.toString()));
    proc.on('error', () => reject(new Error('yt-dlp installed nahi hai. PowerShell mein "winget install yt-dlp" run karein.')));
    proc.on('close', code => {
      if (code !== 0 || !out.trim()) {
        return reject(new Error(err || 'Audio stream extract nahi ho saki.'));
      }
      try {
        const info = JSON.parse(out);
        const directUrl = info.url;
        const ext = info.ext || 'm4a';
        const mime = ext === 'webm' ? 'audio/webm' : (ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
        if (!directUrl) return reject(new Error('Direct audio URL nahi mili.'));
        const entry = { url: directUrl, mime, expires: Date.now() + 10 * 60 * 1000 };
        streamUrlCache.set(videoId, entry);
        resolve(entry);
      } catch (e) {
        reject(new Error('Audio metadata parse error.'));
      }
    });
  });
}

// Proxy direct audio with Range header support so browser player plays & seeks reliably
async function handleStream(videoId, req, res) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return send(res, 400, { error: 'Invalid track ID.' });
  }
  try {
    const { url: audioUrl, mime } = await getDirectAudioUrl(videoId);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstream = await fetch(audioUrl, { headers });
    if (!upstream.ok && upstream.status !== 206) {
      streamUrlCache.delete(videoId);
      return send(res, 502, { error: 'Audio stream load nahi ho saki.' });
    }

    const resHeaders = {
      'Content-Type': upstream.headers.get('content-type') || mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    };
    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    if (contentLength) resHeaders['Content-Length'] = contentLength;
    if (contentRange) resHeaders['Content-Range'] = contentRange;

    res.writeHead(upstream.status, resHeaders);

    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    req.on('close', () => {
      try { reader.cancel(); } catch {}
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writableEnded) res.write(Buffer.from(value));
    }
    if (!res.writableEnded) res.end();
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: e.message || 'Playback error' });
    else res.destroy();
  }
}

// Download MP3 via yt-dlp + ffmpeg
function handleDownload(videoId, quality, titleParam, req, res) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return send(res, 400, { error: 'Invalid track ID.' });
  }
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const q = ['128', '192', '320'].includes(String(quality)) ? String(quality) : '192';
  const cleanTitle = String(titleParam || `sonora-${videoId}`).replace(/[^a-zA-Z0-9._ -]/g, '_').trim().slice(0, 80) || `sonora-${videoId}`;
  const outName = `${cleanTitle}-${q}kbps.mp3`;

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Content-Disposition': `attachment; filename="${outName}"`,
    'Cache-Control': 'no-store'
  });

  const ytdlp = spawn('yt-dlp', [
    '-f', 'bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '-o', '-',
    watchUrl
  ], { windowsHide: true });

  const ff = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', 'pipe:0',
    '-vn',
    '-codec:a', 'libmp3lame',
    '-b:a', `${q}k`,
    '-f', 'mp3',
    'pipe:1'
  ], { windowsHide: true });

  ytdlp.stdout.pipe(ff.stdin);
  ff.stdout.pipe(res);

  const cleanup = () => {
    try { ytdlp.kill(); } catch {}
    try { ff.kill(); } catch {}
  };

  req.on('close', cleanup);
  ytdlp.stdin.on('error', () => {});
  ff.stdin.on('error', () => {});

  ytdlp.on('error', () => {
    cleanup();
    if (!res.headersSent) send(res, 500, { error: 'yt-dlp installed nahi hai. PowerShell mein "winget install yt-dlp" run karein.' });
    else res.destroy();
  });

  ff.on('error', () => {
    cleanup();
    if (!res.headersSent) send(res, 500, { error: 'FFmpeg installed nahi hai. PowerShell mein "winget install Gyan.FFmpeg" run karein.' });
    else res.destroy();
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (u.pathname === '/api/search' && req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').trim().slice(0, 300);
      if (q.length < 2) return send(res, 400, { error: 'Kam az kam 2 characters likhein.' });
      return send(res, 200, await search(q));
    }

    if (u.pathname === '/api/stream' && req.method === 'GET') {
      return await handleStream(u.searchParams.get('id'), req, res);
    }

    if (u.pathname === '/api/download' && req.method === 'GET') {
      return handleDownload(
        u.searchParams.get('id'),
        u.searchParams.get('quality'),
        u.searchParams.get('title'),
        req,
        res
      );
    }

    const pathname = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
    const baseDir = fs.existsSync(path.join(ROOT, 'public')) ? path.join(ROOT, 'public') : ROOT;
    const target = path.resolve(baseDir, `.${pathname}`);
    if (!target.startsWith(path.resolve(baseDir) + path.sep)) {
      return send(res, 403, { error: 'Forbidden' });
    }
    fs.readFile(target, (err, buf) =>
      err ? send(res, 404, { error: 'Not found' }) : send(res, 200, buf, MIME[path.extname(target)] || 'application/octet-stream')
    );
  } catch (e) {
    if (!res.headersSent) send(res, 502, { error: e.message || 'Search source unavailable' });
    else res.destroy();
  }
});

server.listen(PORT, () => console.log(`SONORA running at http://localhost:${PORT}`));
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} already busy. Close the old server or run with PORT=3001.`);
  else console.error(e);
  process.exitCode = 1;
});
