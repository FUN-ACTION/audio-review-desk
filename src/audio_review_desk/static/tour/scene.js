import * as T from "./scene-vendor.js?v=0.9.0";
import {
  createBodies,
  stepBodies,
  kickBodies,
  damp,
} from "./scene-physics.js?v=0.9.0";
import { NOTE_KINDS, createNoteGeometry } from "./note-geometry.js?v=0.11.1";

function musicalGeometry(kind) {
  const data = createNoteGeometry(kind);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(data.positions, 3));
  geometry.setAttribute("normal", new T.BufferAttribute(data.normals, 3));
  geometry.setIndex(new T.BufferAttribute(data.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function mountScene(host) {
  const canvas = host.querySelector("canvas");
  let renderer;
  try {
    renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
  } catch {
    host.dataset.renderer = "poster";
    return {
      ready: false,
      paused: true,
      setPaused() {},
      setAudioLevel() {},
      burst() {},
      dispose() {},
    };
  }
  renderer.setClearColor("#11131b", 1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.93;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  scene.background = new T.Color("#11131b");
  scene.fog = new T.Fog("#11131b", 24, 42);
  const camera = new T.PerspectiveCamera(36, 1, 0.1, 70);
  camera.position.set(0, 0, 18.5);
  const pmrem = new T.PMREMGenerator(renderer);
  const room = new T.RoomEnvironment();
  let environment = pmrem.fromScene(room, 0.035);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  const key = new T.DirectionalLight("#ffffff", 3.0);
  key.position.set(-5, 7, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -10;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new T.DirectionalLight("#dce4ff", 0.95);
  fill.position.set(7, -2, 4);
  scene.add(fill);
  scene.add(new T.HemisphereLight("#f6f7ff", "#161a37", 0.7));
  const geometries = NOTE_KINDS.map(musicalGeometry);
  const colors = [
    ["#e8e7e2", "#242831", "#281cdb"],
    ["#d9d8d2", "#151720", "#ff643a"],
    ["#d8eadf", "#101915", "#85e0b6"],
  ];
  const paletteTargets = colors[0].map((color) => new T.Color(color));
  const materials = colors[0].map(
    (color, i) =>
      new T.MeshPhysicalMaterial({
        color,
        metalness: i === 1 ? 0.7 : i === 2 ? 0.22 : 0.06,
        roughness: i === 1 ? 0.24 : 0.2,
        clearcoat: 0.8,
        clearcoatRoughness: 0.14,
        envMapIntensity: i === 1 ? 0.85 : 0.7,
        transparent: false,
        opacity: 1,
      }),
  );
  const compact = matchMedia("(max-width:720px)").matches;
  const bodies = createBodies({ seed: 913, count: compact ? 12 : 20 });
  const layout = bodies.map((body) => ({
    x: body.homeX / 6.8,
    y: body.homeY / 3.45,
    z: body.homeZ / 2.65,
    scale: body.scale,
  }));
  const bounds = { x: 8, y: 3, z: 1.7 };
  // The symbols retain a readable front face while their bevels catch the room.
  // Two quarter notes, an eighth, a beamed pair, then an occasional clef.
  const sculptureSequence = [0, 1, 0, 2, 1, 0, 2, 3];
  const sculptures = bodies.map((body, index) => ({
    kind: sculptureSequence[index % sculptureSequence.length],
    roll: Math.sin(index * 2.17) * 0.42,
  }));
  const group = new T.Group(); // A transform shared by the whole composition.
  scene.add(group);
  const pools = [];
  function addPool(geometry, material, indices) {
    if (!indices.length) return;
    const mesh = new T.InstancedMesh(geometry, material, indices.length);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    pools.push({ mesh, indices });
  }
  materials.forEach((material, index) => {
    geometries.forEach((geometry, kind) => {
      const indices = bodies
        .map((body, i) =>
          body.material === index && sculptures[i].kind === kind ? i : -1,
        )
        .filter((i) => i >= 0);
      addPool(geometry, material, indices);
    });
  });
  const dragLocal = new T.Vector3();
  const dummy = new T.Object3D(),
    raycaster = new T.Raycaster(),
    mouse = new T.Vector2(),
    world = new T.Vector3();
  const pointer = { x: 0, y: 0, z: 1, active: false };
  const targetPointer = { x: 0, y: 0 };
  const reduced = matchMedia("(prefers-reduced-motion:reduce)");
  let visible = true,
    paused = reduced.matches,
    manualPaused = null,
    contextLost = false,
    beforeContextPause = true,
    pointerId = null,
    disposed = false,
    raf = 0,
    last = 0,
    phase = 0,
    audioLevel = 0,
    drag = null,
    down = null,
    travel = 0;
  let pixelRatio = Math.min(devicePixelRatio || 1, compact ? 1.35 : 1.7),
    frameTime = 16,
    slowFrames = 0;
  const updateInstances = () => {
    for (const pool of pools) {
      pool.indices.forEach((index, slot) => {
        const b = bodies[index];
        const sculpture = sculptures[index];
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(
          Math.sin(b.rx) * 0.4,
          Math.sin(b.ry) * 0.62,
          sculpture.roll + Math.sin(b.rz) * 0.18,
        );
        dummy.scale.setScalar(b.scale * (1 + audioLevel * 0.09));
        dummy.updateMatrix();
        pool.mesh.setMatrixAt(slot, dummy.matrix);
      });
      pool.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  function render(now = performance.now()) {
    raf = 0;
    if (disposed || contextLost || !visible || document.hidden) return;
    const elapsed = Math.max(1, last ? now - last : 16);
    const dt = Math.min(0.033, elapsed / 1000);
    last = now;
    if (!paused) {
      materials
        .slice(0, 3)
        .forEach((m, i) =>
          m.color.lerp(paletteTargets[i], 1 - Math.exp(-12 * dt)),
        );
      pointer.x = damp(pointer.x, targetPointer.x, 12, dt);
      pointer.y = damp(pointer.y, targetPointer.y, 12, dt);
      let physicsDrag = null;
      if (drag) {
        group.updateWorldMatrix(true, false);
        dragLocal.copy(drag.world).add(drag.offset);
        group.worldToLocal(dragLocal);
        physicsDrag = {
          index: drag.index,
          x: dragLocal.x,
          y: dragLocal.y,
          z: dragLocal.z,
        };
      }
      stepBodies(bodies, dt, {
        pointer: drag ? null : pointer,
        drag: physicsDrag,
        bounds,
      });
      const rect = host.getBoundingClientRect();
      const scroll = Math.max(0, Math.min(1, -rect.top / (rect.height * 0.9)));
      if (!drag) {
        group.rotation.y = damp(
          group.rotation.y,
          pointer.active ? targetPointer.x * 0.013 : 0,
          4,
          dt,
        );
        group.rotation.x = damp(
          group.rotation.x,
          (pointer.active ? -targetPointer.y * 0.014 : 0) + scroll * 0.12,
          4,
          dt,
        );
        group.position.y = damp(group.position.y, -scroll * 0.65, 5, dt);
      }
    }
    updateInstances();
    renderer.render(scene, camera);
    frameTime = frameTime * 0.95 + elapsed * 0.05;
    if (frameTime > 29 && ++slowFrames > 100 && pixelRatio > 1.1) {
      pixelRatio = Math.max(1, pixelRatio - 0.2);
      renderer.setPixelRatio(pixelRatio);
      resize();
      slowFrames = 0;
    }
    if (!paused) request();
  }
  const request = () => {
    if (!raf && !disposed && !contextLost && visible && !document.hidden)
      raf = requestAnimationFrame(render);
  };
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const narrow = camera.aspect < 1;
    camera.position.z = narrow ? 14.8 : 12.2;
    bounds.z = narrow ? 1.1 : 1.7;
    const visibleY = (camera.position.z - bounds.z) * Math.tan(Math.PI / 10);
    bounds.x = Math.max(1.5, visibleY * camera.aspect - (narrow ? 0.85 : 1.15));
    bounds.y = visibleY - (narrow ? 0.85 : 1.21);
    bodies.forEach((body, index) => {
      const rest = layout[index];
      const x = rest.x * bounds.x * (narrow ? 0.84 : 1.12),
        y = rest.y * bounds.y * 0.82,
        z = rest.z * bounds.z * 0.75;
      body.x += x - body.homeX;
      body.y += y - body.homeY;
      body.z += z - body.homeZ;
      body.homeX = x;
      body.homeY = y;
      body.homeZ = z;
      body.scale = rest.scale * (narrow ? 0.8 : 1);
    });
    camera.updateProjectionMatrix();
    request();
  }
  const projected = (event, z = 1) => {
    const rect = canvas.getBoundingClientRect();
    mouse.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(mouse, camera);
    raycaster.ray.intersectPlane(
      new T.Plane(new T.Vector3(0, 0, 1), -z),
      world,
    );
    return world;
  };
  function move(event) {
    const point = projected(event, drag ? drag.planeZ : 1);
    targetPointer.x = point.x;
    targetPointer.y = point.y;
    pointer.active = event.pointerType !== "touch";
    if (down)
      ((travel += Math.hypot(event.clientX - down.x, event.clientY - down.y)),
        (down.x = event.clientX),
        (down.y = event.clientY));
    if (drag) {
      drag.world.copy(point);
      request();
    }
  }
  function press(event) {
    if (event.button !== 0) return;
    projected(event);
    const hits = raycaster.intersectObjects(
      pools.map((p) => p.mesh),
      false,
    );
    down = { x: event.clientX, y: event.clientY };
    travel = 0;
    if (hits.length && !paused) {
      const hit = hits[0],
        pool = pools.find((p) => p.mesh === hit.object),
        index = pool.indices[hit.instanceId],
        b = bodies[index];
      group.updateWorldMatrix(true, false);
      const center = group.localToWorld(new T.Vector3(b.x, b.y, b.z));
      drag = {
        index,
        planeZ: hit.point.z,
        world: hit.point.clone(),
        offset: center.sub(hit.point),
      };
      pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      host.classList.add("is-dragging");
    }
  }
  function release(event) {
    if (!down) return;
    const click = travel < 7;
    down = null;
    drag = null;
    host.classList.remove("is-dragging");
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    pointerId = null;
    if (click) burst();
  }
  function burst() {
    phase = (phase + 1) % colors.length;
    paletteTargets.forEach((color, i) => color.set(colors[phase][i]));
    if (paused)
      materials.slice(0, 3).forEach((m, i) => m.color.copy(paletteTargets[i]));
    if (!paused) kickBodies(bodies, phase);
    request();
    host.dispatchEvent(new CustomEvent("palettechange", { detail: { phase } }));
  }
  const leave = () => {
    pointer.active = false;
  };
  const cancel = () => {
    down = null;
    drag = null;
    pointer.active = false;
    host.classList.remove("is-dragging");
    if (pointerId !== null && canvas.hasPointerCapture(pointerId))
      canvas.releasePointerCapture(pointerId);
    pointerId = null;
  };
  const visibility = () => {
    last = 0;
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else request();
  };
  const notify = () =>
    host.dispatchEvent(new CustomEvent("motionchange", { detail: { paused } }));
  const mediaChange = () => {
    beforeContextPause = manualPaused ?? reduced.matches;
    paused = contextLost || beforeContextPause;
    cancel();
    if (paused) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    request();
    notify();
  };
  const lost = (event) => {
    event.preventDefault();
    beforeContextPause = paused;
    contextLost = true;
    paused = true;
    cancel();
    cancelAnimationFrame(raf);
    raf = 0;
    host.dataset.renderer = "poster";
    notify();
  };
  const restored = () => {
    if (disposed) return;
    try {
      const generator = new T.PMREMGenerator(renderer),
        newRoom = new T.RoomEnvironment();
      environment.dispose();
      environment = generator.fromScene(newRoom, 0.035);
      scene.environment = environment.texture;
      newRoom.dispose();
      generator.dispose();
      contextLost = false;
      paused = beforeContextPause;
      host.dataset.renderer = "webgl";
      last = 0;
      resize();
      notify();
    } catch {
      contextLost = true;
      host.dataset.renderer = "poster";
      notify();
    }
  };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerdown", press);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  document.addEventListener("visibilitychange", visibility);
  reduced.addEventListener("change", mediaChange);
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      last = 0;
      if (visible) request();
      else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { threshold: 0 },
  );
  observer.observe(host);
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  host.dataset.renderer = "webgl";
  resize();
  return {
    get ready() {
      return !contextLost && !disposed;
    },
    get paused() {
      return paused;
    },
    setPaused(value) {
      manualPaused = !!value;
      beforeContextPause = manualPaused;
      paused = contextLost || manualPaused;
      last = 0;
      cancel();
      if (paused) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      request();
      notify();
    },
    setAudioLevel(value) {
      audioLevel = Math.max(0, Math.min(1, Number(value) || 0));
      if (paused) request();
    },
    burst,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      sizeObserver.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", mediaChange);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerdown", press);
      canvas.removeEventListener("pointerup", release);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointercancel", cancel);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((m) => m.dispose());
      environment.dispose();
      renderer.dispose();
    },
  };
}
