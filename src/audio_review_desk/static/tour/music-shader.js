const TAU = Math.PI * 2;
const add = (a, b) => a.map((n, i) => n + b[i]);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const scale = (a, n) => a.map((v) => v * n);
const dot = (a, b) => a.reduce((n, v, i) => n + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => scale(a, 1 / Math.max(1e-12, Math.hypot(...a)));

function center(u, kind) {
  if (kind === "score") return [3.15 * Math.cos(u), 1.04 * Math.sin(u * 2), .94 * Math.sin(u)];
  if (kind === "flow") {
    const radius = 1.43 + .49 * Math.cos(u * 3);
    return [radius * Math.cos(u * 2), radius * Math.sin(u * 2) * .69, .85 * Math.sin(u * 3)];
  }
  return [1.67 * Math.cos(u), 1.3 * Math.sin(u), .67 * Math.sin(u * 2)];
}

function ribbonFrame(u, kind, band) {
  const epsilon = .001;
  const c = center(u, kind);
  const before = center(u - epsilon, kind), after = center(u + epsilon, kind);
  const tangent = normalize(sub(after, before));
  const derivative = kind === "score"
    ? sub(add(after, before), scale(c, 2))
    : [Math.cos(u * (kind === "flow" ? 2 : 1)), Math.sin(u * (kind === "flow" ? 2 : 1)), 0];
  let normal = normalize(sub(derivative, scale(tangent, dot(derivative, tangent))));
  let binormal = normalize(cross(tangent, normal));
  const twist = kind === "resonance" ? u * 1.5 + .28 : u + .3 * Math.sin(u * 2);
  const n = add(scale(normal, Math.cos(twist)), scale(binormal, Math.sin(twist)));
  const b = add(scale(binormal, Math.cos(twist)), scale(normal, -Math.sin(twist)));
  const offset = kind === "score" ? (band - 1) * .53 : kind === "flow" ? (band - .5) * .33 : 0;
  const width = kind === "resonance" ? .69 : kind === "flow" ? .32 : .235;
  const depth = kind === "resonance" ? .075 : .057;
  const size = kind === "score" ? 1.06 : kind === "flow" ? 1.57 : 1.54;
  return { c: add(c, scale(normal, offset)), n, b, width, depth, size };
}

/** Closed, rounded ribbon meshes. Their size stays inside unsigned-short indices. */
export function makeRibbon(kind = "score", band = 0, segments = 280, sides = 16) {
  if (!["score", "flow", "resonance"].includes(kind) || !Number.isInteger(band) || band < 0 || band > 2 || !Number.isInteger(segments) || segments < 24 || segments > 500 || !Number.isInteger(sides) || sides < 8 || sides > 32 || (segments + 1) * (sides + 1) > 65535)
    throw new RangeError("Invalid ribbon geometry");
  const vertices = new Float32Array((segments + 1) * (sides + 1) * 8);
  const indices = new Uint16Array(segments * sides * 6);
  const crossSection = Array.from({ length: sides + 1 }, (_, side) => ({ cos: Math.cos(side / sides * TAU), sin: Math.sin(side / sides * TAU) }));
  for (let segment = 0; segment <= segments; segment++) {
    const u = segment / segments * TAU;
    const frame = ribbonFrame(u, kind, band);
    const before = ribbonFrame(u - .0001, kind, band);
    const after = ribbonFrame(u + .0001, kind, band);
    for (let side = 0; side <= sides; side++) {
      const { cos, sin } = crossSection[side];
      const p = [0, 1, 2].map((axis) => (frame.c[axis] + frame.n[axis] * cos * frame.width + frame.b[axis] * sin * frame.depth) * frame.size);
      const du = [0, 1, 2].map((axis) => (after.c[axis] + after.n[axis] * cos * after.width + after.b[axis] * sin * after.depth) * after.size - (before.c[axis] + before.n[axis] * cos * before.width + before.b[axis] * sin * before.depth) * before.size);
      const dv = [0, 1, 2].map((axis) => (-frame.n[axis] * sin * frame.width + frame.b[axis] * cos * frame.depth) * frame.size);
      const normal = normalize(cross(du, dv));
      const offset = (segment * (sides + 1) + side) * 8;
      vertices.set([...p, ...normal, segment / segments, side / sides], offset);
    }
  }
  let offset = 0;
  for (let segment = 0; segment < segments; segment++) {
    for (let side = 0; side < sides; side++) {
      const a = segment * (sides + 1) + side;
      const b = a + sides + 1;
      indices.set([a, b, a + 1, a + 1, b, b + 1], offset);
      offset += 6;
    }
  }
  return { vertices, indices };
}

function multiply(a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let i = 0; i < 4; i++) result[column * 4 + row] += a[i * 4 + row] * b[column * 4 + i];
    }
  }
  return result;
}
function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), range = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (near + far) * range, -1, 0, 0, 2 * near * far * range, 0]);
}
function lookAt(eye, target) {
  const z = normalize(sub(eye, target)), x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
function ortho(left, right, bottom, top, near, far) {
  return new Float32Array([2 / (right - left), 0, 0, 0, 0, 2 / (top - bottom), 0, 0, 0, 0, -2 / (far - near), 0, -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1]);
}
function rotation(x, y, z, height = 0) {
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const rx = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
  const ry = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
  const rz = new Float32Array([cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, height, 0, 1]);
  return multiply(rz, multiply(ry, rx));
}

const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat4 uLightProjection;
uniform float uScale;
out vec3 vPosition;
out vec3 vNormal;
out vec2 vUv;
out vec4 vShadow;
void main(){
  vec4 world=uModel*vec4(aPosition*uScale,1.0);
  vPosition=world.xyz;
  vNormal=normalize(mat3(uModel)*aNormal);
  vUv=aUv;
  vShadow=uLightProjection*world;
  gl_Position=uViewProjection*world;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPosition;
in vec3 vNormal;
in vec2 vUv;
in vec4 vShadow;
uniform vec3 uCamera;
uniform vec3 uColor;
uniform float uMetal;
uniform float uRoughness;
uniform float uIridescence;
uniform bool uDark;
uniform sampler2DShadow uShadow;
out vec4 outColor;
const float PI=3.14159265359;
vec3 fresnel(float cosine,vec3 f0){return f0+(1.0-f0)*pow(1.0-cosine,5.0);}
float shadow(vec3 n,vec3 l){
  vec3 p=vShadow.xyz/vShadow.w*.5+.5;
  if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0||p.z>1.0)return 1.0;
  float bias=max(.00055*(1.0-dot(n,l)),.00015);
  float sum=0.0;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)sum+=texture(uShadow,vec3(p.xy+vec2(x,y)*.00115,p.z-bias));
  return .24+.76*sum/9.0;
}
vec3 room(vec3 r,float rough){
  vec3 color=mix(vec3(.035,.04,.066),vec3(.42,.44,.51),smoothstep(-.65,.95,r.y));
  if(uDark)color*=.66;
  float broad=pow(max(dot(r,normalize(vec3(-.7,1.7,1.4))),0.0),mix(15.0,3.0,rough));
  float strip=exp(-pow((r.x+.30)/(.055+rough*.28),2.0))*smoothstep(-.12,.45,r.y);
  float strip2=exp(-pow((r.z+.55)/(.045+rough*.22),2.0))*smoothstep(-.5,.1,-r.x);
  color+=vec3(2.6)*broad+vec3(2.3)*strip+vec3(.9,1.0,1.3)*strip2;
  color+=vec3(.055,.035,.45)*pow(max(dot(r,normalize(vec3(.8,.1,-.6))),0.0),7.0);
  return color;
}
vec3 directLight(vec3 n,vec3 v,vec3 l,vec3 radiance,vec3 f0,float rough,vec3 diffuse){
  vec3 h=normalize(v+l);
  float nl=max(dot(n,l),0.0),nv=max(dot(n,v),.001),nh=max(dot(n,h),0.0),hv=max(dot(h,v),0.0);
  float a=rough*rough,a2=a*a;
  float d=a2/(PI*pow(nh*nh*(a2-1.0)+1.0,2.0)+.00001);
  float k=pow(rough+1.0,2.0)/8.0;
  float g=nl/(nl*(1.0-k)+k)*nv/(nv*(1.0-k)+k);
  vec3 f=fresnel(hv,f0);
  vec3 spec=d*g*f/max(4.0*nv*nl,.001);
  return ((1.0-f)*diffuse/PI+spec*.6)*radiance*nl;
}
void main(){
  vec3 n=normalize(gl_FrontFacing?vNormal:-vNormal);
  vec3 v=normalize(uCamera-vPosition);
  vec3 l=normalize(vec3(-3.8,6.0,5.0));
  float nv=max(dot(n,v),.001);
  vec3 film=.5+.5*cos(vec3(0.0,2.0,4.1)+nv*8.5+vPosition.y*.12);
  vec3 base=mix(uColor,uColor*(.5+film*.85),uIridescence*.6);
  vec3 f0=mix(vec3(.045),base,uMetal);
  vec3 diffuse=base*(1.0-uMetal);
  float ao=.74+.26*abs(dot(normalize(vPosition+vec3(.1,.3,.2)),n));
  vec3 reflected=room(reflect(-v,n),uRoughness);
  vec3 f=fresnel(nv,f0);
  vec3 color=reflected*f*ao;
  color+=room(n,.8)*diffuse*.19;
  color+=directLight(n,v,l,vec3(3.5,3.55,3.8),f0,uRoughness,diffuse)*shadow(n,l);
  color+=directLight(n,v,normalize(vec3(4.0,1.0,-3.0)),vec3(.65,.72,1.0),f0,uRoughness,diffuse);
  color+=room(reflect(-v,n),.09)*fresnel(nv,vec3(.04))*.12;
  color=color/(color+vec3(.85));
  color=pow(max(color,vec3(0.0)),vec3(1.0/2.2));
  outColor=vec4(color,1.0);
}`;

const DEPTH_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform float uScale;
void main(){gl_Position=uViewProjection*uModel*vec4(aPosition*uScale,1.0);}`;
const DEPTH_FRAGMENT = `#version 300 es
precision highp float;
void main(){}`;
const BACK_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPosition;
out vec2 vUv;
void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.0,1.0);}`;
const BACK_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform bool uDark;
out vec4 outColor;
void main(){
  vec2 uv=vUv;
  float light=exp(-dot((uv-vec2(.44,.68))*vec2(1.3,1.0),(uv-vec2(.44,.68))*vec2(1.3,1.0))*3.5);
  vec3 color=uDark?mix(vec3(.040,.046,.071),vec3(.105,.104,.155),light):mix(vec3(.79,.80,.86),vec3(.945,.945,.975),light);
  float shade=exp(-pow((uv.x-.5)/.34,2.0)-pow((uv.y-.17)/.045,2.0));
  color*=1.0-shade*(uDark?.28:.10);
  outColor=vec4(color,1.0);
}`;

