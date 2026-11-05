/** Browser-only, single-file listening. No file bytes are decoded into JS or sent anywhere. */
export const localReviewLimits = Object.freeze({ maxBytes: 64 * 1024 * 1024, maxSeconds: 3600, minSeconds: .05, metadataTimeoutMs: 12000 });

export function moveLocalEdge(start, end, edge, value, duration) {
  const minimum = Math.min(.25, duration);
  if (!Number.isFinite(duration) || duration < localReviewLimits.minSeconds || duration > localReviewLimits.maxSeconds ||
      ![start, end].every(Number.isFinite) || start < 0 || end > duration || end - start < minimum - 1e-9 || !['start', 'end'].includes(edge)) throw new RangeError('Invalid local range');
  const time = Number.isFinite(value) ? Math.min(duration, Math.max(0, value)) : 0;
  return edge === 'start' ? [Math.min(time, end - minimum), end] : [start, Math.max(start + minimum, time)];
}

function displayName(name) {
  // Keep the bounded display/export name without cutting a surrogate pair.
  return String(name || 'Local audio').split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240).replace(/[\uD800-\uDBFF]$/, '') || 'Local audio';
}

export function serializeLocalReview({ name, duration, range, notes }) {
  if (!Number.isFinite(duration) || duration < localReviewLimits.minSeconds || duration > localReviewLimits.maxSeconds ||
      !Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) || range[0] < 0 || range[1] > duration || range[0] >= range[1] ||
      !Array.isArray(notes) || notes.length > 20) throw new RangeError('Invalid local review');
  const items = notes.map(note => {
    if (!Number.isFinite(note.at) || note.at < 0 || note.at > duration || typeof note.text !== 'string' || !note.text.trim() || note.text.length > 120) throw new TypeError('Invalid local note');
    return { seconds: Math.round(note.at * 1000) / 1000, text: note.text };
  }).sort((a, b) => a.seconds - b.seconds);
  return JSON.stringify({ format: 'audio-review-desk-local-review', version: 1, source: { name: displayName(name) },
    duration_seconds: Math.round(duration * 1000) / 1000, selected_range_seconds: range.map(value => Math.round(value * 1000) / 1000),
    timing: 'Browser media playback; not sample-accurate editing', notes: items }, null, 2) + '\n';
}

