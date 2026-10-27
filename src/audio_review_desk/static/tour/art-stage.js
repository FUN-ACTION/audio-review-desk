const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const defaults = ["bloom", "wave", "prism"].map(name => new URL(`./media/art-${name}.png`, import.meta.url).href);

/** Visible fraction of a cover-cropped image, with equal margins on both sides. */
export function coverCrop(width, height, imageWidth, imageHeight) {
  if (![width, height, imageWidth, imageHeight].every(n => Number.isFinite(n) && n > 0))
    throw new RangeError("Invalid artwork dimensions");
  const ratio = (width / height) / (imageWidth / imageHeight);
  return [Math.min(1, ratio), Math.min(1, 1 / ratio)];
}

/** Exact critically damped response. Retargeting keeps both presentation and velocity. */
export function advanceArtBlend(values, velocities, target, delta, response = 8) {
  if (values.length !== velocities.length || values.length !== target.length ||
      ![...values, ...velocities, ...target, delta, response].every(Number.isFinite) || delta < 0 || response <= 0)
    throw new RangeError("Invalid artwork motion");
  if (!delta) return;
  const decay = Math.exp(-response * delta);
  for (let i = 0; i < values.length; i++) {
    const offset = values[i] - target[i], slope = velocities[i] + response * offset;
    values[i] = target[i] + (offset + slope * delta) * decay;
    velocities[i] = (velocities[i] - response * slope * delta) * decay;
  }
}

/** Regular, indexed relief surface; the original picture supplies every visible detail. */
export function makeArtGrid(columns = 192, rows = 128) {
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns<8 || rows<8 || (columns+1)*(rows+1)>65535)
    throw new RangeError("Invalid artwork grid");
  const positions=new Float32Array((columns+1)*(rows+1)*2),indices=new Uint16Array(columns*rows*6);
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++) {
    const at=(y*(columns+1)+x)*2;positions[at]=(x/columns*2-1)*1.14;positions[at+1]=(y/rows*2-1)*1.14;
  }
  let at=0;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++) {
    const a=y*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1;indices.set([a,b,c,b,d,c],at);at+=6;
  }
  return {positions,indices};
}

/** Estimated depth, never a recovered model: blur highlights and limit spatial slope. */
export function makeArtDepth(pixels,width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2||width*height>262144||pixels.length!==width*height*4)
    throw new RangeError("Invalid artwork depth image");
  let source=new Float32Array(width*height),temporary=new Float32Array(width*height);
  for(let i=0;i<source.length;i++)source[i]=(.2126*pixels[i*4]+.7152*pixels[i*4+1]+.0722*pixels[i*4+2])/255;
  const kernel=[1,4,6,4,1];
  for(let pass=0;pass<3;pass++) {
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      let sum=0;for(let k=-2;k<=2;k++)sum+=source[y*width+clamp(x+k,0,width-1)]*kernel[k+2];temporary[y*width+x]=sum/16;
    }
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      let sum=0;for(let k=-2;k<=2;k++)sum+=temporary[clamp(y+k,0,height-1)*width+x]*kernel[k+2];source[y*width+x]=sum/16;
    }
  }
  for(let i=0;i<source.length;i++) {
    const n=clamp((source[i]-.035)/.7,0,1);source[i]=n*n*(3-2*n);
  }
  const step=.018;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=y*width+x;source[at]=Math.min(source[at],x?source[at-1]+step:1,y?source[at-width]+step:1);
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--) {
    const at=y*width+x;source[at]=Math.min(source[at],x<width-1?source[at+1]+step:1,y<height-1?source[at+width]+step:1);
  }
  const quantized=Uint8Array.from(source,n=>Math.round(n*255));
  // Bound the encoded map too: quantization must not recreate a sharp ridge.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const at=y*width+x;quantized[at]=Math.min(quantized[at],x?quantized[at-1]+4:255,y?quantized[at-width]+4:255);
  }
  for(let y=height-1;y>=0;y--)for(let x=width-1;x>=0;x--) {
    const at=y*width+x;quantized[at]=Math.min(quantized[at],x<width-1?quantized[at+1]+4:255,y<height-1?quantized[at+width]+4:255);
  }
  const data=new Uint8Array(width*height*4);
  // Typed texture rows are bottom-up, matching the flipped color image.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const n=quantized[y*width+x];data.set([n,n,n,255],((height-1-y)*width+x)*4);}
  return {data,width,height};
}

