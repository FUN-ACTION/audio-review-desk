import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRangeTime, formatRangeTime, resolveRangeInput } from '../src/audio_review_desk/static/tour/range-time.js';
import { moveSampleEdge } from '../src/audio_review_desk/static/tour/studio-signal.js';

test('typed times accept documented seconds and clock notation, including full-width input',()=>{
  for(const [input,expected] of [['0',0],['.5',.5],[' 90.125 ',90.125],['1:02.345',62.345],['60:00',3600],['01:02.500',62.5],['１：０２．３４５',62.345]])assert.equal(parseRangeTime(input),expected,input);
});
test('typed times reject partial, ambiguous, non-finite and executable-looking numeric forms',()=>{
  for(const input of ['', ' ', '-', '-1', '+1', '1.', '1:', '1:2', '1:60', '1:02:03', '1.2345', 'NaN', 'Infinity', '1e3', '0x10', '1,500', '1/2', '1 2', '1:02suffix', '0'.repeat(21), null, 3])assert.equal(parseRangeTime(input),null,String(input));
});
test('range formatting carries across milliseconds, seconds and hours',()=>{
  for(const [value,expected] of [[0,'0:00.000'],[.08,'0:00.080'],[59.9996,'1:00.000'],[3599.9996,'60:00.000'],[95.123456,'1:35.123']])assert.equal(formatRangeTime(value),expected);
});
test('paired validation rejects invalid ranges without clamping the request',()=>{
  for(const [start,end,duration,error,fields] of [['bad','12',12,'rangeInputFormatError',['start']],['1','',12,'rangeInputFormatError',['end']],['-1','x',12,'rangeInputFormatError',['start','end']],['1','13',12,'rangeInputBoundsError',['end']],['13','14',12,'rangeInputBoundsError',['start','end']],['6','5',12,'rangeInputLengthError',['start','end']],['5','5',12,'rangeInputLengthError',['start','end']],['5','5.249',12,'rangeInputLengthError',['start','end']]])assert.deepEqual(resolveRangeInput(start,end,duration),{ok:false,error,fields});
  assert.deepEqual(resolveRangeInput('30:00.125','30:01.875',3600),{ok:true,range:[1800.125,1801.875]});
});
test('whole short files and non-millisecond metadata endpoints remain valid',()=>{
  for(const duration of [.05,.0504,.0506,.08,.25,95.123456,3600]){
    const range=[0,duration];const result=resolveRangeInput(formatRangeTime(0),formatRangeTime(duration),duration,range);
    assert.equal(result.ok,true,String(duration));assert.deepEqual(result.range,range);
  }
  const current=[.100012,.350012];assert.deepEqual(resolveRangeInput('0.100','0.350',12,current).range,current);
  assert.deepEqual(resolveRangeInput('95','1:35.123',95.123456).range,undefined,'minimum interval still applies');
  assert.equal(resolveRangeInput('94','1:35.123',95.123456).range[1],95.123456);
});
test('exact decimal minimum remains valid through a later sample slider edit',()=>{
  const result=resolveRangeInput('.1','.35',12);assert.equal(result.ok,true);
  assert.doesNotThrow(()=>moveSampleEdge(...result.range,'end',.5));
  assert.deepEqual(moveSampleEdge(...result.range,'end',.5),[.1,.5]);
});
test('invalid duration never produces a usable interval',()=>{
  for(const value of [NaN,Infinity,0,-1,3600.001])assert.throws(()=>resolveRangeInput('0','1',value),RangeError);
});


test('matching an applied endpoint takes precedence over a nearby rounded file end',()=>{
  for(const [duration,end] of [[10.0004,10],[10.00049,10.0001],[95.123456,95.123]]){
    const current=[0,end];assert.deepEqual(resolveRangeInput('0',formatRangeTime(end),duration,current),{ok:true,range:current});
  }
});