export function createLocalReviewPlayer({ onEnded = () => {}, onError = () => {} } = {}, runtime = globalThis) {
  let current = null, candidate = null, loadGeneration = 0, playGeneration = 0, disposed = false;
  let playing = false, pending = false, frame = 0, plan = null;
  const time = () => Number.isFinite(current?.media.currentTime) ? current.media.currentTime : 0;
  function retire(entry) {
    if (!entry) return;
    entry.media.onloadedmetadata = entry.media.onerror = entry.media.onended = entry.media.ontimeupdate = null;
    entry.media.pause(); entry.media.removeAttribute('src'); entry.media.load();
    runtime.URL.revokeObjectURL(entry.url);
  }
  function pause() {
    playGeneration++; playing = pending = false;
    runtime.cancelAnimationFrame(frame); frame = 0;
    current?.media.pause();
  }
  function cancelLoad() {
    loadGeneration++;
    candidate?.finish({ ok: false, cancelled: true });
  }
  function playbackError(ticket) {
    if (disposed || ticket !== playGeneration) return;
    pause(); onError('localPlaybackError');
  }
  function boundary(ended = false) {
    if (!playing || !current || !plan) return;
    const ticket = playGeneration, entry = current;
    if (!ended && time() < plan.end) return;
    if (plan.loop) {
      // Native media seeking is deliberately identified as approximate audition,
      // not a sample-accurate trim or waveform analysis.
      try {
        entry.media.currentTime = plan.start;
        if (entry.media.paused || ended) Promise.resolve(entry.media.play()).then(() => {
          if ((disposed || ticket !== playGeneration || entry !== current) &&
              (disposed || entry !== current || (!playing && !pending))) entry.media.pause();
        }, () => playbackError(ticket));
      } catch { playbackError(ticket); }
    } else {
      const end = plan.end;
      pause();
      try { entry.media.currentTime = end; } catch {}
      onEnded();
    }
  }
  function tick() {
    frame = 0;
    if (!playing || disposed) return;
    boundary();
    if (playing) frame = runtime.requestAnimationFrame(tick);
  }
  function load(file) {
    cancelLoad(); pause();
    if (disposed) return Promise.resolve({ ok: false, cancelled: true });
    if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > localReviewLimits.maxBytes)
      return Promise.resolve({ ok: false, error: 'localSizeError' });
    if (typeof runtime.Audio !== 'function' || typeof runtime.URL?.createObjectURL !== 'function')
      return Promise.resolve({ ok: false, error: 'localUnsupported' });
    const ticket = ++loadGeneration;
    return new Promise(resolve => {
      let entry, timer, settled = false;
      const finish = result => {
        if (settled) return;
        settled = true; runtime.clearTimeout(timer);
        if (candidate?.finish === finish) candidate = null;
        if (!result.ok) retire(entry);
        resolve(result);
      };
      try {
        entry = { media: new runtime.Audio(), url: runtime.URL.createObjectURL(file), name: displayName(file.name), duration: 0 };
        candidate = { finish };
        entry.media.preload = 'metadata';
        entry.media.onloadedmetadata = () => {
          if (settled || disposed || ticket !== loadGeneration) return;
          const duration = entry.media.duration;
          if (!Number.isFinite(duration) || duration < localReviewLimits.minSeconds || duration > localReviewLimits.maxSeconds) {
            finish({ ok: false, error: 'localDurationError' }); return;
          }
          entry.duration = duration; entry.media.onloadedmetadata = null;
          retire(current); current = entry;
          entry.media.onerror = () => {
            if (!disposed && current === entry) { pause(); onError('localPlaybackError'); }
          };
          entry.media.onended = () => { if (current === entry) boundary(true); };
          entry.media.ontimeupdate = () => { if (current === entry) boundary(); };
          finish({ ok: true, source: { name: entry.name, duration } });
        };
        entry.media.onerror = () => { if (!settled) finish({ ok: false, error: 'localUnsupported' }); };
        timer = runtime.setTimeout(() => finish({ ok: false, error: 'localMetadataTimeout' }), localReviewLimits.metadataTimeoutMs);
        entry.media.src = entry.url; entry.media.load();
      } catch { finish({ ok: false, error: 'localUnsupported' }); }
    });
  }
  async function play({ at = 0, start = 0, end = current?.duration, loop = false } = {}) {
    pause();
    if (!current || disposed) return false;
    if (![at, start, end].every(Number.isFinite) || start < 0 || end > current.duration || end <= start) throw new RangeError('Invalid playback range');
    const ticket = ++playGeneration, entry = current;
    plan = { start, end, loop: !!loop }; pending = true;
    try {
      entry.media.currentTime = at < start || at >= end ? start : at;
      await entry.media.play();
      if (disposed || ticket !== playGeneration || entry !== current) {
        if (disposed || entry !== current || (!playing && !pending)) entry.media.pause();
        return false;
      }
      pending = false; playing = true; frame = runtime.requestAnimationFrame(tick);
      return true;
    } catch (error) {
      if (disposed || ticket !== playGeneration || entry !== current) return false;
      pause(); throw error;
    }
  }
  return {
    load, play, pause, cancelLoad,
    get time() { return time(); },
    get source() { return current ? { name: current.name, duration: current.duration } : null; },
    reset() { cancelLoad(); pause(); retire(current); current = null; plan = null; },
    dispose() { if (disposed) return; disposed = true; cancelLoad(); pause(); retire(current); current = null; plan = null; },
  };
}
