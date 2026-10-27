import { sampleSignal } from './studio-signal.js';

// Object URLs stay in this document. No file is sent to the application server.
export function createMusicPlayer({ onChange = () => {}, onLevel = () => {}, onError = () => {} } = {}, runtime = globalThis) {
  let context, analyser, values, source, media, mediaSource, objectURL;
  let playing = false, pending = false, disposed = false, generation = 0, frame = 0, name = '';
  const state = () => ({ playing, pending, name });
  const notify = () => onChange(state());
  const zero = () => { runtime.cancelAnimationFrame(frame); frame = 0; onLevel(0); };
  function pause() {
    generation++;
    pending = false;
    playing = false;
    if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = null; }
    media?.pause();
    zero(); notify();
  }
  function releaseFile() {
    mediaSource?.disconnect(); mediaSource = null;
    if (media) { media.onended = null; media.onerror = null; media.pause(); media.removeAttribute('src'); media.load(); media = null; }
    if (objectURL) runtime.URL.revokeObjectURL(objectURL);
    objectURL = null;
  }
  async function toggle() {
    if (disposed) return;
    if (playing || pending) { pause(); return; }
    pending = true; notify();
    const ticket = ++generation;
    try {
      const Context = runtime.AudioContext || runtime.webkitAudioContext;
      if (!Context) throw Error('audio_unavailable');
      context ||= new Context();
      await context.resume();
      if (disposed || generation !== ticket) return;
      if (!analyser) { analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.connect(context.destination); values = new Float32Array(512); }
      if (media) {
        const selectedMedia = media;
        if (!mediaSource) { mediaSource = context.createMediaElementSource(media); mediaSource.connect(analyser); }
        await selectedMedia.play();
        if (disposed || generation !== ticket) {
          // A newer play may be using the same element. Retire old elements,
          // but only pause the current one when the latest intent is paused.
          if (disposed || selectedMedia !== media || (!pending && !playing)) selectedMedia.pause();
          return;
        }
      } else {
        const signal = sampleSignal(22050, 'a');
        const buffer = context.createBuffer(1, signal.length, 22050); buffer.copyToChannel(signal, 0);
        source = context.createBufferSource(); source.buffer = buffer; source.connect(analyser);
        source.onended = () => { if (generation === ticket) pause(); }; source.start();
      }
      pending = false; playing = true; notify();
      const tick = () => {
        if (!playing || disposed) return;
        analyser.getFloatTimeDomainData(values);
        let energy = 0; for (const value of values) energy += value * value;
        onLevel(Math.min(1, Math.sqrt(energy / values.length) * 3));
        frame = runtime.requestAnimationFrame(tick);
      };
      frame = runtime.requestAnimationFrame(tick);
    } catch (error) {
      if (generation !== ticket || disposed) return;
      pause(); onError(error);
    }
  }
  function selectFile(file) {
    if (disposed || !file) return;
    pause(); releaseFile();
    name = file.name;
    objectURL = runtime.URL.createObjectURL(file);
    const selectedMedia = new runtime.Audio();
    media = selectedMedia; media.preload = 'metadata'; media.src = objectURL;
    media.onended = () => { if (!disposed && media === selectedMedia) pause(); };
    media.onerror = () => {
      if (disposed || media !== selectedMedia) return;
      pause(); onError(Error('file_unreadable'));
    };
    notify();
  }
  function reset() { if (disposed) return; pause(); releaseFile(); name = ''; notify(); }
  function dispose() { if (disposed) return; disposed = true; pause(); releaseFile(); analyser?.disconnect(); context?.close().catch(() => {}); }
  return { toggle, pause, selectFile, reset, dispose, get state() { return state(); } };
}
