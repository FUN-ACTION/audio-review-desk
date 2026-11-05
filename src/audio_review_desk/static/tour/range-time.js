// Typed time is committed as a pair. Browser audition is not sample-accurate editing.
export function parseRangeTime(input) {
  if (typeof input !== 'string' || input.length > 20) return null;
  const value = input.normalize('NFKC').trim();
  if (/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds : null;
  }
  const clock = /^(\d+):([0-5]\d(?:\.\d{1,3})?)$/.exec(value);
  if (!clock) return null;
  const seconds = Number(clock[1]) * 60 + Number(clock[2]);
  return Number.isFinite(seconds) ? seconds : null;
}

export function formatRangeTime(value) {
  const milliseconds = Math.round(value * 1000);
  return `${Math.floor(milliseconds / 60000)}:${Math.floor(milliseconds / 1000 % 60).toString().padStart(2, '0')}.${(milliseconds % 1000).toString().padStart(3, '0')}`;
}

export function resolveRangeInput(startText, endText, duration, current = []) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new RangeError('Invalid duration');
  const inputs = [startText, endText], fields = ['start', 'end'];
  const values = inputs.map(parseRangeTime);
  const invalid = fields.filter((_, index) => values[index] === null);
  if (invalid.length) return { ok: false, error: 'rangeInputFormatError', fields: invalid };
  // Metadata durations need not align to milliseconds. Leaving a displayed edge
  // unchanged preserves its exact value; the displayed file end resolves to EOF.
  const preserved = [false, false];
  for (let index = 0; index < 2; index++) {
    if (Number.isFinite(current[index]) && values[index] === parseRangeTime(formatRangeTime(current[index]))) {
      values[index] = current[index]; preserved[index] = true;
    }
  }
  if (!preserved[1] && parseRangeTime(endText) === parseRangeTime(formatRangeTime(duration))) values[1] = duration;
  const outside = fields.filter((_, index) => values[index] < 0 || values[index] > duration);
  if (outside.length) return { ok: false, error: 'rangeInputBoundsError', fields: outside };
  if (values[1] - values[0] < Math.min(.25, duration) - 1e-9)
    return { ok: false, error: 'rangeInputLengthError', fields };
  return { ok: true, range: values };
}
