import test from "node:test";
import assert from "node:assert/strict";
import { advanceArtBlend, coverCrop, createArtRenderer, makeArtDepth, makeArtGrid, mountArtStage } from "../src/audio_review_desk/static/tour/art-stage.js";

test("artwork cover crops preserve proportions in wide and tall containers", () => {
  assert.deepEqual(coverCrop(1600,900,1600,900),[1,1]);
  assert.deepEqual(coverCrop(1600,800,1600,1200),[1,2/3]);
  assert.deepEqual(coverCrop(400,800,1600,800),[.25,1]);
  for(const args of [[0,1,1,1],[1,NaN,1,1],[1,1,Infinity,1]])assert.throws(()=>coverCrop(...args),RangeError);
});

test("artwork blend preserves presentation and velocity across an interrupted transition", () => {
  function run(hz) {
    const values=new Float64Array([1,0,0]),velocity=new Float64Array(3);
    for(let frame=0;frame<hz;frame++)advanceArtBlend(values,velocity,[0,1,0],1/hz);
    const before=[...values],motion=[...velocity];advanceArtBlend(values,velocity,[0,0,1],0);
    assert.deepEqual([...values],before);assert.deepEqual([...velocity],motion);
    for(let frame=0;frame<hz*2;frame++)advanceArtBlend(values,velocity,[0,0,1],1/hz);
    assert.ok(Math.abs(values.reduce((sum,n)=>sum+n,0)-1)<1e-12);
    return [...values,...velocity];
  }
  const slow=run(30),fast=run(120);
  slow.forEach((n,i)=>assert.ok(Math.abs(n-fast[i])<1e-12));
  const values=new Float64Array([1,0,0]),snapshot=[...values];
  assert.throws(()=>advanceArtBlend(values,[0,0,0],[0,NaN,1],.02),RangeError);assert.deepEqual([...values],snapshot);
});

test("relief grid has finite positions, consistent winding and portable indices",()=>{
  const {positions,indices}=makeArtGrid();assert.equal(positions.length/2,24897);assert.equal(indices.length/3,49152);
  assert.ok(positions.every(Number.isFinite));assert.ok(indices.every(index=>index<positions.length/2));
  for(let i=0;i<indices.length;i+=3) {
    const [a,b,c]=[indices[i],indices[i+1],indices[i+2]].map(index=>index*2);
    assert.ok((positions[b]-positions[a])*(positions[c+1]-positions[a+1])-(positions[b+1]-positions[a+1])*(positions[c]-positions[a])>0);
  }
  assert.throws(()=>makeArtGrid(256,256),RangeError);
});

test("estimated depth is blurred, slope-limited, bottom-up and leaves the original pixels unchanged",()=>{
  const width=48,height=32,pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*4,n=y<height/2?255:0;pixels.set([n,n,n,255],at);
  }
  const before=pixels.slice(),map=makeArtDepth(pixels,width,height);assert.deepEqual(pixels,before);
  assert.ok(map.data[0]<map.data[(height-1)*width*4],"texture rows must match the flipped color upload");
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=(y*width+x)*4;assert.equal(map.data[at],map.data[at+1]);assert.equal(map.data[at+3],255);
    if(x)assert.ok(Math.abs(map.data[at]-map.data[at-4])<=4);
    if(y)assert.ok(Math.abs(map.data[at]-map.data[at-width*4])<=4);
  }
  assert.throws(()=>makeArtDepth(pixels,2,2),RangeError);
});

