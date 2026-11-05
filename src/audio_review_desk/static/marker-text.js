// Python str.strip whitespace in supported Python 3.12 / Unicode 15.0 and
// Python 3.13 / Unicode 15.1. This is not ECMAScript trim or Unicode White_Space:
// Python includes U+001C–001F and U+0085, but preserves U+FEFF.
// Strip only on deliberate validation/commit, never when copying a raw draft.
const edgeWhitespace = /^[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/g;
export const stripMarkerText = value => String(value).replace(edgeWhitespace, "");
