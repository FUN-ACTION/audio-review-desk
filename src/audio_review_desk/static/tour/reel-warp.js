import {
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  VideoTexture,
  SRGBColorSpace,
  NoToneMapping,
  LinearFilter,
  Vector2,
} from "./scene-vendor.js?v=0.9.0";

// A changing rectangular surface, rather than a camera zoom. The small
// diagonal difference between vertex phases gives the middle of the move a
// gentle curl while both endpoints remain exact rectangles.
const vertexShader = `
  uniform vec2 uSize;
  uniform float uProgress;
  varying vec2 vUv;
  varying vec2 vRectSize;

  float settle(float value) {
    return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
  }

  void main() {
    float progress = clamp(uProgress, 0.0, 1.0);
    float middle = sin(progress * 3.14159265359);
    float diagonal = (uv.x - 0.5) * 0.18 - (uv.y - 0.5) * 0.12;
    float phase = settle(clamp(progress + diagonal * middle, 0.0, 1.0));
    vec2 extent = mix(vec2(0.46, 0.72), vec2(1.0), phase) * uSize;
    vec2 center = mix(vec2(0.23, 0.5), vec2(0.5), phase) * uSize;
    vec2 local = (uv - 0.5) * extent;

    float angle = middle * 0.055 * (uv.y - 0.5);
    float cosine = cos(angle);
    float sine = sin(angle);
    local = mat2(cosine, sine, -sine, cosine) * local;
    local.x += sin(uv.y * 3.14159265359) * middle * uSize.x * 0.028;
    local.y += sin(uv.x * 3.14159265359) * middle * uSize.y * 0.018;

    vec2 screen = (center + local) / uSize * 2.0 - 1.0;
    gl_Position = vec4(screen, 0.0, 1.0);
    vUv = uv;
    vRectSize = extent;
  }
`;

const fragmentShader = `
  uniform sampler2D uVideo;
  uniform float uVideoAspect;
  uniform float uProgress;
  uniform float uRadius;
  varying vec2 vUv;
  varying vec2 vRectSize;

  vec3 toLinear(vec3 value) {
    vec3 low = value / 12.92;
    vec3 high = pow((value + 0.055) / 1.055, vec3(2.4));
    return mix(high, low, step(value, vec3(0.04045)));
  }

  vec3 toDisplay(vec3 value) {
    value = max(value, vec3(0.0));
    vec3 low = value * 12.92;
    vec3 high = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, step(value, vec3(0.0031308)));
  }

  void main() {
    float surfaceAspect = vRectSize.x / max(1.0, vRectSize.y);
    vec2 cover = vec2(
      min(1.0, surfaceAspect / uVideoAspect),
      min(1.0, uVideoAspect / surfaceAspect)
    );
    vec2 mediaUv = (vUv - 0.5) * cover + 0.5;

    // Three 0.180 keeps video textures in their source transfer function;
    // custom shader uniforms do not receive the built-in map decoder.
    vec3 image = toLinear(texture2D(uVideo, mediaUv).rgb);
    float luminance = dot(image, vec3(0.2126, 0.7152, 0.0722));
    vec3 cobalt = toLinear(vec3(0.055, 0.12, 0.97));
    vec3 tinted = mix(cobalt * 0.06, mix(cobalt, vec3(1.0), 0.18), sqrt(luminance));
    float colorProgress = smoothstep(0.12, 0.92, uProgress);
    vec3 color = mix(tinted, image, colorProgress);

    float radius = min(uRadius, min(vRectSize.x, vRectSize.y) * 0.25);
    vec2 edge = abs((vUv - 0.5) * vRectSize) - vRectSize * 0.5 + radius;
    float distance = length(max(edge, vec2(0.0))) + min(max(edge.x, edge.y), 0.0) - radius;
    float softness = max(fwidth(distance), 0.75);
    float alpha = 1.0 - smoothstep(-softness, softness, distance);
    gl_FragColor = vec4(toDisplay(color), alpha);
  }
`;

