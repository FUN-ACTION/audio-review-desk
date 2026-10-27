import { copy } from "./tour-copy.js?v=0.9.0";
import { installCommands, mediaPath } from "./playback-policy.js";
import { sampleSignal } from "./studio-signal.js";
import { damp } from "./scene-physics.js?v=0.9.0";
const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion:reduce)");
const compact = matchMedia("(max-width:812px)");
const fine = matchMedia("(hover:hover) and (pointer:fine)");
const saveData = navigator.connection?.saveData === true;
const graphicsOff =
  new URLSearchParams(location.search).get("graphics") === "off";
const local = ["127.0.0.1", "localhost"].includes(location.hostname);
const easing = "cubic-bezier(.35,0,0,1)";
let language = navigator.language.startsWith("zh") ? "zh" : "en";
try {
  language = localStorage.getItem("ard-tour-language") || language;
} catch {}
if (!copy[language]) language = "en";
const t = (key) => copy[language][key];
let platform = "windows",
  menuOpen = false,
  menuGeneration = 0,
  menuEffects = [],
  menuFocus = null;
let scene = null,
  userPausedScene = null,
  reelSurface = null,
  loadingReel = false,
  reelGeneration = 0;
let audio = null,
  sound = null,
  analyser = null,
  samples = null,
  samplePlaying = false,
  samplePending = false,
  audioGeneration = 0,
  audioFrame = 0;
const cinema = $("cinemaDialog"),
  cinemaVideo = $("cinemaVideo"),
  menu = $("siteMenu"),
  scrim = $("menuScrim");
const entries = [...document.querySelectorAll("video[data-film]")].map(
  (video) => ({
    video,
    id: video.dataset.film,
    ratio: 0,
    hover: false,
    focused: false,
    choice: "auto",
    loaded: false,
    failed: false,
  }),
);
const mainEntry = entries.find((entry) => entry.id === "workflow");
const effect = (element, frames, options) => {
  if (reduced.matches) return null;
  return element.animate(frames, {
    duration: 500,
    easing,
    fill: "both",
    ...options,
  });
};
function paintSample() {
  const active = samplePlaying || samplePending;
  $("samplePlay").setAttribute("aria-pressed", String(active));
  $("samplePlay").setAttribute(
    "aria-label",
    t(active ? "stopListening" : "listen"),
  );
  document.querySelector("[data-sample-label]").textContent = t(
    active ? "stopListening" : "listen",
  );
}
function stopSample() {
  audioGeneration++;
  cancelAnimationFrame(audioFrame);
  audioFrame = 0;
  if (sound) {
    sound.onended = null;
    try {
      sound.stop();
    } catch {}
    sound.disconnect();
    sound = null;
  }
  samplePlaying = false;
  samplePending = false;
  scene?.setAudioLevel(0);
  paintSample();
}
async function toggleSample() {
  if (samplePlaying || samplePending) {
    stopSample();
    return;
  }
  samplePending = true;
  paintSample();
  const generation = ++audioGeneration;
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw Error("audio");
    audio ||= new Context();
    await audio.resume();
    if (generation !== audioGeneration || document.hidden) return;
    const values = sampleSignal(22050, "a"),
      buffer = audio.createBuffer(1, values.length, 22050);
    buffer.copyToChannel(values, 0);
    sound = audio.createBufferSource();
    sound.buffer = buffer;
    analyser ||= audio.createAnalyser();
    analyser.fftSize = 256;
    samples ||= new Float32Array(256);
    sound.connect(analyser);
    analyser.disconnect();
    analyser.connect(audio.destination);
    sound.onended = () => {
      if (generation === audioGeneration) stopSample();
    };
    samplePending = false;
    samplePlaying = true;
    sound.start();
    $("sampleError").hidden = true;
    paintSample();
    const tick = () => {
      if (!samplePlaying) return;
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const n of samples) energy += n * n;
      if (scene && !scene.paused)
        scene.setAudioLevel(Math.sqrt(energy / samples.length) * 5);
      audioFrame = requestAnimationFrame(tick);
    };
    audioFrame = requestAnimationFrame(tick);
  } catch {
    if (generation !== audioGeneration) return;
    stopSample();
    $("sampleError").textContent = t("sampleError");
    $("sampleError").hidden = false;
  }
}
$("samplePlay").addEventListener("click", toggleSample);
function paintMotion() {
  const paused = graphicsOff
    ? true
    : scene
      ? scene.paused
      : (userPausedScene ?? reduced.matches);
  $("motionToggle").setAttribute("aria-pressed", String(paused));
  $("motionToggle").setAttribute(
    "aria-label",
    t(paused ? "motionPlay" : "motionPause"),
  );
}
$("motionToggle").addEventListener("click", () => {
  userPausedScene = !(scene
    ? scene.paused
    : (userPausedScene ?? reduced.matches));
  scene?.setPaused(userPausedScene);
  scene?.setAudioLevel(0);
  paintMotion();
});
if (graphicsOff) {
  $("heroScene").dataset.ready = "false";
  $("motionToggle").disabled = true;
} else
  import("./scene.js?v=0.9.0")
    .then(({ mountScene }) => {
      scene = mountScene($("heroScene"));
      if (userPausedScene !== null) scene.setPaused(userPausedScene);
      $("heroScene").dataset.ready = String(scene.ready);
      paintMotion();
      if (!scene.ready) $("motionToggle").disabled = true;
    })
    .catch(() => {
      $("heroScene").dataset.renderer = "poster";
      $("heroScene").dataset.ready = "false";
      $("motionToggle").disabled = true;
    });