export function createMusicRenderer(canvas, { kind = "score" } = {}) {
  if (!["score", "flow", "resonance"].includes(kind)) throw new RangeError("Unknown music sculpture");
  let gl;
  try {
    gl = canvas.getContext("webgl2", { alpha: false, antialias: true, depth: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
  } catch (error) {
    console.warn("Music artwork: WebGL2 context could not be created.", error.message);
    return null;
  }
  if (!gl) return null;
  const programs = [], buffers = [], vaos = [], textures = [], framebuffers = [];
  let disposed = false;
  function allocated(resource, label) {
    if (resource === null) throw Error(`WebGL ${label} allocation failed`);
    return resource;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    programs.forEach((item) => gl.deleteProgram(item));
    buffers.forEach((item) => gl.deleteBuffer(item));
    vaos.forEach((item) => gl.deleteVertexArray(item));
    textures.forEach((item) => gl.deleteTexture(item));
    framebuffers.forEach((item) => gl.deleteFramebuffer(item));
  }
  function program(vertex, fragment, names) {
    const shaders = [];
    let p = null;
    try {
      for (const type of [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER])
        shaders.push(allocated(gl.createShader(type), "shader"));
      p = allocated(gl.createProgram(), "program");
      [vertex, fragment].forEach((source, index) => {
        gl.shaderSource(shaders[index], source);
        gl.compileShader(shaders[index]);
        if (!gl.getShaderParameter(shaders[index], gl.COMPILE_STATUS))
          throw Error(`${index === 0 ? "Vertex" : "Fragment"} shader: ${gl.getShaderInfoLog(shaders[index]) || "compilation failed"}`);
        gl.attachShader(p, shaders[index]);
      });
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(`Material program: ${gl.getProgramInfoLog(p) || "link failed"}`);
      const result = { program: p, uniforms: Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(p, name)])) };
      programs.push(p);
      return result;
    } catch (error) { if (p !== null) gl.deleteProgram(p); throw error; }
    finally { shaders.forEach((shader) => gl.deleteShader(shader)); }
  }
  function buffer(target, values) {
    const b = allocated(gl.createBuffer(), "buffer");
    buffers.push(b);
    gl.bindBuffer(target, b);
    gl.bufferData(target, values, gl.STATIC_DRAW);
    return b;
  }
  try {
    const surface = program(VERTEX, FRAGMENT, ["uModel", "uViewProjection", "uLightProjection", "uScale", "uCamera", "uColor", "uMetal", "uRoughness", "uIridescence", "uDark", "uShadow"]);
    const depth = program(DEPTH_VERTEX, DEPTH_FRAGMENT, ["uModel", "uViewProjection", "uScale"]);
    const background = program(BACK_VERTEX, BACK_FRAGMENT, ["uDark"]);
    const quad = allocated(gl.createVertexArray(), "vertex array");
    vaos.push(quad);
    gl.bindVertexArray(quad);
    buffer(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const count = kind === "score" ? 3 : kind === "flow" ? 2 : 1;
    const meshes = Array.from({ length: count }, (_, band) => {
      const geometry = makeRibbon(kind, band);
      const vao = allocated(gl.createVertexArray(), "vertex array");
      vaos.push(vao);
      gl.bindVertexArray(vao);
      buffer(gl.ARRAY_BUFFER, geometry.vertices);
      buffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indices);
      for (const [index, size, offset] of [[0,3,0],[1,3,12],[2,2,24]]) {
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index, size, gl.FLOAT, false, 32, offset);
      }
      const material = kind === "score"
        ? [{ color: [.025,.018,.82], metal: .82, rough: .19, film: .06 }, { color: [.83,.85,.89], metal: .91, rough: .17, film: 0 }, { color: [.88,.86,.81], metal: .08, rough: .24, film: 0 }][band]
        : kind === "flow"
          ? [{ color: [.11,.07,.72], metal: .95, rough: .15, film: .8 }, { color: [.62,.68,.83], metal: .96, rough: .13, film: .4 }][band]
          : { color: [.77,.80,.86], metal: .97, rough: .145, film: .17 };
      return { vao, count: geometry.indices.length, material };
    });
    const shadowTexture = allocated(gl.createTexture(), "texture");
    textures.push(shadowTexture);
    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 1024, 1024, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const shadowBuffer = allocated(gl.createFramebuffer(), "framebuffer");
    framebuffers.push(shadowBuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTexture, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const shadowStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (shadowStatus !== gl.FRAMEBUFFER_COMPLETE) throw Error(`Shadow surface status: 0x${shadowStatus.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const lightProjection = multiply(ortho(-5.3,5.3,-4.2,4.2,.1,22), lookAt([-3.8,6,5],[0,0,0]));
    gl.disable(gl.CULL_FACE);
    return {
      render({ time = 0, pointer = { x: 0, y: 0 }, audioLevel = 0, width, height, dpr = 1 }) {
        if (disposed || gl.isContextLost() || width <= 0 || height <= 0) return;
        const pixelRatio = Math.max(.7, Math.min(1.35, dpr));
        const w = Math.max(1, Math.round(width * pixelRatio)), h = Math.max(1, Math.round(height * pixelRatio));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        const aspect = width / height;
        const camera = [0,.42, Math.max(kind === "score" ? 8.3 : 8.7, 4.1 / (aspect * Math.tan(Math.PI / 10)))];
        const projection = multiply(perspective(Math.PI / 5, aspect, .1, 50), lookAt(camera,[0,0,0]));
        const x = kind === "score" ? -.11 + Math.sin(time * .13) * .07 : .28 + Math.sin(time * .12) * .14;
        const y = kind === "score" ? -.24 + Math.sin(time * .085) * .17 : .36 + time * (kind === "flow" ? .075 : .065);
        const z = kind === "score" ? -.13 + Math.sin(time * .1) * .025 : -.18;
        const model = rotation(x + pointer.y * .1, y + pointer.x * .14, z, Math.sin(time * .21) * .055);
        const zoom = 1 + Math.max(0, Math.min(1, audioLevel)) * .025;
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowBuffer);
        gl.viewport(0,0,1024,1024);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(depth.program);
        gl.uniformMatrix4fv(depth.uniforms.uModel,false,model);
        gl.uniformMatrix4fv(depth.uniforms.uViewProjection,false,lightProjection);
        gl.uniform1f(depth.uniforms.uScale,zoom);
        for (const mesh of meshes) { gl.bindVertexArray(mesh.vao); gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0); }
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.viewport(0,0,w,h);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(background.program);
        gl.uniform1i(background.uniforms.uDark,kind === "flow" ? 1 : 0);
        gl.bindVertexArray(quad);
        gl.drawArrays(gl.TRIANGLES,0,6);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(surface.program);
        gl.uniformMatrix4fv(surface.uniforms.uModel,false,model);
        gl.uniformMatrix4fv(surface.uniforms.uViewProjection,false,projection);
        gl.uniformMatrix4fv(surface.uniforms.uLightProjection,false,lightProjection);
        gl.uniform1f(surface.uniforms.uScale,zoom);
        gl.uniform3fv(surface.uniforms.uCamera,camera);
        gl.uniform1i(surface.uniforms.uDark,kind === "flow" ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D,shadowTexture);
        gl.uniform1i(surface.uniforms.uShadow,0);
        for (const mesh of meshes) {
          gl.uniform3fv(surface.uniforms.uColor,mesh.material.color);
          gl.uniform1f(surface.uniforms.uMetal,mesh.material.metal);
          gl.uniform1f(surface.uniforms.uRoughness,mesh.material.rough);
          gl.uniform1f(surface.uniforms.uIridescence,mesh.material.film);
          gl.bindVertexArray(mesh.vao);
          gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);
        }
        gl.bindVertexArray(null);
      },
      dispose,
    };
  } catch (error) {
    console.warn(`Music artwork (${kind}): ${error.message}`);
    dispose();
    return null;
  }
}