function mockGL(fault="",{vertexUnits=8}={}) {
  const made=[],deleted=new Set(),counts=new Map(),uniforms=new Map(),sources=[];
  let lost=false,draws=0;
  const allocate=kind=>{
    const count=(counts.get(kind)||0)+1;counts.set(kind,count);
    if(fault===`${kind}${count}`)return null;
    const value={kind,id:made.length};made.push(value);return value;
  };
  const gl={
    NO_ERROR:0,MAX_TEXTURE_IMAGE_UNITS:1,MAX_TEXTURE_SIZE:2,COMPILE_STATUS:3,LINK_STATUS:4,
    VERTEX_SHADER:5,FRAGMENT_SHADER:6,ARRAY_BUFFER:7,STATIC_DRAW:8,TEXTURE0:20,TEXTURE_2D:21,
    TEXTURE_MIN_FILTER:22,TEXTURE_MAG_FILTER:23,LINEAR:24,TEXTURE_WRAP_S:25,TEXTURE_WRAP_T:26,CLAMP_TO_EDGE:27,
    RGBA:28,UNSIGNED_BYTE:29,UNPACK_FLIP_Y_WEBGL:30,FLOAT:31,TRIANGLES:32,MAX_VERTEX_TEXTURE_IMAGE_UNITS:33,MAX_COMBINED_TEXTURE_IMAGE_UNITS:34,
    ELEMENT_ARRAY_BUFFER:35,DEPTH_TEST:36,BLEND:37,DEPTH_BUFFER_BIT:38,SRC_ALPHA:39,ONE_MINUS_SRC_ALPHA:40,UNSIGNED_SHORT:41,
    createProgram:()=>allocate("program"),createShader:()=>allocate("shader"),createBuffer:()=>allocate("buffer"),createTexture:()=>allocate("texture"),
    deleteProgram:x=>deleted.add(x),deleteShader:x=>deleted.add(x),deleteBuffer:x=>deleted.add(x),deleteTexture:x=>deleted.add(x),
    getParameter:kind=>kind===1?8:kind===33?vertexUnits:8192,getShaderParameter:()=>fault!=="compile",getProgramParameter:()=>fault!=="link",
    getAttribLocation:()=>0,getUniformLocation:(_,name)=>name,getError:()=>fault==="upload"?1285:0,
    getExtension:()=>({loseContext(){lost=true;}}),isContextLost:()=>false,
    shaderSource:(_,source)=>sources.push(source),compileShader(){},attachShader(){},linkProgram(){},detachShader(){},
    bindBuffer(){},bufferData(){},activeTexture(){},bindTexture(){},texParameteri(){},texImage2D(){},pixelStorei(){},
    viewport(){},useProgram(){},enableVertexAttribArray(){},vertexAttribPointer(){},disable(){},enable(){},clear(){},blendFunc(){},
    uniform1i:(name,value)=>uniforms.set(name,value),uniform1f:(name,value)=>uniforms.set(name,value),
    uniform2fv:(name,value)=>uniforms.set(name,[...value]),uniform3fv:(name,value)=>uniforms.set(name,[...value]),
    drawArrays(){draws++;},drawElements(){draws++;},
  };
  return {gl,made,deleted,uniforms,sources,get lost(){return lost;},get draws(){return draws;}};
}

test("failed artwork allocations release every partial GPU resource", () => {
  assert.equal(createArtRenderer({getContext:()=>null}),null);
  for(const fault of ["program1","shader1","shader2","buffer1","buffer2","buffer3","texture1","texture2","texture3","texture4","texture5","texture6","compile","link","upload"]){
    const state=mockGL(fault),canvas={getContext:()=>state.gl};
    assert.equal(createArtRenderer(canvas),null,fault);
    assert.equal(state.deleted.size,state.made.length,`${fault} must release every object`);
    assert.equal(state.lost,true);
  }
});

test("a supported vertex-texture stage draws real relief while unsupported hardware keeps the original flow",()=>{
  const depth={width:2,height:2,data:new Uint8Array(16)},frame={width:900,height:500,dpr:1,time:0,pointer:[1,-1],weights:[1,0,0],crops:[[1,1],[1,1],[1,1]],audioLevel:1,impulse:0};
  for(const vertexUnits of [0,8]) {
    const state=mockGL("",{vertexUnits}),canvas={getContext:type=>!vertexUnits&&type==="webgl2"?null:state.gl},renderer=createArtRenderer(canvas,{makeDepth:()=>depth});
    assert.ok(renderer);renderer.upload(0,{naturalWidth:1600,naturalHeight:1000});renderer.render(frame);
    assert.equal(renderer.relief,vertexUnits>0);assert.equal(state.draws,vertexUnits?2:1);
    assert.equal(state.made.filter(item=>item.kind==="texture").length,vertexUnits?6:3);
    assert.ok(state.sources.every(source=>source.startsWith("#version 300 es")===!!vertexUnits));
    if(vertexUnits) {assert.deepEqual(state.uniforms.get("uView"),[.1,-.075]);assert.equal(state.uniforms.get("uRelief"),1);}
    renderer.dispose();assert.equal(state.made.length,state.deleted.size);
  }
});