$("paletteToggle").addEventListener("click", () => scene?.burst());
$("heroScene").addEventListener("motionchange", () => {
  $("motionToggle").disabled = !scene?.ready;
  $("heroScene").dataset.ready = String(!!scene?.ready);
  paintMotion();
});
const heroObserver = new IntersectionObserver(
  ([entry]) => {
    if (!entry.isIntersecting) stopSample();
  },
  { threshold: 0 },
);
heroObserver.observe($("heroScene"));

async function setMenu(open, { focus = true } = {}) {
  const generation = ++menuGeneration;
  const cards = [...menu.querySelectorAll(".menu-links,.menu-bottom")];
  const wasHidden = menu.hidden;
  const presentation = cards.map((card) => {
    const st = getComputedStyle(card);
    return { opacity: st.opacity, transform: st.transform };
  });
  const scrimOpacity = scrim.hidden ? "0" : getComputedStyle(scrim).opacity;
  menuEffects.forEach((e) => e?.cancel());
  menuEffects = [];
  menuOpen = open;
  $("menuToggle").setAttribute("aria-expanded", String(open));
  $("menuToggle").setAttribute("aria-label", t(open ? "close" : "menu"));
  $("main").toggleAttribute("inert", open);
  $("main").setAttribute("aria-hidden", String(open));
  if (open) {
    menu.hidden = false;
    menu.removeAttribute("inert");
    scrim.hidden = false;
    menuEffects.push(
      effect(scrim, [{ opacity: scrimOpacity }, { opacity: 1 }], {
        duration: 400,
      }),
    );
    cards.forEach((card, i) =>
      menuEffects.push(
        effect(
          card,
          [
            wasHidden
              ? { opacity: 0, transform: "translateY(80px) rotate(3.5deg)" }
              : presentation[i],
            { opacity: 1, transform: "translateY(0) rotate(0)" },
          ],
          { delay: wasHidden ? i * 20 : 0, easing: "cubic-bezier(.4,0,.1,1)" },
        ),
      ),
    );
  } else {
    menu.setAttribute("inert", "");
    if (focus) $("menuToggle").focus({ preventScroll: true });
    cards.forEach((card, i) =>
      menuEffects.push(
        effect(
          card,
          [
            presentation[i],
            { opacity: 0, transform: "translateY(80px) rotate(3.5deg)" },
          ],
          {
            duration: 400,
            delay: (cards.length - i - 1) * 20,
            easing: "cubic-bezier(.4,0,.1,1)",
          },
        ),
      ),
    );
    menuEffects.push(
      effect(scrim, [{ opacity: scrimOpacity }, { opacity: 0 }], {
        duration: 400,
      }),
    );
    await Promise.all(
      menuEffects.filter(Boolean).map((e) => e.finished.catch(() => {})),
    );
    if (generation !== menuGeneration) return;
    menu.hidden = true;
    scrim.hidden = true;
  }
  syncVideos();
}
$("menuToggle").addEventListener("click", () => setMenu(!menuOpen));
scrim.addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuOpen) {
    event.preventDefault();
    setMenu(false);
  }
  if (event.key === "Tab" && menuOpen) {
    const items = [$("menuToggle"), ...menu.querySelectorAll("a,button")];
    const index = items.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      items.at(-1).focus();
    } else if (!event.shiftKey && index === items.length - 1) {
      event.preventDefault();
      items[0].focus();
    }
  }
});
document.querySelectorAll('a[href^="#"]').forEach((link) =>
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    if (menuOpen) setMenu(false, { focus: false });
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: reduced.matches ? "instant" : "smooth",
      block: "start",
    });
  }),
);

