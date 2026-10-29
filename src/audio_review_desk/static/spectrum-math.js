// A bounded, windowed real-signal FFT. All values describe the supplied PCM.
export const SPECTRUM_LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  seconds: 120,
  columns: 512,
  rows: 192,
  fftSize: 1024,
  floorDb: -90,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function createSpectrumAnalyzer(size = SPECTRUM_LIMITS.fftSize) {
  if (!Number.isInteger(size) || size < 32 || size > 4096 || (size & (size - 1)))
    throw new RangeError("FFT size must be a power of two between 32 and 4096");
  const real = new Float64Array(size), imag = new Float64Array(size);
  const window = Float64Array.from({ length: size }, (_, n) =>
    0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1)));
  const gain = window.reduce((sum, value) => sum + value, 0);
  const reverse = new Uint16Array(size);
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    reverse[i] = j;
  }
  return (samples, offset = 0) => {
    offset = Math.trunc(offset);
    for (let i = 0; i < size; i++) {
      const index = reverse[i], sample = samples[index + offset];
      real[i] = (Number.isFinite(sample) ? sample : 0) * window[index];
      imag[i] = 0;
    }
    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2, angle = (-2 * Math.PI) / width;
      const wr = Math.cos(angle), wi = Math.sin(angle);
      for (let start = 0; start < size; start += width) {
        let tr = 1, ti = 0;
        for (let j = 0; j < half; j++) {
          const a = start + j, b = a + half;
          const br = real[b] * tr - imag[b] * ti;
          const bi = real[b] * ti + imag[b] * tr;
          real[b] = real[a] - br; imag[b] = imag[a] - bi;
          real[a] += br; imag[a] += bi;
          const next = tr * wr - ti * wi;
          ti = tr * wi + ti * wr; tr = next;
        }
      }
    }
    return Float32Array.from({ length: size / 2 + 1 }, (_, i) =>
      Math.hypot(real[i], imag[i]) * (i === 0 || i === size / 2 ? 1 : 2) / gain);
  };
}

export function logFrequencyBins(sampleRate, rows = SPECTRUM_LIMITS.rows,
  fftSize = SPECTRUM_LIMITS.fftSize) {
  if (!(sampleRate > 0) || !Number.isInteger(rows) || rows < 2 || rows > 512)
    throw new RangeError("Invalid frequency scale");
  const high = Math.min(16000, sampleRate / 2), low = Math.min(80, high / 2);
  const bins = Array.from({ length: rows }, (_, row) => {
    const hz = low * (high / low) ** (row / (rows - 1));
    return hz * fftSize / sampleRate;
  });
  return { bins, low, high };
}

export function spectrumLevels(magnitudes, bins, floorDb = SPECTRUM_LIMITS.floorDb) {
  if (!(floorDb < 0)) throw new RangeError("The dB floor must be negative");
  return Uint8Array.from(bins, bin => {
    const index = clamp(Math.floor(bin), 0, magnitudes.length - 1);
    const next = Math.min(index + 1, magnitudes.length - 1);
    const fraction = clamp(bin - index, 0, 1);
    const amplitude = magnitudes[index] * (1 - fraction) + magnitudes[next] * fraction;
    const db = amplitude > 0 ? 20 * Math.log10(amplitude) : floorDb;
    return Math.round(clamp((db - floorDb) / -floorDb, 0, 1) * 255);
  });
}

export async function analyzeSpectrogram(samples, sampleRate, {
  columns = SPECTRUM_LIMITS.columns,
  rows = SPECTRUM_LIMITS.rows,
  maxSeconds = SPECTRUM_LIMITS.seconds,
  fftSize = SPECTRUM_LIMITS.fftSize,
  cancelled = () => false,
  yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)),
} = {}) {
  if (!(sampleRate > 0) || !samples?.length) throw new RangeError("No PCM samples");
  if (!Number.isInteger(columns) || columns < 1 || columns > SPECTRUM_LIMITS.columns ||
      !Number.isInteger(rows) || rows < 2 || rows > SPECTRUM_LIMITS.rows ||
      !(maxSeconds > 0) || maxSeconds > SPECTRUM_LIMITS.seconds)
    throw new RangeError("Spectrum analysis exceeds its bounds");
  const count = Math.min(samples.length, Math.floor(sampleRate * maxSeconds));
  const seconds = count / sampleRate, fullDuration = samples.length / sampleRate;
  const scale = logFrequencyBins(sampleRate, rows, fftSize);
  const analyze = createSpectrumAnalyzer(fftSize);
  const data = new Uint8Array(columns * rows);
  for (let column = 0; column < columns; column++) {
    if (cancelled()) return null;
    const center = ((column + 0.5) / columns) * count;
    const spectrum = analyze(samples, Math.round(center - fftSize / 2));
    data.set(spectrumLevels(spectrum, scale.bins), column * rows);
    if (column % 8 === 7 && column < columns - 1) await yieldControl();
  }
  if (cancelled()) return null;
  return { data, columns, rows, seconds, fullDuration,
    minHz: scale.low, maxHz: scale.high, sampleRate, fftSize };
}

// The same stops are used for every source; brightness is never normalized per file.
const stops = [
  [0, 8, 17, 33], [0.2, 14, 29, 64], [0.48, 30, 81, 152],
  [0.72, 43, 165, 204], [0.9, 136, 222, 229], [1, 246, 242, 210],
];
export function spectrumColor(level) {
  const value = clamp(level / 255, 0, 1);
  const end = stops.findIndex(stop => stop[0] >= value);
  const b = stops[Math.max(1, end)], a = stops[Math.max(0, end - 1)];
  const t = (value - a[0]) / (b[0] - a[0]);
  return [1, 2, 3].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
}