test("artwork renderer uploads local images and uses one capped full-screen pass", () => {
  const state=mockGL(),canvas={getContext:()=>state.gl,width:0,height:0},renderer=createArtRenderer(canvas);
  assert.ok(renderer);assert.equal(renderer.upload(0,{naturalWidth:1600,naturalHeight:1000}),true);
  assert.ok(state.sources.every(source=>source.startsWith("#version 300 es")));
  assert.equal(renderer.render({width:1000,height:600,dpr:3,time:25,pointer:[.2,.3],weights:[1,0,0],crops:[[1,1],[1,1],[1,1]],audioLevel:.7,impulse:.1}),true);
  assert.equal(canvas.width,1500);assert.equal(canvas.height,900);assert.equal(state.draws,1);
  assert.equal(state.uniforms.get("uTime"),25);assert.deepEqual(state.uniforms.get("uPointer"),[.2,.3]);
  renderer.dispose(true);renderer.dispose(true);assert.equal(state.deleted.size,state.made.length);
});

function environment({graphicsOff=true,reduced=false}={}) {
  class Target extends EventTarget {
    listeners=new Map();
    addEventListener(name,fn,options){super.addEventListener(name,fn,options);if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(fn);}
    removeEventListener(name,fn,options){super.removeEventListener(name,fn,options);this.listeners.get(name)?.delete(fn);}
    count(){return [...this.listeners.values()].reduce((sum,set)=>sum+set.size,0);}
  }
  const contexts=[];
  class Element extends Target {
    style={};dataset={};children=[];attributes=new Map();captured=new Set();naturalWidth=0;naturalHeight=0;
    constructor(tag="div"){super();this.tag=tag;}
    append(child){child.parent=this;this.children.push(child);}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(item=>item!==this);this.parent=null;}
    setAttribute(name,value){this.attributes.set(name,String(value));}removeAttribute(name){this.attributes.delete(name);}
    getBoundingClientRect(){return{left:0,top:0,width:900,height:500};}
    getContext(type){if(type==="2d")return null;const context=mockGL();contexts.push(context);return context.gl;}
    hasPointerCapture(id){return this.captured.has(id);}setPointerCapture(id){this.captured.add(id);}releasePointerCapture(id){this.captured.delete(id);}
    load(){this.naturalWidth=1600;this.naturalHeight=1000;this.dispatchEvent(new Event("load"));}
  }
  const previous=new Map(),rafs=new Map(),intersections=[],resizes=[],documentMock=new Target(),media=new Target();
  documentMock.hidden=false;documentMock.createElement=tag=>new Element(tag);media.matches=reduced;let serial=0;
  const globals={document:documentMock,location:{search:graphicsOff?"?graphics=off":""},devicePixelRatio:2,matchMedia:()=>media,
    requestAnimationFrame:fn=>{const id=++serial;rafs.set(id,fn);return id;},cancelAnimationFrame:id=>rafs.delete(id),
    IntersectionObserver:class{constructor(fn){this.fn=fn;this.connected=true;intersections.push(this);}observe(){}disconnect(){this.connected=false;}fire(visible){this.fn([{isIntersecting:visible}]);}},
    ResizeObserver:class{constructor(fn){this.fn=fn;this.connected=true;resizes.push(this);}observe(){}disconnect(){this.connected=false;}},
  };
  for(const[name,value]of Object.entries(globals)){previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});}
  const host=new Element(),world=mountArtStage(host,{images:["bloom.png","wave.png","prism.png"]}),wrapper=host.children[0],images=wrapper.children.filter(child=>child.tag==="img"),canvas=wrapper.children.at(-1);
  return {host,world,wrapper,images,canvas,rafs,contexts,media,documentMock,intersections,resizes,
    flush(time){const frames=[...rafs.values()];rafs.clear();frames.forEach(fn=>fn(time));},
    restore(){world.dispose();for(const[name,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}},
  };
}