function load(entry, retry = false) {
  if (entry.loaded && !retry) return;
  entry.loaded = true;
  entry.failed = false;
  entry.video.src = `${mediaPath(entry.id, language)}?v=0.9.0`;
  entry.video.load();
}
function syncVideos() {
  for (const entry of entries) {
    const visible = entry.ratio > 0.05;
    const intent =
      entry === mainEntry ||
      entry.hover ||
      entry.focused ||
      (!fine.matches && entry.ratio > 0.5);
    const allowed =
      entry.choice === "play" ||
      (entry.choice !== "pause" && !reduced.matches && !saveData && intent);
    const play =
      visible &&
      allowed &&
      !entry.failed &&
      !document.hidden &&
      !cinema.open &&
      !menuOpen;
    if (play) {
      load(entry);
      if (entry.video.paused) entry.video.play().catch(() => paintPreview());
    } else entry.video.pause();
  }
  reelSurface?.setActive(
    mainEntry.ratio > 0 && !cinema.open && !document.hidden,
  );
  paintPreview();
}
function paintPreview() {
  const paused = mainEntry.video.paused;
  $("previewControl").textContent = mainEntry.failed
    ? "↻"
    : paused
      ? "▶"
      : "Ⅱ";
  $("previewControl").setAttribute(
    "aria-label",
    t(
      mainEntry.failed
        ? "retryPreview"
        : paused
          ? "playPreview"
          : "pausePreview",
    ),
  );
}
$("previewControl").addEventListener("click", () => {
  mainEntry.choice = mainEntry.video.paused ? "play" : "pause";
  if (mainEntry.failed) load(mainEntry, true);
  syncVideos();
});
mainEntry.video.addEventListener("play", paintPreview);
mainEntry.video.addEventListener("pause", paintPreview);
for (const entry of entries) {
  entry.video.addEventListener("error", () => {
    entry.failed = true;
    entry.video.pause();
    paintPreview();
  });
  const card = entry.video.closest(".work-card");
  if (card) {
    card.addEventListener("pointerenter", () => {
      entry.hover = true;
      syncVideos();
    });
    card.addEventListener("pointerleave", () => {
      entry.hover = false;
      syncVideos();
    });
    card.addEventListener("focus", () => {
      entry.focused = true;
      syncVideos();
    });
    card.addEventListener("blur", () => {
      entry.focused = false;
      syncVideos();
    });
  }
}
async function mountReel() {
  if (
    loadingReel ||
    reelSurface ||
    compact.matches ||
    reduced.matches ||
    graphicsOff ||
    saveData
  )
    return;
  loadingReel = true;
  const generation = ++reelGeneration;
  try {
    const { mountReelSurface } = await import("./reel-warp.js?v=0.9.0");
    if (generation !== reelGeneration) return;
    reelSurface = mountReelSurface({
      host: $("reelStage"),
      video: mainEntry.video,
    });
    reelSurface.update(reelProgress);
    reelSurface.setActive(mainEntry.ratio > 0);
  } catch {
  } finally {
    loadingReel = false;
  }
}
const videosObserver = new IntersectionObserver(
  (changes) => {
    for (const change of changes) {
      const entry = entries.find((e) => e.video === change.target);
      if (entry) entry.ratio = change.intersectionRatio;
    }
    if (mainEntry.ratio > 0) mountReel();
    syncVideos();
  },
  { threshold: [0, 0.05, 0.15, 0.4, 0.6, 1] },
);
entries.forEach((e) => videosObserver.observe(e.video));

let cinemaTrigger = null,
  cinemaEntry = null,
  cinemaGeneration = 0;