function readArtDepth(image) {
  try {
    const width=192,height=Math.max(48,Math.min(192,Math.round(width*image.naturalHeight/image.naturalWidth)));
    const surface=typeof OffscreenCanvas==="function"?new OffscreenCanvas(width,height):document.createElement("canvas");
    surface.width=width;surface.height=height;
    const context=surface.getContext("2d",{willReadFrequently:true});if(!context)return null;
    context.drawImage(image,0,0,width,height);
    return makeArtDepth(context.getImageData(0,0,width,height).data,width,height);
  }catch{return null;}
}

function shaderSources(webgl2, relief) {
  const version = webgl2 ? "#version 300 es\n" : "";
  const flow=`vec2 current(vec2 p,float phase){
    vec2 a=vec2(sin(p.y*4.6+phase*.37),cos(p.x*3.8-phase*.29));
    vec2 b=vec2(cos(p.x*2.3+p.y*2.1-phase*.23),sin(p.y*3.1-p.x*1.7+phase*.31));
    return a*.64+b*.36;
  }
  vec3 spatialWeights(vec2 uv,vec3 weights,float time){
    vec2 f=current(uv*.8,time*.6);
    float sweep=(uv.x-.5)*2.5+(uv.y-.5)*.65+f.y*.17;
    vec3 result=max(weights,vec3(0.))*exp(vec3(sweep,-sweep,(uv.y-.5)*2.-sweep*.4));
    return result/max(dot(result,vec3(1.)),.00001);
  }`;
  return [
    `${version}precision highp float;
    ${webgl2 ? "in" : "attribute"} vec2 aPosition;
    ${webgl2 ? "out" : "varying"} vec2 vUv;
    ${webgl2 ? "out" : "varying"} float vEdge;
    ${relief?`#define sampleDepth ${webgl2?"texture":"texture2D"}
    uniform sampler2D uDepth0,uDepth1,uDepth2;
    uniform vec2 uCrop0,uCrop1,uCrop2,uView;
    uniform vec3 uWeights;
    uniform float uTime,uAudio,uAspect,uRelief;
    ${flow}
    float depthAt(sampler2D image,vec2 crop){return sampleDepth(image,(vUv-.5)*crop*.956+.5).r;}`:""}
    void main(){
      vUv=aPosition*.5+.5;vEdge=1.;
      ${relief?`if(uRelief>.5){
        float edge=max(abs(aPosition.x),abs(aPosition.y));
        vEdge=1.-smoothstep(.84,1.05,edge);
        vec3 weights=spatialWeights(vUv,uWeights,uTime);
        float estimate=0.;
        if(weights.x>.0001)estimate+=depthAt(uDepth0,uCrop0)*weights.x;
        if(weights.y>.0001)estimate+=depthAt(uDepth1,uCrop1)*weights.y;
        if(weights.z>.0001)estimate+=depthAt(uDepth2,uCrop2)*weights.z;
        float height=estimate*.27*(1.+uAudio*.07+sin(uTime*.43)*.025);
        // Compensate the neutral projection, so the picture retains its composition.
        vec3 p=vec3(aPosition*vec2(uAspect,1.)*(1.-height/3.5),height);
        float cx=cos(uView.y),sx=sin(uView.y),cy=cos(uView.x),sy=sin(uView.x);
        p=vec3(p.x,p.y*cx-p.z*sx,p.y*sx+p.z*cx);
        p=vec3(p.x*cy+p.z*sy,p.y,-p.x*sy+p.z*cy);
        float distance=3.5-p.z;
        gl_Position=vec4(p.x/uAspect*3.5,p.y*3.5,distance*1.2857143-2.2857143,distance);
      }else` : ""}
      {gl_Position=vec4(aPosition,0.,1.);}
    }`,
    `${version}precision highp float;
    ${webgl2 ? "in" : "varying"} vec2 vUv;
    ${webgl2 ? "in" : "varying"} float vEdge;
    ${webgl2 ? "out vec4 fragmentColor;" : ""}
    #define sample2D ${webgl2 ? "texture" : "texture2D"}
    uniform sampler2D uImage0,uImage1,uImage2;
    uniform vec2 uCrop0,uCrop1,uCrop2,uPointer;
    uniform vec3 uWeights;
    uniform float uTime,uAudio,uImpulse,uRelief;
    ${flow}
    vec3 artwork(sampler2D image,vec2 crop,float seed){
      vec2 uv=(vUv-.5)*crop*.956+.5;
      vec3 source=sample2D(image,uv).rgb;
      float depth=smoothstep(.08,.86,dot(source,vec3(.2126,.7152,.0722)));
      vec2 field=current(vUv*1.35,uTime+seed);
      vec2 pointer=uPointer*vec2(.012,.009)*(depth-.22);
      vec2 toward=vUv-(uPointer*.5+.5);
      float influence=exp(-dot(toward,toward)*5.2);
      vec2 curl=vec2(-toward.y,toward.x)*influence*uImpulse*.018;
      float movement=mix(1.,.35,uRelief);
      uv+=(field*(.009+.008*uAudio)*(depth*.72+.28)+pointer+curl)*crop*movement;
      vec2 refraction=field*(.15+depth)*(.00036+.00032*uAudio)*crop;
      vec3 rgb=vec3(sample2D(image,uv+refraction).r,sample2D(image,uv).g,sample2D(image,uv-refraction).b);
      float light=dot(field,vec2(.58,.42))*.006*depth;
      return rgb*(1.+light);
    }
    void main(){
      vec3 weights=spatialWeights(vUv,uWeights,uTime);
      vec3 color=vec3(0.);
      if(weights.x>.0001)color+=artwork(uImage0,uCrop0,0.)*weights.x;
      if(weights.y>.0001)color+=artwork(uImage1,uCrop1,2.1)*weights.y;
      if(weights.z>.0001)color+=artwork(uImage2,uCrop2,4.7)*weights.z;
      ${webgl2 ? "fragmentColor" : "gl_FragColor"}=vec4(color,vEdge);
    }`,
  ];
}

