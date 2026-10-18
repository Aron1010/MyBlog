const MUSIC_MEDIA = {};
(() => {
  const tracks = MUSIC_TRACKS;
  const audio = document.querySelector('#blog-audio');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock = seconds => Number.isFinite(seconds) ? Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0') : '0:00';
  const icons = {
    play: '<path d="m8 5 11 7-11 7Z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
    previous: '<path d="M5 5v14m14-14L8 12l11 7Z"/>', next: '<path d="M19 5v14M5 5l11 7-11 7Z"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    volume: '<path d="m11 5-6 4H2v6h3l6 4Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    muted: '<path d="m11 5-6 4H2v6h3l6 4Zm5 4 6 6m0-6-6 6"/>',
    sequence: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3M12 10v5"/>',
    shuffle: '<path d="m18 3 3 3-3 3M3 18 15 6h6M3 6h3l12 12h3m-3-3 3 3-3 3"/>',
    lyrics: '<path d="M4 5h16v12H9l-5 4Zm4 4h8m-8 4h5"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem('breeze-music') || '{}') || {}; } catch {}
  let index = Math.max(0, tracks.findIndex(t => t.id === settings.track));
  let mode = ['sequence','repeat','shuffle'].includes(settings.mode) ? settings.mode : 'sequence';
  audio.volume = Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : .45;
  let lastVolume = audio.volume || .45, message = '', pendingSeek = null;
  const expanded = new Map();
  const modeLabels = {sequence:'顺序播放', repeat:'单曲循环', shuffle:'随机播放'};
  const roots = () => [...document.querySelectorAll('[data-music-player]')];
  const mediaPath = src => (document.documentElement.dataset.routing === 'path' && location.protocol !== 'file:' ? '/' : '') + src;
  const cover = track => MUSIC_MEDIA[track.cover] || mediaPath(track.cover);
  const duration = () => Number.isFinite(audio.duration) ? audio.duration : tracks[index].duration;
  function save() {
    try { localStorage.setItem('breeze-music', JSON.stringify({track:tracks[index].id,mode,volume:audio.volume})); } catch {}
  }
  function button(action, label, image, context, extra = '') {
    return `<button type="button" class="music-button music-${action}" data-music-action="${action}" aria-label="${context} ${label}" ${extra}>${icon(image)}</button>`;
  }
  function markup(context) {
    const track = tracks[index];
    const key = context === '侧边栏' ? 'sidebar' : 'navbar';
    return `<section class="music-player" data-music-player="${key}" data-music-context="${context}" aria-label="${context}音乐播放器"><div class="music-heading"><h3>听一会儿</h3><span>${tracks.length} 首收藏</span></div><div class="music-track"><img class="music-cover" src="${cover(track)}" alt="${escape(track.title)} 封面"><div class="music-info"><h4 data-music-title>${escape(track.title)}</h4><p data-music-artist>${escape(track.artist)}</p></div></div><div class="music-progress"><label class="sr-only" for="music-seek-${key}">${context} 播放进度</label><input id="music-seek-${key}" type="range" min="0" max="${track.duration}" step=".1" value="0" data-music-seek><div class="music-time"><span data-music-time>0:00</span><span data-music-duration>${clock(track.duration)}</span></div></div><div class="music-controls">${button('mode','播放模式：' + modeLabels[mode],mode,context)}${button('previous','上一首','previous',context)}${button('play','播放','play',context)}${button('next','下一首','next',context)}${button('list','播放列表','list',context,`aria-expanded="false" aria-controls="music-list-${key}"`)}</div><div class="music-secondary"><div class="music-volume">${button('mute','静音','volume',context)}<label class="sr-only" for="music-volume-${key}">${context} 音量</label><input id="music-volume-${key}" type="range" min="0" max="100" step="1" value="${Math.round(audio.volume*100)}" data-music-volume></div><button type="button" class="music-lyrics-button" data-music-action="lyrics" aria-expanded="false" aria-controls="music-lyrics-${key}">${icon('lyrics')}歌词</button></div><p class="music-status" data-music-status role="status" hidden></p><div class="music-lyrics" id="music-lyrics-${key}" hidden><p data-lyric-before></p><p data-lyric-current></p><p data-lyric-after></p></div><ol class="music-playlist" id="music-list-${key}" hidden>${tracks.map((t,i)=>`<li><button type="button" data-music-track="${i}"><span class="music-number">${String(i+1).padStart(2,'0')}</span><span><strong>${escape(t.title)}</strong><small>${escape(t.artist)}</small></span><span>${clock(t.duration)}</span></button></li>`).join('')}</ol></section>`;
  }
  function syncTime() {
    const time = audio.currentTime || 0, total = duration();
    const lyrics = tracks[index].lyrics;
    let current = -1;
    for (let i=0; i<lyrics.length && lyrics[i].time <= time; i++) current = i;
    roots().forEach(root => {
      const seek = root.querySelector('[data-music-seek]');
      seek.max = total || 1;
      seek.style.setProperty('--music-fill', Math.min(100, total ? time / total * 100 : 0) + '%');
      if (document.activeElement !== seek) seek.value = time;
      seek.setAttribute('aria-valuetext', clock(time) + ' / ' + clock(total));
      root.querySelector('[data-music-time]').textContent = clock(time);
      root.querySelector('[data-music-duration]').textContent = clock(total);
      root.querySelector('[data-lyric-before]').textContent = lyrics[current-1]?.text || '';
      root.querySelector('[data-lyric-current]').textContent = current < 0 ? '前奏 · 听一会儿' : lyrics[current]?.text || '♪';
      root.querySelector('[data-lyric-after]').textContent = lyrics[current+1]?.text || '';
    });
  }
  function refresh() {
    const track = tracks[index], playing = !audio.paused;
    roots().forEach(root => {
      const context = root.dataset.musicContext, panels = expanded.get(root.dataset.musicPlayer) || {};
      root.querySelector('[data-music-title]').textContent = track.title;
      root.querySelector('[data-music-artist]').textContent = track.artist;
      const artwork = root.querySelector('.music-cover');
      if (artwork.dataset.track !== track.id) { artwork.src = cover(track); artwork.alt = track.title + ' 封面'; artwork.dataset.track = track.id; }
      const play = root.querySelector('[data-music-action="play"]');
      play.innerHTML = icon(playing ? 'pause':'play');
      play.setAttribute('aria-label', context + (playing ? ' 暂停':' 播放'));
      root.classList.toggle('is-playing', playing);
      const modeButton = root.querySelector('[data-music-action="mode"]');
      modeButton.innerHTML = icon(mode);
      modeButton.setAttribute('aria-label',context + ' 播放模式：' + modeLabels[mode]);
      const mute = root.querySelector('[data-music-action="mute"]');
      mute.innerHTML = icon(audio.volume === 0 ? 'muted':'volume');
      mute.setAttribute('aria-label',context + (audio.volume === 0 ? ' 取消静音':' 静音'));
      const volume = root.querySelector('[data-music-volume]');
      volume.value = Math.round(audio.volume * 100);
      volume.style.setProperty('--music-fill', Math.round(audio.volume * 100) + '%');
      for (const name of ['list','lyrics']) {
        root.querySelector('[data-music-action="' + name + '"]').setAttribute('aria-expanded',String(!!panels[name]));
        root.querySelector(name === 'list' ? '.music-playlist':'.music-lyrics').hidden = !panels[name];
      }
      root.querySelectorAll('[data-music-track]').forEach(button => {
        const active = Number(button.dataset.musicTrack) === index;
        button.classList.toggle('is-current',active);
        if (active) button.setAttribute('aria-current','true'); else button.removeAttribute('aria-current');
      });
      const status = root.querySelector('[data-music-status]');
      status.hidden = !message; status.textContent = message;
    });
    const toggle = document.querySelector('#music-open');
    toggle.classList.toggle('is-playing',playing);
    toggle.setAttribute('aria-label','音乐播放器' + (playing ? '：正在播放 ' + track.title : ''));
    syncTime();
  }
  async function play() {
    message = ''; refresh();
    try { await audio.play(); } catch(error) {
      if (error.name === 'AbortError') return;
      message = error.name === 'NotAllowedError' ? '点击播放，开始听歌。' : '暂时无法播放，试试其他曲目。';
      refresh();
    }
  }
  function select(nextIndex, autoplay = true) {
    index = (nextIndex + tracks.length) % tracks.length;
    pendingSeek = null; message = '';
    audio.src = mediaPath(tracks[index].src);
    save(); refresh();
    if (autoplay) play();
  }
  function next(direction) {
    let target = index + direction;
    if (mode === 'shuffle') target = (index + 1 + Math.floor(Math.random() * (tracks.length-1))) % tracks.length;
    select(target);
  }
  document.addEventListener('click', event => {
    const root = event.target.closest('[data-music-player]');
    if (!root) return;
    const item = event.target.closest('[data-music-track]');
    if (item) { select(Number(item.dataset.musicTrack)); return; }
    const action = event.target.closest('[data-music-action]')?.dataset.musicAction;
    if (action === 'play') { if (audio.paused) play(); else audio.pause(); }
    if (action === 'previous') next(-1);
    if (action === 'next') next(1);
    if (action === 'mode') { const modes=['sequence','repeat','shuffle']; mode=modes[(modes.indexOf(mode)+1)%modes.length]; save(); refresh(); }
    if (action === 'mute') { if (audio.volume) {lastVolume=audio.volume; audio.volume=0;} else audio.volume=lastVolume; }
    if (action === 'list' || action === 'lyrics') {
      const panels = expanded.get(root.dataset.musicPlayer) || {};
      panels[action] = !panels[action]; expanded.set(root.dataset.musicPlayer,panels); refresh();
    }
  });
  document.addEventListener('input', event => {
    if (event.target.matches('[data-music-volume]')) audio.volume = Number(event.target.value) / 100;
    if (event.target.matches('[data-music-seek]')) {
      const time = Number(event.target.value);
      if (audio.readyState >= 1) audio.currentTime = time;
      else { pendingSeek = time; audio.load(); }
      syncTime();
    }
  });
  audio.addEventListener('loadedmetadata', () => { if(pendingSeek !== null) {audio.currentTime=pendingSeek; pendingSeek=null;} syncTime(); });
  audio.addEventListener('timeupdate',syncTime);
  audio.addEventListener('durationchange',syncTime);
  ['play','pause','ended'].forEach(event => audio.addEventListener(event,refresh));
  audio.addEventListener('volumechange',()=>{save();refresh();});
  audio.addEventListener('ended',()=>{ if(mode==='repeat'){audio.currentTime=0;play();}else next(1); });
  audio.addEventListener('error',()=>{message='这首歌暂时无法播放，试试其他曲目。';refresh();});
  const panel = document.querySelector('#music-panel');
  panel.innerHTML = `<button class="music-panel-close" type="button" popovertarget="music-panel" popovertargetaction="hide" aria-label="关闭音乐播放器">×</button>` + markup('顶部');
  panel.addEventListener('toggle',()=>document.querySelector('#music-open').setAttribute('aria-expanded',String(panel.matches(':popover-open'))));
  window.BlogMusic = {markup,refresh};
  select(index,false);
})();
