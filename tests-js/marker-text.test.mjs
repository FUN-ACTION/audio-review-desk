import test from "node:test";
import assert from "node:assert/strict";
import { stripMarkerText } from "../src/audio_review_desk/static/marker-text.js";
import { reviseMarker } from "../src/audio_review_desk/static/markers.js";
import { copyMarkerDraft } from "../src/audio_review_desk/static/draft-recovery.js";
const whitespace = [9,10,11,12,13,28,29,30,31,32,133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288];
test("strip uses precisely the supported Python whitespace set over all Unicode codepoints", () => {
  const found = [];
  for (let point=0;point<=0x10ffff;point++) if (stripMarkerText(String.fromCodePoint(point)) === "") found.push(point);
  assert.deepEqual(found, whitespace);
});
for (const point of whitespace) test(`Python whitespace U+${point.toString(16)} strips only at the edges`, () => {
  const c=String.fromCodePoint(point);
  assert.equal(stripMarkerText(c+c+"hello"+c+c),"hello"); assert.equal(stripMarkerText("a"+c+"b"),"a"+c+"b");
  assert.throws(()=>reviseMarker([{time:1,text:"old"}],0,1,c,2),/marker_blank/);
  assert.equal(reviseMarker([{time:1,text:"old"}],0,1,c+"🎧".repeat(240)+c,2)[0].text,"🎧".repeat(240));
  assert.throws(()=>reviseMarker([{time:1,text:"old"}],0,1,c+"a".repeat(241)+c,2),/marker_text/);
});
for (const c of ["\ufeff","\u200b","\u180e"]) test(`non-Python whitespace ${c.codePointAt(0).toString(16)} remains intact`, () => {
  assert.equal(stripMarkerText(c+"text"+c),c+"text"+c);
  assert.equal(reviseMarker([{time:1,text:"old"}],0,1,c,2)[0].text,c);
  const snapshot={rows:[{time:1,text:c}],input:c,editing:null};assert.deepEqual(copyMarkerDraft(snapshot),snapshot);
});
