// Keep generated edit positions exact. Display rounding must not change a
// saved boundary, exceed the clip length or collapse a submillisecond clip.
export function createTrimEditor({ start, end, duration, onChange = () => {} }) {
  const fields = { start, end };
  const bounded = (time) => {
    const limit = duration();
    return Number.isFinite(time) && Number.isFinite(limit) && limit > 0
      ? Math.max(0, Math.min(limit, time))
      : null;
  };
  const write = (field, time) => {
    field.value = time === null ? "" : String(time);
    // Setting .value does not dispatch the input event that normally clears
    // a previous native/custom validation message.
    field.setCustomValidity("");
  };
  return {
    boundary(side, time) {
      const value = bounded(time);
      if (!(side === "start" || side === "end") || value === null) return false;
      write(fields[side], value);
      onChange();
      return true;
    },
    range(left, right) {
      const values = [bounded(left), bounded(right)];
      if (values.some((value) => value === null)) return false;
      write(start, values[0]);
      write(end, values[1]);
      onChange();
      return true;
    },
    reset() {
      write(start, null);
      write(end, null);
      onChange();
    },
  };
}