const boundedProgress = (value) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function mountReelSurface({ host, video } = {}) {
  let renderer;
  let scene;
  let camera;
  let geometry;
  let material;
  let texture;
  let canvas;
  let observer;
  let disposed = false;
  let active = false;
  let dirty = true;
  let frame = 0;
  let videoFrame = null;
  let lastVideoTime = -1;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let shaderFailed = false;
  const listeners = [];
  const hasFrameCallback =
    typeof video?.requestVideoFrameCallback === "function";
  const surface = { ready: false, update, setActive, resize, dispose };

  function listen(target, name, callback) {
    target.addEventListener(name, callback);
    listeners.push(() => target.removeEventListener(name, callback));
  }

  function cancelFrames() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (videoFrame !== null && video?.cancelVideoFrameCallback)
      video.cancelVideoFrameCallback(videoFrame);
    videoFrame = null;
  }

  function release(loseContext) {
    if (disposed) return;
    disposed = true;
    surface.ready = false;
    active = false;
    cancelFrames();
    observer?.disconnect();
    for (const remove of listeners) remove();
    host?.classList?.remove("has-reel-canvas");
    canvas?.remove();
    texture?.dispose();
    geometry?.dispose();
    material?.dispose();
    renderer?.dispose();
    if (loseContext) renderer?.forceContextLoss();
  }

  function dispose() {
    release(true);
  }

  function requestDraw() {
    if (!disposed && surface.ready && active && !frame)
      frame = requestAnimationFrame(draw);
  }

  function watchVideo() {
    if (
      !hasFrameCallback ||
      disposed ||
      !active ||
      video.paused ||
      video.ended ||
      videoFrame !== null
    )
      return;
    videoFrame = video.requestVideoFrameCallback(() => {
      videoFrame = null;
      if (disposed || !active) return;
      dirty = true;
      requestDraw();
      watchVideo();
    });
  }

  function draw() {
    frame = 0;
    if (disposed || !active || !surface.ready) return;
    const playing = !video.paused && !video.ended;
    const changedTime = video.currentTime !== lastVideoTime;
    if (
      width > 0 &&
      height > 0 &&
      video.readyState >= 2 &&
      (dirty || changedTime)
    ) {
      try {
        material.uniforms.uVideoAspect.value =
          video.videoWidth > 0 && video.videoHeight > 0
            ? video.videoWidth / video.videoHeight
            : 16 / 9;
        texture.needsUpdate = true;
        renderer.render(scene, camera);
        if (shaderFailed) throw new Error("Reel surface shader unavailable");
        lastVideoTime = video.currentTime;
        dirty = false;
        // Keep the DOM poster until an actual decoded frame has rendered.
        host.classList.add("has-reel-canvas");
      } catch {
        release(true);
        return;
      }
    }
    if (playing && !hasFrameCallback) requestDraw();
  }

  function update(progress) {
    if (disposed || !surface.ready) return;
    const value = boundedProgress(progress);
    if (Math.abs(material.uniforms.uProgress.value - value) < 0.00001) return;
    material.uniforms.uProgress.value = value;
    dirty = true;
    requestDraw();
  }

  function setActive(visible) {
    if (disposed || !surface.ready) return;
    const next = Boolean(visible);
    if (active === next) return;
    active = next;
    if (!active) {
      cancelFrames();
      return;
    }
    dirty = true;
    resize();
    requestDraw();
    watchVideo();
  }

  function resize() {
    if (disposed || !surface.ready) return;
    const rect = host.getBoundingClientRect();
    const nextWidth = Math.max(0, Math.round(rect.width));
    const nextHeight = Math.max(0, Math.round(rect.height));
    const nextRatio = Math.min(1.5, window.devicePixelRatio || 1);
    if (!nextWidth || !nextHeight) return;
    if (
      width === nextWidth &&
      height === nextHeight &&
      pixelRatio === nextRatio
    )
      return;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    material.uniforms.uSize.value.set(width, height);
    dirty = true;
    requestDraw();
  }

  if (
    !host?.appendChild ||
    !host?.getBoundingClientRect ||
    !video?.addEventListener
  )
    return surface;

  try {
    renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.setClearColor(0, 0);
    renderer.debug.onShaderError = () => {
      shaderFailed = true;
    };
    canvas = renderer.domElement;
    canvas.className = "reel-warp-canvas";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "1",
    });
    scene = new Scene();
    camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    texture = new VideoTexture(video);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    geometry = new PlaneGeometry(1, 1, 32, 32);
    material = new ShaderMaterial({
      uniforms: {
        uSize: { value: new Vector2(1, 1) },
        uProgress: { value: 0 },
        uVideo: { value: texture },
        uVideoAspect: { value: 16 / 9 },
        uRadius: { value: 22 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    renderer.compile(scene, camera);
    if (shaderFailed || renderer.getContext().isContextLost())
      throw new Error("Reel surface WebGL unavailable");
    host.appendChild(canvas);
    surface.ready = true;
    resize();

    listen(canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      release(false);
    });
    listen(window, "resize", resize);
    const onFrameAvailable = () => {
      if (disposed) return;
      dirty = true;
      requestDraw();
      watchVideo();
    };
    for (const event of [
      "loadeddata",
      "loadedmetadata",
      "seeked",
      "playing",
      "play",
    ])
      listen(video, event, onFrameAvailable);
    for (const event of ["pause", "ended"])
      listen(video, event, () => {
        if (videoFrame !== null && video.cancelVideoFrameCallback)
          video.cancelVideoFrameCallback(videoFrame);
        videoFrame = null;
        dirty = true;
        requestDraw();
      });
    listen(video, "emptied", () => {
      host.classList.remove("has-reel-canvas");
      renderer.clear();
      lastVideoTime = -1;
      dirty = true;
    });
    listen(video, "error", () => release(true));
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(host);
    }
  } catch {
    release(true);
  }
  return surface;
}