/** Flat coverage pass plus a genuine perspective relief surface when supported. */
export function createArtRenderer(canvas, {makeDepth=readArtDepth}={}) {
  let gl, webgl2 = false;
  const shaders = [], textures = [],buffers=[];
  const depthReady=[false,false,false];
  let program = null, buffer = null, disposed = false,relief=false,reliefActive=false,gridBuffer=null,indexBuffer=null,gridCount=0;
  function allocated(value) { if (!value) throw new Error("Artwork allocation failed"); return value; }
  function dispose(lose = false) {
    if (disposed) return;
    disposed = true;
    if (!gl) return;
    shaders.forEach(item => gl.deleteShader(item));
    textures.forEach(item => gl.deleteTexture(item));
    if (program) gl.deleteProgram(program);
    buffers.forEach(item=>gl.deleteBuffer(item));
    if (lose) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  try {
    const settings = { alpha: false, antialias: false, depth: true, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false };
    gl = canvas.getContext("webgl2", settings); webgl2 = !!gl;
    if (!gl) gl = canvas.getContext("webgl", settings);
    if (!gl) return null;
    if (gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) < 3) throw new Error("Insufficient artwork samplers");
    relief=gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)>=3 && gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)>=6;
    const sources = shaderSources(webgl2,relief);
    program = allocated(gl.createProgram());
    for (let index = 0; index < 2; index++) {
      const shader = allocated(gl.createShader(index ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER)); shaders.push(shader);
      gl.shaderSource(shader, sources[index]); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Artwork shader compilation failed");
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Artwork shader linking failed");
    shaders.forEach(shader => { gl.detachShader(program, shader); gl.deleteShader(shader); }); shaders.length = 0;
    buffer = allocated(gl.createBuffer());buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    if(relief) {
      const grid=makeArtGrid();gridCount=grid.indices.length;
      gridBuffer=allocated(gl.createBuffer());buffers.push(gridBuffer);gl.bindBuffer(gl.ARRAY_BUFFER,gridBuffer);gl.bufferData(gl.ARRAY_BUFFER,grid.positions,gl.STATIC_DRAW);
      indexBuffer=allocated(gl.createBuffer());buffers.push(indexBuffer);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,grid.indices,gl.STATIC_DRAW);
    }
    const attribute = gl.getAttribLocation(program, "aPosition");
    const uniforms = Object.fromEntries(["uImage0","uImage1","uImage2","uDepth0","uDepth1","uDepth2","uCrop0","uCrop1","uCrop2","uPointer","uView","uAspect","uRelief","uWeights","uTime","uAudio","uImpulse"].map(name => [name, gl.getUniformLocation(program, name)]));
    for (let index = 0; index < (relief?6:3); index++) {
      const texture = allocated(gl.createTexture()); textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([22,24,35,255]));
    }
    if (gl.getError() !== gl.NO_ERROR) throw new Error("Artwork texture allocation failed");
    return {
      get relief(){return reliefActive;},
      upload(index, image) {
        if (disposed || gl.isContextLost()) return false;
        if (Math.max(image.naturalWidth, image.naturalHeight) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error("Artwork exceeds texture limit");
        gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, textures[index]);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        if (gl.getError() !== gl.NO_ERROR) throw new Error("Artwork upload failed");
        if(relief) {
          const depth=makeDepth(image);
          if(depth) {
            gl.activeTexture(gl.TEXTURE0+index+3);gl.bindTexture(gl.TEXTURE_2D,textures[index+3]);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,depth.width,depth.height,0,gl.RGBA,gl.UNSIGNED_BYTE,depth.data);
            if(gl.getError()!==gl.NO_ERROR)throw new Error("Artwork depth upload failed");depthReady[index]=true;
          }
        }
        return true;
      },
      render({ width, height, dpr, time, pointer, weights, crops, audioLevel, impulse }) {
        if (disposed || gl.isContextLost()) return false;
        const ratio = clamp(dpr, .5, 1.5), w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0,0,w,h); gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
        gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
        for (let index = 0; index < 3; index++) {
          gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D,textures[index]);
          gl.uniform1i(uniforms[`uImage${index}`],index); gl.uniform2fv(uniforms[`uCrop${index}`],crops[index]);
          if(relief){gl.activeTexture(gl.TEXTURE0+index+3);gl.bindTexture(gl.TEXTURE_2D,textures[index+3]);gl.uniform1i(uniforms[`uDepth${index}`],index+3);}
        }
        gl.uniform2fv(uniforms.uPointer,pointer); gl.uniform3fv(uniforms.uWeights,weights);
        gl.uniform1f(uniforms.uTime,time); gl.uniform1f(uniforms.uAudio,audioLevel); gl.uniform1f(uniforms.uImpulse,impulse);
        gl.uniform1f(uniforms.uRelief,0);gl.uniform1f(uniforms.uAspect,width/height);
        gl.drawArrays(gl.TRIANGLES,0,3);
        reliefActive=relief && weights.every((weight,index)=>weight<.0001 || depthReady[index]);
        if(reliefActive) {
          gl.uniform1f(uniforms.uRelief,1);gl.uniform2fv(uniforms.uView,[clamp(pointer[0],-1,1)*.10+Math.sin(time*.13)*.014,clamp(pointer[1],-1,1)*.075+Math.sin(time*.11)*.010]);
          gl.bindBuffer(gl.ARRAY_BUFFER,gridBuffer);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);
          gl.clear(gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
          gl.drawElements(gl.TRIANGLES,gridCount,gl.UNSIGNED_SHORT,0);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);
        }
        return true;
      },
      dispose,
    };
  } catch {
    dispose(true); return null;
  }
}

