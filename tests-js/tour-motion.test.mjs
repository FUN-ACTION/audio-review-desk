import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { copy } from '../src/audio_review_desk/static/tour/tour-copy.js';

const source=readFileSync(new URL('../src/audio_review_desk/static/tour/tour.js',import.meta.url),'utf8');
function fixture(){
  const button={attrs:{},setAttribute(key,value){this.attrs[key]=value;}};
  const env={userPaused:null,reduced:{matches:false},$:()=>button,t:key=>copy.en[key],
    stage:{ready:false,setPaused(value){this.paused=value;}}};
  vm.createContext(env);
  for(const name of ['paintMotionAvailability','paintMotion'])
    vm.runInContext(source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0],env);
  return {env,button,paint:()=>vm.runInContext('paintMotion()',env)};
}
test('static fallback disables unavailable motion and describes the actual artwork',()=>{
  const f=fixture();f.paint();
  assert.equal(f.button.disabled,true);
  assert.equal(f.button.attrs['aria-label'],copy.en.staticMotion);
  assert.equal(f.button.title,copy.en.staticMotion);
  assert.equal(f.button.attrs['aria-pressed'],'true');
});
test('renderer recovery restores the user motion choice, and loss cannot advertise playing animation',()=>{
  const f=fixture();f.env.stage.ready=true;f.env.userPaused=true;f.paint();
  assert.equal(f.button.disabled,false);assert.equal(f.env.stage.paused,true);
  assert.equal(f.button.attrs['aria-label'],copy.en.playMotion);
  f.env.stage.ready=false;f.paint();assert.equal(f.button.disabled,true);
  f.env.stage.ready=true;f.env.userPaused=false;f.paint();
  assert.equal(f.button.attrs['aria-label'],copy.en.pauseMotion);
  assert.equal(f.button.attrs['aria-pressed'],'false');
});
test('reduced motion is respected until deliberately overridden and fallback labels translate',()=>{
  const f=fixture();f.env.stage.ready=true;f.env.reduced.matches=true;f.paint();
  assert.equal(f.env.stage.paused,true);
  f.env.userPaused=false;f.paint();assert.equal(f.env.stage.paused,false);
  f.env.stage.ready=false;f.env.t=key=>copy.zh[key];f.paint();
  assert.equal(f.button.attrs['aria-label'],copy.zh.staticMotion);
});
