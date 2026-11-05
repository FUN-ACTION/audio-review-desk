import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css=readFileSync(new URL('../src/audio_review_desk/static/tour/tour.css',import.meta.url),'utf8');
const variables=Object.fromEntries([...css.match(/:root\s*\{([^}]+)\}/)[1].matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{6});/g)].map(match=>[match[1],match[2]]));
function rule(selector){const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const matches=[...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`,'g'))];assert.ok(matches.length,selector);return matches.map(match=>match[1]).join(';');}
function resolve(value){const variable=/^var\((--[a-z-]+)\)$/.exec(value);return variable?variables[variable[1]]:value;}
function declaration(body,property){const value=[...body.matchAll(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`,'g'))].at(-1)?.[1];assert.ok(value,property);return value.trim();}
function luminance(hex){const rgb=[1,3,5].map(offset=>parseInt(hex.slice(offset,offset+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return rgb.reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);}
function contrast(a,b){const values=[luminance(a),luminance(b)].sort((a,b)=>a-b);return (values[1]+.05)/(values[0]+.05);}
// Source color pairs only. This is not browser cascade, layout or full WCAG acceptance.
test('saved-copy confirmation text clears the normal-text threshold on its declared surface',()=>{
 const foreground=resolve(declaration(rule('.export-confirm'),'color'));
 const background=resolve(declaration(rule('.review-source'),'background'));
 assert.ok(contrast(foreground,background)>=4.5);
 assert.ok(contrast('#b95937','#f3f1e9')<4.5,'previous decorative accent did not suit functional small text');
});
test('editable note and time field boundaries clear three to one against their surface',()=>{
 for(const selector of ['.note-input','.range-time-pair input']){
  const body=rule(selector),border=declaration(body,'border');
  const foreground=resolve(border.match(/(?:var\(--[a-z-]+\)|#[0-9a-f]{6})/)[0]);
  assert.ok(contrast(foreground,variables['--surface'])>=3,selector);
 }
 assert.ok(contrast('#c9c9bc',variables['--surface'])<3,'previous boundary was too faint');
});
test('functional secondary copy remains readable on both light surfaces',()=>{
 for(const surface of ['--paper','--surface'])assert.ok(contrast(variables['--secondary'],variables[surface])>=4.5,surface);
});