for (const button of document.querySelectorAll("[data-open-film]"))
  button.addEventListener("click", () => {
    cinemaTrigger = button;
    cinemaEntry = entries.find((e) => e.id === button.dataset.openFilm);
    const generation = ++cinemaGeneration;
    stopSample();
    if (menuOpen) setMenu(false, { focus: false });
    $("cinemaTitle").textContent = t(
      cinemaEntry.id === "workflow"
        ? "cinemaWorkflow"
        : cinemaEntry.id === "notes"
          ? "cinemaNotes"
          : "cinemaRange",
    );
    $("cinemaError").hidden = true;
    cinemaVideo.poster = `${mediaPath(cinemaEntry.id, language, "webp")}?v=0.9.0`;
    cinemaVideo.src = `${mediaPath(cinemaEntry.id, language)}?v=0.9.0`;
    cinemaVideo.load();
    cinema.showModal();
    document.documentElement.style.overflow = "hidden";
    syncVideos();
    effect(cinema, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 450,
      fill: "none",
    });
    cinemaVideo.play().catch(() => {
      if (generation === cinemaGeneration && cinema.open)
        $("cinemaError").hidden = false;
    });
  });
$("closeCinema").addEventListener("click", () => cinema.close());
cinema.addEventListener("close", () => {
  cinemaGeneration++;
  cinemaVideo.pause();
  cinemaVideo.removeAttribute("src");
  cinemaVideo.load();
  document.documentElement.style.overflow = "";
  cinemaEntry = null;
  syncVideos();
  cinemaTrigger?.focus({ preventScroll: true });
});
cinemaVideo.addEventListener("error", () => {
  if (cinema.open) $("cinemaError").hidden = false;
});

let scrollFrame = 0,
  reelProgress = 0,
  lastScrollFrame = 0;
const ribbon = $("ribbonPath"),
  ribbonLength = ribbon.getTotalLength();
