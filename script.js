const $ = id => document.getElementById(id);
const form = $('searchForm'), query = $('query'), results = $('results'), loading = $('loading'), error = $('error');
const trackContainer = $('trackContainer'), playerBar = $('playerBar'), audioEl = $('audioEl');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function duration(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return 'Full Track';
  const sec = Math.floor(Number(ms) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function renderSingleSong(t) {
  const art = t.artwork ? `<img src="${esc(t.artwork)}" alt="">` : '♫';
  return `
    <div class="single-card" data-id="${esc(t.videoId)}" data-title="${esc(t.title)}" data-artist="${esc(t.artist)}" data-art="${esc(t.artwork || '')}">
      <div class="track">
        <div class="cover">${art}</div>
        <div class="track-meta">
          <b>${esc(t.title)}</b>
          <small>${esc(t.artist)} · ${duration(t.durationMs)}</small>
        </div>
        <div class="track-actions">
          <button type="button" class="pill primary play-btn">▶ Play Song</button>
        </div>
      </div>

      <div class="download-box">
        <span class="dl-icon">↓</span>
        <span class="dl-label">${esc(t.title)}</span>
        <select class="quality" aria-label="MP3 quality">
          <option value="128">128 kbps</option>
          <option value="192" selected>192 kbps</option>
          <option value="320">320 kbps</option>
        </select>
        <button type="button" class="dl-btn download">Download MP3 <span>↓</span></button>
      </div>
    </div>
  `;
}

function startPlayback(id, title, artist, art) {
  $('playerTitle').textContent = title;
  $('playerArtist').textContent = `${artist} · Loading audio...`;
  $('playerCover').innerHTML = art ? `<img src="${esc(art)}" alt="">` : '♫';
  playerBar.hidden = false;

  audioEl.src = `/api/stream?id=${encodeURIComponent(id)}`;
  audioEl.load();
  audioEl.play().then(() => {
    $('playerArtist').textContent = `${artist} · Playing full song`;
  }).catch(() => {
    $('playerArtist').textContent = `${artist} · Click play on bar below`;
  });
}

audioEl.addEventListener('playing', () => {
  const currentText = $('playerArtist').textContent;
  const artist = currentText.split('·')[0].trim();
  $('playerArtist').textContent = `${artist} · Playing full song`;
});

audioEl.addEventListener('error', () => {
  const currentText = $('playerArtist').textContent;
  const artist = currentText.split('·')[0].trim();
  $('playerArtist').textContent = `${artist} · Audio error (check yt-dlp)`;
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const q = query.value.trim();
  if (q.length < 2) {
    query.focus();
    return;
  }

  results.hidden = false;
  loading.hidden = false;
  error.hidden = true;
  $('empty').hidden = true;
  trackContainer.innerHTML = '';
  $('searchBtn').disabled = true;

  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Search failed');

    const tracks = data.tracks || [];
    if (!tracks.length) {
      $('empty').hidden = false;
      return;
    }

    const song = tracks[0];
    trackContainer.innerHTML = renderSingleSong(song);
    startPlayback(song.videoId, song.title, song.artist, song.artwork || '');
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    loading.hidden = true;
    $('searchBtn').disabled = false;
  }
});

document.addEventListener('click', e => {
  const playBtn = e.target.closest('.play-btn');
  if (playBtn) {
    const card = playBtn.closest('.single-card');
    startPlayback(card.dataset.id, card.dataset.title, card.dataset.artist, card.dataset.art);
    return;
  }

  const downloadBtn = e.target.closest('.download');
  if (downloadBtn) {
    const card = downloadBtn.closest('.single-card');
    const id = card.dataset.id;
    const rawTitle = card.dataset.title;
    const cleanTitle = rawTitle.replace(/[^a-zA-Z0-9._ -]/g, '_').trim() || id;
    const quality = card.querySelector('.quality').value;

    const oldHtml = downloadBtn.innerHTML;
    downloadBtn.textContent = 'Downloading...';
    downloadBtn.disabled = true;

    const a = document.createElement('a');
    a.href = `/api/download?id=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality)}&title=${encodeURIComponent(cleanTitle)}`;
    a.download = `${cleanTitle}-${quality}kbps.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      downloadBtn.innerHTML = oldHtml;
      downloadBtn.disabled = false;
    }, 2200);
  }
});

$('closePlayer').addEventListener('click', () => {
  audioEl.pause();
  audioEl.removeAttribute('src');
  audioEl.load();
  playerBar.hidden = true;
});