test("pending scene changes keep a loaded image, interrupt continuously, and stop fallback idle work", () => {
  const e=environment();
  try {
    const {world,images}=e;e.intersections[0].fire(true);e.flush(16);assert.equal(e.rafs.size,0,"no empty loading loop");
    images[0].load();e.flush(32);assert.equal(e.rafs.size,0);assert.equal(images[0].style.opacity,"1");
    world.setScene(1);world.setScene(2);assert.equal(e.rafs.size,0);assert.equal(images[0].style.opacity,"1");
    images[1].load();e.flush(48);assert.equal(e.rafs.size,0,"an obsolete load cannot start the abandoned transition");
    images[2].load();e.flush(64);e.flush(80);assert.equal(e.rafs.size,1);
    assert.equal(images[0].style.opacity,"1","the bottom image stays opaque under a partial crossfade");
    assert.ok(Number(images[2].style.opacity)>0&&Number(images[2].style.opacity)<1);
    const before=images.map(image=>image.style.opacity);world.setScene(1);e.flush(96);
    assert.deepEqual(images.map(image=>image.style.opacity),before,"interrupt begins at the current presentation");
    for(let frame=0;frame<200;frame++)e.flush(112+frame*16);
    assert.equal(e.rafs.size,0);assert.equal(images[1].style.opacity,"1");assert.equal(images[2].style.opacity,"0");
    assert.equal(world.ready,false);assert.equal(e.host.dataset.renderer,"image");
  } finally {e.restore();}
});

test("pause, viewport, hidden state, context restoration and disposal own one artwork RAF", () => {
  const e=environment({graphicsOff:false,reduced:true});
  try {
    e.images[0].load();e.intersections[0].fire(true);e.flush(16);
    assert.equal(e.world.ready,true);assert.equal(e.world.paused,true);assert.equal(e.rafs.size,0);
    e.world.setPaused(false);e.flush(32);e.flush(48);assert.equal(e.rafs.size,1);
    e.media.dispatchEvent(new Event("change"));e.flush(64);assert.equal(e.world.paused,false);
    const press=new Event("pointerdown");Object.assign(press,{button:0,pointerId:4,pointerType:"mouse",clientX:300,clientY:200});e.canvas.dispatchEvent(press);
    assert.equal(e.canvas.captured.size,1);
    e.world.setAudioLevel(.9);e.intersections[0].fire(false);assert.equal(e.rafs.size,0);
    assert.equal(e.canvas.captured.size,0,"offscreen releases the active gesture");
    e.intersections[0].fn([{isIntersecting:true,intersectionRatio:0}]);assert.equal(e.rafs.size,0);
    e.intersections[0].fire(true);e.flush(80);assert.equal(e.rafs.size,1);
    e.resizes[0].fn([{contentRect:{width:0,height:500}}]);assert.equal(e.rafs.size,0,"zero-size artwork does not spin");
    e.resizes[0].fn([{contentRect:{width:900,height:500}}]);assert.equal(e.rafs.size,1);
    e.documentMock.hidden=true;e.documentMock.dispatchEvent(new Event("visibilitychange"));assert.equal(e.rafs.size,0);
    e.documentMock.hidden=false;e.documentMock.dispatchEvent(new Event("visibilitychange"));e.flush(96);
    e.canvas.dispatchEvent(new Event("webglcontextlost",{cancelable:true}));assert.equal(e.world.ready,false);e.flush(112);assert.equal(e.rafs.size,0);
    e.canvas.dispatchEvent(new Event("webglcontextrestored"));e.flush(128);assert.equal(e.world.ready,true);assert.equal(e.contexts.length,2);
    e.world.setPaused(true);e.flush(144);assert.equal(e.rafs.size,0);
    for(let n=0;n<20;n++)e.world.setAudioLevel(n/20);assert.equal(e.rafs.size,0);
    e.world.setLanguage("en");assert.equal(e.wrapper.dataset.language,"en");
    e.world.dispose();e.world.dispose();assert.equal(e.rafs.size,0);assert.equal(e.host.children.length,0);
    assert.equal(e.documentMock.count(),0);assert.equal(e.media.count(),0);assert.equal(e.canvas.count(),0);
    assert.ok(e.images.every(image=>image.count()===0));assert.ok(e.intersections.every(observer=>!observer.connected));assert.ok(e.resizes.every(observer=>!observer.connected));
    assert.ok(e.contexts.every(context=>context.deleted.size===context.made.length));
    e.world.setPaused(false);e.world.setScene(1);assert.equal(e.rafs.size,0);
  } finally {e.restore();}
});
