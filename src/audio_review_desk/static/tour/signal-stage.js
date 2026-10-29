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
      hue: 204 + u * 17,
    };
  });
}
export function smoothTarget(value, target, delta, response = 7) {
  return value + (target - value) * (1 - Math.exp(-response * Math.min(.05, Math.max(0, delta))));
}

export function mountSignalStage(host, { paused = false } = {}, runtime = globalThis) {
  const document = host.ownerDocument;
  let renderer, scene, camera, sculpture, geometry, environment, frame = 0, recoveryFrame = 0;
  let disposed = false, intersecting = true, lost = false, time = 0, last = 0;
  let audio = 0, level = 0, pointerX = 0, pointerY = 0, rotationX = 0, rotationY = 0;
  const materials = [], rings = [], layout = acousticLayout();
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  host.dataset.renderer = 'fallback';
  host.dataset.ready = 'false';
  const pauseFrame = () => { runtime.cancelAnimationFrame(frame); frame = 0; last = 0; };
  function shouldRun() { return !disposed && !paused && !document.hidden && intersecting && !lost && !!renderer; }
  function draw(delta = 0) {
    if (!renderer || lost || disposed) return;
    level = smoothTarget(level, audio, delta, 8);
    rotationX = smoothTarget(rotationX, pointerY * .075, delta, 6);
    rotationY = smoothTarget(rotationY, pointerX * .12, delta, 6);
    sculpture.rotation.set(.08 + rotationX, -.05 + rotationY, -.12);
    for (let index = 0; index < rings.length; index++) {
      const shape = layout[index];
      const breath = 1 + Math.sin(time * .58 + shape.phase) * .018 + level * .065;
      rings[index].scale.set(shape.radius * .80 * breath, shape.radius * breath, 1);
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
    camera.position.set(2.6, 1.7, camera.aspect < 1.35 ? 12.8 : 8.6);
    camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); draw();
  }
  function initialize() {
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.10;
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
      scene.add(new HemisphereLight(0xcce9ff, 0x0b1632, 1.4));
      const key = new DirectionalLight(0xeef8ff, 4.8); key.position.set(-3, 5, 6); scene.add(key);
      const fill = new DirectionalLight(0x258aff, 4.0); fill.position.set(3, -.5, 3); scene.add(fill);
      const edge = new DirectionalLight(0xffffff, 3.0); edge.position.set(0, 2, -5); scene.add(edge);
      sculpture = new Group();
      geometry = new TorusGeometry(1, .017, 10, 96);
      for (const shape of layout) {
        const tint = new Color().setHSL(shape.hue / 360, .60, .70);
        const material = new MeshPhysicalMaterial({
          color: tint, metalness: .90, roughness: .22,
          clearcoat: .55, clearcoatRoughness: .22, envMapIntensity: 1.3,
        });
        const ring = new Mesh(geometry, material);
        ring.position.set(shape.x, Math.sin(shape.phase * 1.3) * .12, 0);
        ring.rotation.y = Math.PI / 2;
        materials.push(material); rings.push(ring); sculpture.add(ring);
      }
      scene.add(sculpture);
      host.dataset.renderer = 'webgl'; host.dataset.ready = 'true';
      resize(); schedule();
    } catch {
      pauseFrame();
      geometry?.dispose(); materials.forEach(material => material.dispose());
      environment?.dispose(); renderer?.dispose(); renderer = null;
      host.dataset.renderer = 'fallback'; host.dataset.ready = 'false';
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
    host.dataset.ready = 'false'; host.dataset.renderer = 'fallback';
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
        resize(); host.dataset.ready = 'true'; host.dataset.renderer = 'webgl'; schedule();
      } catch {
        lost = true; pauseFrame();
        geometry?.dispose(); materials.forEach(material => material.dispose());
        environment?.dispose(); renderer?.dispose(); renderer = null;
        host.dataset.ready = 'false'; host.dataset.renderer = 'fallback';
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
