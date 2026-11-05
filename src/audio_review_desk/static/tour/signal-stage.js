import {
  ACESFilmicToneMapping, Color, DirectionalLight, Group, HemisphereLight,
  Mesh, MeshPhysicalMaterial, PerspectiveCamera, PMREMGenerator,
  RoomEnvironment, Scene, TorusGeometry, WebGLRenderer,
} from './scene-vendor.js';

/** Deterministic, original acoustic form; no image displacement or model asset. */
export function acousticLayout(count = 44) {
  if (!Number.isInteger(count) || count < 8 || count > 64) throw new RangeError('ring count');
  return Array.from({ length: count }, (_, index) => {
    const u = index / (count - 1);
    const envelope = Math.pow(Math.sin(Math.PI * u), .72);
    return {
      x: (u - .5) * 7.1,
      radius: .16 + envelope * (.86 + .30 * Math.sin(u * Math.PI * 3 + .4)),
      phase: u * Math.PI * 2,
      hue: 29 + u * 8,
    };
  });
}
export function smoothTarget(value, target, delta, response = 7) {
  return value + (target - value) * (1 - Math.exp(-response * Math.min(.05, Math.max(0, delta))));
}

export function mountSignalStage(host, { paused = false, onAvailabilityChange = () => {} } = {}, runtime = globalThis) {
  const document = host.ownerDocument;
  let renderer, scene, camera, sculpture, geometry, environment, frame = 0, recoveryFrame = 0;
  let disposed = false, intersecting = true, lost = false, time = 0, last = 0;
  let audio = 0, level = 0, pointerX = 0, pointerY = 0, rotationX = 0, rotationY = 0;
  const materials = [], rings = [], layout = acousticLayout();
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  function availability(ready) {
    host.dataset.renderer = ready ? 'webgl' : 'fallback';
    host.dataset.ready = String(ready);
    try { onAvailabilityChange(ready); } catch {}
  }
  availability(false);
  const pauseFrame = () => { runtime.cancelAnimationFrame(frame); frame = 0; last = 0; };
  function shouldRun() { return !disposed && !paused && !document.hidden && intersecting && !lost && !!renderer; }
  function draw(delta = 0) {
    if (!renderer || lost || disposed) return;
    level = smoothTarget(level, audio, delta, 8);
    rotationX = smoothTarget(rotationX, pointerY * .075, delta, 6);
    rotationY = smoothTarget(rotationY, pointerX * .12, delta, 6);
    sculpture.rotation.set(.12 + rotationX, -.12 + rotationY, -.16);
    for (let index = 0; index < rings.length; index++) {
      const shape = layout[index];
      const breath = 1 + Math.sin(time * .58 + shape.phase) * .018 + level * .065;
      rings[index].scale.set(shape.radius * .86 * breath, shape.radius * breath, 1);
    }
    renderer.render(scene, camera);
  }
  function tick(now) {
    frame = 0;
    if (!shouldRun()) return;
    const delta = last ? Math.min(.05, (now - last) / 1000) : 1 / 60;
    last = now; time += delta;
    draw(delta);
    frame = runtime.requestAnimationFrame(tick);
  }
  function schedule() {
    if (shouldRun() && !frame) frame = runtime.requestAnimationFrame(tick);
    if (!shouldRun()) pauseFrame();
  }
  function resize() {
    if (!renderer || disposed || lost) return;
    const box = host.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    renderer.setPixelRatio(Math.min(1.5, runtime.devicePixelRatio || 1));
    renderer.setSize(box.width, box.height, false);
    camera.aspect = box.width / box.height;
    camera.position.set(2.7, 2.2, camera.aspect < 1.35 ? 12.2 : 8.3);
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); draw();
  }
  function initialize() {
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.32;
      scene = new Scene();
      camera = new PerspectiveCamera(32, 2, .1, 40);
      let generator, room;
      try {
        generator = new PMREMGenerator(renderer);
        room = new RoomEnvironment();
        environment = generator.fromScene(room, .04);
        scene.environment = environment.texture;
      } finally {
        room?.dispose(); generator?.dispose();
      }
      scene.add(new HemisphereLight(0xffefd9, 0x283422, 1.9));
      const key = new DirectionalLight(0xfff4dd, 6.2); key.position.set(-3, 5, 6); scene.add(key);
      const fill = new DirectionalLight(0xcb8c55, 4.2); fill.position.set(3, -.5, 3); scene.add(fill);
      const edge = new DirectionalLight(0xf7ede1, 4.3); edge.position.set(0, 2, -5); scene.add(edge);
      sculpture = new Group();
      geometry = new TorusGeometry(1, .038, 12, 96);
      for (const shape of layout) {
        const tint = new Color().setHSL(shape.hue / 360, .35, .61);
        const material = new MeshPhysicalMaterial({
          color: tint, metalness: .78, roughness: .31,
          clearcoat: .30, clearcoatRoughness: .28, envMapIntensity: 1.5,
        });
        const ring = new Mesh(geometry, material);
        ring.position.set(shape.x, Math.sin(shape.phase * 1.3) * .12, 0);
        ring.rotation.y = Math.PI / 2;
        materials.push(material); rings.push(ring); sculpture.add(ring);
      }
      scene.add(sculpture);
      availability(true);
      resize(); schedule();
    } catch {
      pauseFrame();
      geometry?.dispose(); materials.forEach(material => material.dispose());
      environment?.dispose(); renderer?.dispose(); renderer = null;
      availability(false);
    }
  }
  function pointer(event) {
    if (paused || disposed) return;
    const box = host.getBoundingClientRect();
    pointerX = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width - .5) * 2));
    pointerY = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height - .5) * 2));
  }
  function resetPointer() { pointerX = pointerY = 0; }
  function visibility() { schedule(); }
  function contextLost(event) {
    event.preventDefault(); lost = true; pauseFrame();
    runtime.cancelAnimationFrame(recoveryFrame); recoveryFrame = 0;
    availability(false);
  }
  function contextRestored() {
    if (disposed || !renderer) return;
    // Three's own listener rebuilds its internal state later in this event.
    // Render only after all restoration listeners have completed, including
    // one redraw when the user has paused continuous motion.
    runtime.cancelAnimationFrame(recoveryFrame);
    recoveryFrame = runtime.requestAnimationFrame(() => {
      recoveryFrame = 0;
      if (disposed || !renderer) return;
      lost = false;
      try {
        resize(); availability(true); schedule();
      } catch {
        lost = true; pauseFrame();
        geometry?.dispose(); materials.forEach(material => material.dispose());
        environment?.dispose(); renderer?.dispose(); renderer = null;
        availability(false);
      }
    });
  }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  host.addEventListener('pointermove', pointer, { passive: true });
  host.addEventListener('pointerleave', resetPointer);
  document.addEventListener('visibilitychange', visibility);
  const observer = runtime.IntersectionObserver ? new runtime.IntersectionObserver(([entry]) => {
    intersecting = entry.isIntersecting; schedule();
  }, { rootMargin: '40px' }) : null;
  observer?.observe(host);
  const resizeObserver = runtime.ResizeObserver ? new runtime.ResizeObserver(resize) : null;
  resizeObserver?.observe(host);
  if (!resizeObserver) runtime.addEventListener('resize', resize);
  if (new URLSearchParams(runtime.location?.search || '').get('graphics') !== 'off') initialize();
  return {
    setPaused(value) { paused = !!value; host.dataset.paused = String(paused); audio = 0; if (paused) pauseFrame(); else schedule(); },
    setAudioLevel(value) { audio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0; },
    get ready() { return !!renderer && !lost; },
    dispose() {
      if (disposed) return;
      disposed = true; pauseFrame(); runtime.cancelAnimationFrame(recoveryFrame); recoveryFrame = 0;
      observer?.disconnect(); resizeObserver?.disconnect();
      if (!resizeObserver) runtime.removeEventListener('resize', resize);
      host.removeEventListener('pointermove', pointer); host.removeEventListener('pointerleave', resetPointer);
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', contextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
      geometry?.dispose(); materials.forEach(material => material.dispose());
      environment?.dispose(); renderer?.dispose(); canvas.remove();
    },
  };
}
