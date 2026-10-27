export const sampleDuration = 12;
export function sampleSignal(rate = 22050, variant = "a") {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000)
    throw new RangeError("sample rate");
  if (!["a", "b"].includes(variant)) throw new RangeError("variant");
  const signal = new Float32Array(Math.round(rate * sampleDuration));
  const notes = [
    [0.15, 261.626],
    [0.9, 329.628],
    [1.7, 391.995],
    [3.2, 246.942],
    [4.3, 391.995],
    [5.6, 329.628],
    [7.2, 293.665],
    [9.3, 261.626],
  ];
  for (const [start, frequency] of notes) {
    const length = Math.min(2.65, sampleDuration - start);
    for (let i = 0; i < rate * length; i++) {
      const t = i / rate,
        phase = 2 * Math.PI * frequency * t;
      const envelope = (1 - Math.exp(-t * 95)) * Math.exp(-t * 2.7);
      const tone =
        Math.sin(phase) +
        (variant === "a" ? 0.34 : 0.18) * Math.sin(phase * 2.001) +
        0.12 * Math.sin(phase * 3.006) +
        0.04 * Math.sin(phase * 5.012);
      signal[Math.floor(start * rate) + i] += envelope * tone;
    }
  }
  const rms = Math.sqrt(
    signal.reduce((sum, n) => sum + n * n, 0) / signal.length,
  );
  for (let i = 0; i < signal.length; i++) signal[i] *= 0.095 / rms;
  return signal;
}
export function signalPeaks(signal, count = 160) {
  if (!Number.isInteger(count) || count < 1 || count > signal.length)
    throw new RangeError("peak count");
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * signal.length) / count),
      end = Math.floor(((index + 1) * signal.length) / count);
    let peak = 0;
    for (let i = start; i < end; i++)
      peak = Math.max(peak, Math.abs(signal[i]));
    return peak;
  });
}
export function clampSampleTime(time) {
  return Number.isFinite(time)
    ? Math.min(sampleDuration, Math.max(0, time))
    : 0;
}
export function moveSampleEdge(start, end, edge, value) {
  if (
    ![start, end].every(Number.isFinite) ||
    start < 0 ||
    end > sampleDuration ||
    end - start < 0.25
  )
    throw new RangeError("selection");
  if (!["start", "end"].includes(edge)) throw new RangeError("edge");
  const time = clampSampleTime(value);
  return edge === "start"
    ? [Math.min(time, end - 0.25), end]
    : [start, Math.max(start + 0.25, time)];
}