export function mountArtStage(host, { images = defaults, scene = 0, language = "zh" } = {}) {
  if (Array.isArray(images)) images = images.map(url => url instanceof URL ? url.href : url);
  if (!Array.isArray(images) || images.length < 1 || images.length > 3 || images.some(url => typeof url !== "string" || !url.trim()))
    throw new RangeError("Supply one to three artwork URLs");
  function validScene(index) { if (!Number.isInteger(index) || index < 0 || index >= images.length) throw new RangeError("Unknown artwork scene"); }
  function validLanguage(next) { if (!["zh","en"].includes(next)) throw new RangeError("Unknown artwork language"); }
  validScene(scene); validLanguage(language);
  images = images.slice();
  const wrapper = document.createElement("div"); wrapper.className = "art-surface";
  Object.assign(wrapper.style,{ position:"absolute",inset:"0",overflow:"hidden",background:"#161823" });
  const canvas = document.createElement("canvas"); canvas.className = "art-stage-canvas"; canvas.setAttribute("aria-hidden","true");
  Object.assign(canvas.style,{ position:"absolute",inset:"0",width:"100%",height:"100%",display:"block",opacity:"0",touchAction:"pan-y" });
  const entries = images.map((url,index) => {
    const image = document.createElement("img"); image.alt = ""; image.draggable = false; image.decoding = "async";
    image.setAttribute("aria-hidden","true"); image.fetchPriority = index === scene ? "high" : "low";
    Object.assign(image.style,{ position:"absolute",inset:"0",width:"100%",height:"100%",objectFit:"cover",display:"block",opacity:index===scene?"1":"0",pointerEvents:"none" });
    wrapper.append(image);
    return { image, url, loaded:false, failed:false, started:false, uploaded:false, onLoad:null, onError:null };
  });
  wrapper.append(canvas); host.append(wrapper);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)"), graphicsOff = new URLSearchParams(location.search).get("graphics") === "off";
  const values = new Float64Array(3), velocities = new Float64Array(3), target = new Float64Array(3), display = new Float32Array(3);
  values[scene] = target[scene] = 1;
  const pointer = new Float32Array(2), pointerVelocity = new Float64Array(2), pointerTarget = new Float64Array(2), crops = Array.from({length:3},()=>new Float32Array([1,1]));
  let paused = reduce.matches, controlled = false, visible = false, disposed = false, ready = false, attempted = false, contextLost = false;
  let gpu = null, raf = 0, last = 0, time = 0, width = 0, height = 0, level = 0, desiredLevel = 0, impulse = 0, slowFrames = 0, quality = 1;
  let requested = scene, haveImage = false, down = null;
  function notice() {
    host.dataset.renderer = ready ? "webgl" : "image"; host.dataset.ready = String(ready); host.dataset.scene = String(requested);
    host.dataset.depth=ready?(gpu?.relief?"relief":"flow"):"image";
    canvas.style.opacity = ready ? "1" : "0";
    host.dispatchEvent(new CustomEvent("motionchange",{detail:{ready,paused,scene:requested}}));
  }
  function settled() { return values.every((value,index)=>Math.abs(value-target[index])<.0001 && Math.abs(velocities[index])<.0001); }
  function animate() { return !paused && (!!gpu || !settled()); }
  function request() { if (!raf && !disposed && visible && width>0 && height>0 && !document.hidden) raf = requestAnimationFrame(tick); }
  function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
  function sync() { stop(); request(); }
  function freeGPU(lose = false) {
    const old = gpu; gpu = null; ready = false; entries.forEach(entry=>{entry.uploaded=false;}); old?.dispose(lose);
  }
  function select(index) {
    if (!entries[index].loaded) return;
    target.fill(0); target[index] = 1;
    if (!haveImage || paused || !visible) { values.set(target); velocities.fill(0); }
    haveImage = true; sync();
  }
  function start(index) { const entry = entries[index]; if (!entry.started) { entry.started=true; entry.image.src=entry.url; } }
  function startRest() { entries.forEach((_,index)=>start(index)); }
  entries.forEach((entry,index)=>{
    entry.onLoad = () => {
      if (disposed || !entry.image.naturalWidth || !entry.image.naturalHeight) return;
      entry.loaded = true; entry.failed = false;
      if (index === requested) select(index);
      else if (!haveImage && entries[requested].failed) select(index);
      sync(); startRest();
    };
    entry.onError = () => {
      if (disposed) return;
      entry.failed = true;
      const alternative = entries.findIndex(item=>item.loaded);
      if (!haveImage && alternative !== -1) select(alternative);
      host.dispatchEvent(new CustomEvent("artstageerror",{detail:{scene:index,reason:"image"}})); startRest();
    };
    entry.image.addEventListener("load",entry.onLoad); entry.image.addEventListener("error",entry.onError);
  });
  function paint() {
    if (disposed || !visible || document.hidden || width<=0 || height<=0 || !haveImage) return;
    let total = 0;
    for (let index=0;index<3;index++) { display[index] = entries[index]?.loaded ? Math.max(0,values[index]) : 0; total += display[index]; }
    if (total<=0) return;
    for (let index=0;index<3;index++) display[index] /= total;
    let prefix = 0;
    entries.forEach((entry,index)=>{
      prefix += display[index];
      entry.image.style.opacity=String(prefix ? display[index] / prefix : 0);
      if (entry.loaded) crops[index].set(coverCrop(width,height,entry.image.naturalWidth,entry.image.naturalHeight));
    });
    if (!gpu && !attempted && !graphicsOff && !contextLost) { attempted=true; gpu=createArtRenderer(canvas); }
    if (!gpu) return;
    try {
      entries.forEach((entry,index)=>{if(entry.loaded&&!entry.uploaded) { if(!gpu.upload(index,entry.image))throw new Error("Artwork context unavailable"); entry.uploaded=true; }});
      if (!gpu.render({width,height,dpr:Math.min(devicePixelRatio||1,1.5)*quality,time,pointer,weights:display,crops,audioLevel:level,impulse})) throw new Error("Artwork context unavailable");
      host.dataset.depth=gpu.relief?"relief":"flow";
      if (!ready) {ready=true;notice();}
    } catch { freeGPU(true); notice(); }
  }
  function tick(now) {
    raf=0; if(disposed || !visible || document.hidden)return;
    const raw=last?Math.max(0,(now-last)/1000):0, delta=Math.min(.05,raw); last=now;
    if(!paused) {
      time+=delta; advanceArtBlend(values,velocities,target,delta);
      advanceArtBlend(pointer,pointerVelocity,pointerTarget,delta,7);
      level+=(desiredLevel-level)*-Math.expm1(-delta*8); impulse*=Math.exp(-delta*3);
      if(settled()){values.set(target);velocities.fill(0);}
      if(raw>.032)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
      if(slowFrames>90 && quality>.76){quality=Math.max(.75,quality*.85);slowFrames=0;}
    }
    paint(); if(animate())request();
  }
  function resetPointer() {
    const captured = down?.id; down=null; pointerTarget.fill(0);
    if(captured!==undefined && canvas.hasPointerCapture?.(captured))canvas.releasePointerCapture(captured);
  }
  function point(event) {
    if(paused || disposed)return;
    if(down && down.id!==event.pointerId)return;
    if(event.pointerType==="touch") {
      if(!down || down.id!==event.pointerId)return;
      const dx=event.clientX-down.x,dy=event.clientY-down.y;
      if(!down.horizontal && Math.abs(dx)>8 && Math.abs(dx)>Math.abs(dy)*1.3){down.horizontal=true;canvas.setPointerCapture?.(event.pointerId);}
      if(!down.horizontal)return;
    }
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    pointerTarget[0]=clamp((event.clientX-rect.left)/rect.width*2-1,-1,1);
    pointerTarget[1]=clamp(1-(event.clientY-rect.top)/rect.height*2,-1,1);
  }
  function press(event) {
    if(paused || event.button!==0 || down)return;
    down={id:event.pointerId,x:event.clientX,y:event.clientY,horizontal:false}; impulse=Math.min(1,impulse+.65);
    if(event.pointerType!=="touch"){canvas.setPointerCapture?.(event.pointerId);point(event);}
  }
  function release(event) {if(!down || event.pointerId===down.id)resetPointer();}
  function leave() {if(!down)pointerTarget.fill(0);}
  function visibility() {resetPointer();sync();}
  function media() {if(!controlled)paused=reduce.matches;resetPointer();sync();notice();}
  function lost(event) {event.preventDefault();if(disposed)return;contextLost=true;stop();resetPointer();freeGPU();notice();request();}
  function restored() {if(disposed)return;contextLost=false;attempted=false;sync();}
  canvas.addEventListener("pointermove",point,{passive:true});canvas.addEventListener("pointerdown",press);
  canvas.addEventListener("pointerup",release);canvas.addEventListener("pointercancel",release);canvas.addEventListener("pointerleave",leave);
  canvas.addEventListener("lostpointercapture",release);
  canvas.addEventListener("webglcontextlost",lost);canvas.addEventListener("webglcontextrestored",restored);
  document.addEventListener("visibilitychange",visibility);reduce.addEventListener("change",media);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting && entry.intersectionRatio!==0;if(!visible)resetPointer();sync();},{threshold:0}); intersection.observe(wrapper);
  const resize=new ResizeObserver(([entry])=>{width=entry.contentRect.width;height=entry.contentRect.height;sync();});resize.observe(wrapper);
  const rect=host.getBoundingClientRect();width=rect.width;height=rect.height;
  function setLanguage(next) {validLanguage(next);if(disposed)return;language=next;wrapper.dataset.language=next;}
  setLanguage(language);notice();start(scene);
  return {
    get ready(){return ready&&!disposed&&!contextLost;}, get paused(){return paused;}, get scene(){return requested;},
    setScene(index){validScene(index);if(disposed)return;requested=index;start(index);select(index);notice();},
    setPaused(value){if(disposed)return;controlled=true;paused=!!value;resetPointer();sync();notice();},
    setAudioLevel(value){if(!disposed)desiredLevel=Number.isFinite(value)?clamp(value,0,1):0;},
    setLanguage,
    dispose(){
      if(disposed)return;disposed=true;stop();resetPointer();intersection.disconnect();resize.disconnect();
      document.removeEventListener("visibilitychange",visibility);reduce.removeEventListener("change",media);
      canvas.removeEventListener("pointermove",point);canvas.removeEventListener("pointerdown",press);canvas.removeEventListener("pointerup",release);
      canvas.removeEventListener("pointercancel",release);canvas.removeEventListener("pointerleave",leave);
      canvas.removeEventListener("lostpointercapture",release);
      canvas.removeEventListener("webglcontextlost",lost);canvas.removeEventListener("webglcontextrestored",restored);
      entries.forEach(entry=>{entry.image.removeEventListener("load",entry.onLoad);entry.image.removeEventListener("error",entry.onError);entry.image.removeAttribute("src");});
      freeGPU(true);wrapper.remove();host.dataset.ready="false";
    },
  };
}
