const rates = [0.5, 0.75, 1, 1.25, 1.5];
const defaults = () => ({
  speed: 1,
  volume: 1,
  loop: false,
  remember: true,
  selected: null,
  positions: [],
});
export function cleanListeningState(value) {
  const result = defaults();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  if (rates.includes(value.speed)) result.speed = value.speed;
  if (Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1)
    result.volume = value.volume;
  if (typeof value.loop === "boolean") result.loop = value.loop;
  if (typeof value.remember === "boolean") result.remember = value.remember;
  if (typeof value.selected === "string" && value.selected.length <= 128)
    result.selected = value.selected;
  if (result.remember && Array.isArray(value.positions)) {
    result.positions = value.positions
      .filter(
        (row) =>
          row &&
          typeof row.key === "string" &&
          row.key.length <= 128 &&
          Number.isFinite(row.time) &&
          row.time >= 0,
      )
      .slice(-64)
      .map((row) => ({ key: row.key, time: row.time }));
  }
  return result;
}
export function resumedTime(memory, key, duration) {
  if (!memory.remember || !Number.isFinite(duration) || duration <= 0) return 0;
  const row = memory.positions.find((row) => row.key === key);
  return row && row.time < duration - 0.05 ? row.time : 0;
}
export function createListeningMemory(storage, scope) {
  const storageKey = `ard-listening-${scope}`;
  let value;
  try {
    const text = storage.getItem(storageKey);
    value = cleanListeningState(
      text && text.length <= 20000 ? JSON.parse(text) : null,
    );
  } catch {
    value = defaults();
  }
  const persist = () => {
    try {
      storage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  };
  return {
    get() {
      return cleanListeningState(value);
    },
    preferences(patch) {
      value = cleanListeningState({ ...value, ...patch });
      persist();
    },
    position(key, time) {
      if (typeof key !== "string" || !Number.isFinite(time) || time < 0) return;
      value.selected = key;
      if (value.remember)
        value.positions = [
          ...value.positions.filter((row) => row.key !== key),
          { key, time: Number(time.toFixed(3)) },
        ].slice(-64);
      persist();
    },
  };
}