ribbon.style.strokeDasharray = String(ribbonLength);
function scrollTick(now) {
  scrollFrame = 0;
  const dt = lastScrollFrame
    ? Math.min(0.05, (now - lastScrollFrame) / 1000)
    : 0.016;
  lastScrollFrame = now;
  const rect = $("reelHold").getBoundingClientRect();
  const target =
    reduced.matches || compact.matches
      ? 1
      : Math.max(
          0,
          Math.min(1, (innerHeight * 0.94 - rect.top) / (innerHeight * 0.82)),
        );
  reelProgress = reduced.matches ? target : damp(reelProgress, target, 12, dt);
  const p = Math.abs(reelProgress - target) < 0.001 ? target : reelProgress;
  const width = 46 + 54 * p,
    height = 72 + 28 * p,
    top = 14 * (1 - p);
  if (!compact.matches && !reduced.matches) {
    for (const element of [
      mainEntry.video,
      document.querySelector(".reel-open"),
    ]) {
      element.style.width = `${width}%`;
      element.style.height = `${height}%`;
      element.style.top = `${top}%`;
    }
    $("previewControl").style.right = `calc(${100 - width}% + 20px)`;
    $("previewControl").style.bottom = `calc(${100 - top - height}% + 18px)`;
  } else {
    for (const element of [
      mainEntry.video,
      document.querySelector(".reel-open"),
    ]) {
      element.style.width = "";
      element.style.height = "";
      element.style.top = "";
    }
    $("previewControl").style.right = "";
    $("previewControl").style.bottom = "";
  }
  document.querySelectorAll(".reel-word").forEach((word) => {
    word.style.opacity = String(
      compact.matches || reduced.matches
        ? 1
        : Math.max(0, Math.min(1, (p - 0.3) / 0.55)),
    );
  });
  reelSurface?.update(p);
  const section = $("reel").getBoundingClientRect();
  const ribbonP = Math.max(
    0,
    Math.min(1, (innerHeight - section.top) / (section.height * 0.85)),
  );
  ribbon.style.strokeDashoffset = String((1 - ribbonP) * ribbonLength);
  if (Math.abs(reelProgress - target) > 0.001)
    scrollFrame = requestAnimationFrame(scrollTick);
}
const requestScroll = () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollTick);
};
window.addEventListener("scroll", requestScroll, { passive: true });
window.addEventListener("resize", requestScroll, { passive: true });
const reveals = new IntersectionObserver(
  (changes) => {
    for (const entry of changes) {
      if (!entry.isIntersecting) continue;
      reveals.unobserve(entry.target);
      effect(
        entry.target,
        [
          { opacity: 0, transform: "translateY(30px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 800, fill: "none" },
      );
    }
  },
  { threshold: 0.2 },
);
document
  .querySelectorAll(".work-card,.work-heading,.download-section")
  .forEach((e) => reveals.observe(e));

function showPlatform(next) {
  platform = next;
  for (const tab of document.querySelectorAll("[data-platform]")) {
    const active = tab.dataset.platform === next;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  $("installInstructions").setAttribute("aria-labelledby", `platform-${next}`);
  $("installHint").textContent = t(
    next === "windows" ? "installWindows" : "installUnix",
  );
  $("installCode").textContent = installCommands(next);
  $("installCode").parentElement.hidden = next === "windows";
  $("copyInstall").hidden = next === "windows";
  $("copyStatus").textContent = "";
}
for (const tab of document.querySelectorAll("[data-platform]")) {
  tab.addEventListener("click", () => showPlatform(tab.dataset.platform));
  tab.addEventListener("keydown", (event) => {
    const all = [...document.querySelectorAll("[data-platform]")],
      index = all.indexOf(tab);
    let next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 2
          : event.key === "ArrowRight"
            ? (index + 1) % 3
            : event.key === "ArrowLeft"
              ? (index + 2) % 3
              : null;
    if (next !== null) {
      event.preventDefault();
      showPlatform(all[next].dataset.platform);
      all[next].focus();
    }
  });
}
$("copyInstall").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(installCommands(platform));
    $("copyStatus").textContent = t("copied");
  } catch {
    $("copyStatus").textContent = t("copyFailed");
  }
});
function translate() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = "Audio Review Desk";
  document.querySelector("meta[name=description]").content = t("intro");
  document
    .querySelectorAll("[data-copy]")
    .forEach((e) => (e.textContent = t(e.dataset.copy)));
  document
    .querySelectorAll("[data-label]")
    .forEach((e) => e.setAttribute("aria-label", t(e.dataset.label)));
  menu.setAttribute("aria-label", language === "zh" ? "导航" : "Navigation");
  $("menuToggle").setAttribute("aria-label", t(menuOpen ? "close" : "menu"));
  $("language").textContent = language === "zh" ? "English" : "中文";
  $("language").setAttribute(
    "aria-label",
    language === "zh" ? "Switch to English" : "切换到中文",
  );
  for (const primary of document.querySelectorAll("[data-primary]")) {
    primary.href = local
      ? "/"
      : "https://github.com/FUN-ACTION/audio-review-desk/releases/latest";
    const label = primary.querySelector("[data-copy]");
    if (local) label.textContent = t("open");
  }
  for (const entry of entries) {
    entry.video.pause();
    entry.loaded = false;
    entry.failed = false;
    entry.video.removeAttribute("src");
    entry.video.poster = `${mediaPath(entry.id, language, "webp")}?v=0.9.0`;
    entry.video.load();
  }
  if (!$("sampleError").hidden) $("sampleError").textContent = t("sampleError");
  showPlatform(platform);
  paintSample();
  paintMotion();
  syncVideos();
  requestScroll();
}
$("language").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  try {
    localStorage.setItem("ard-tour-language", language);
  } catch {}
  translate();
});
const modeChange = () => {
  reelGeneration++;
  reelSurface?.dispose();
  reelSurface = null;
  loadingReel = false;
  if (!reduced.matches && !compact.matches) mountReel();
  syncVideos();
  requestScroll();
};
reduced.addEventListener("change", modeChange);
compact.addEventListener("change", modeChange);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopSample();
    cinemaVideo.pause();
  }
  syncVideos();
});
translate();
requestScroll();

const lineReveal = new IntersectionObserver(
  (changes) => {
    for (const entry of changes) {
      if (!entry.isIntersecting) continue;
      lineReveal.unobserve(entry.target);
      [...entry.target.querySelectorAll(".title-line > span")].forEach(
        (line, i) =>
          effect(
            line,
            [
              { transform: "translateY(110%) rotate(2deg)" },
              { transform: "translateY(0) rotate(0)" },
            ],
            { duration: 850, delay: i * 70, fill: "none" },
          ),
      );
    }
  },
  { threshold: 0.35 },
);
document
  .querySelectorAll(".reveal-lines")
  .forEach((e) => lineReveal.observe(e));
