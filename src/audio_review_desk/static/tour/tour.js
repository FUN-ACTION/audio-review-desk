import { copy } from "./tour-copy.js?v=0.11.1";
import { installCommands } from "./playback-policy.js";
import { sampleSignal } from "./studio-signal.js";
import { damp } from "./scene-physics.js?v=0.11.1";
import { mountMusicArt } from "./music-art.js?v=0.11.1";
const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion:reduce)");
const compact = matchMedia("(max-width:812px)");
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
  menuEffects = [];
let scene = null,
  userPausedScene = null;
let audio = null,
  sound = null,
  analyser = null,
  samples = null,
  samplePlaying = false,
  samplePending = false,
  audioGeneration = 0,
  audioFrame = 0;
const menu = $("siteMenu"),
  scrim = $("menuScrim");
const artworks = [...document.querySelectorAll('[data-art]')].map(host => mountMusicArt(host, {kind:host.dataset.art, language}));
if (new URLSearchParams(location.search).get('motion') === 'off') userPausedScene = true;
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
    if (generation !== audioGeneration) return;
    const bounds = $('top').getBoundingClientRect();
    if (document.hidden || menuOpen || bounds.bottom <= 0 || bounds.top >= innerHeight) { stopSample(); return; }
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
  const paused = userPausedScene ?? reduced.matches;
  $("motionToggle").setAttribute("aria-pressed", String(paused));
  $("motionToggle").setAttribute(
    "aria-label",
    t(paused ? "motionPlay" : "motionPause"),
  );
  const sceneReady = !!scene?.ready;
  $("paletteToggle").hidden = !sceneReady;
  $("heroScene").setAttribute("aria-label", t(sceneReady ? "scene" : "sceneStatic"));
}
$("motionToggle").addEventListener("click", () => {
  userPausedScene = !(userPausedScene ?? reduced.matches);
  scene?.setPaused(userPausedScene);
  scene?.setAudioLevel(0);
  paintMotion();
  syncMotion();
});
if (graphicsOff) {
  $("heroScene").dataset.ready = "false";
  $("motionToggle").disabled = false;
} else
  import("./scene.js?v=0.11.1")
    .then(({ mountScene }) => {
      scene = mountScene($("heroScene"));
      if (userPausedScene !== null) scene.setPaused(userPausedScene);
      $("heroScene").dataset.ready = String(scene.ready);
      paintMotion();
      syncMotion();
      if (!scene.ready) $("motionToggle").disabled = false;
    })
    .catch(() => {
      $("heroScene").dataset.renderer = "poster";
      $("heroScene").dataset.ready = "false";
      $("motionToggle").disabled = false;
    });
$("paletteToggle").addEventListener("click", () => scene?.burst());
$("heroScene").addEventListener("motionchange", () => {
  $("motionToggle").disabled = false;
  $("heroScene").dataset.ready = String(!!scene?.ready);
  paintMotion();
});
const heroObserver = new IntersectionObserver(
  ([entry]) => {
    if (!entry.isIntersecting) stopSample();
  },
  { threshold: 0 },
);
heroObserver.observe($("top"));

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
  syncMotion();
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


function syncMotion() {
  const paused = (userPausedScene ?? reduced.matches) || menuOpen || document.hidden;
  scene?.setPaused(paused);
  artworks.forEach(art => art.setPaused(paused));
  if (menuOpen) stopSample();
}
let scrollFrame=0, progress=0, lastScroll=0;
const ribbon=$('ribbonPath'), ribbonLength=ribbon.getTotalLength();
ribbon.style.strokeDasharray=String(ribbonLength);
function scrollTick(now) {
  scrollFrame=0;
  if (document.hidden) { lastScroll=0; return; }
  $('header').classList.toggle('is-scrolled', scrollY > 80);
  const dt=lastScroll ? Math.min(.05,(now-lastScroll)/1000) : .016; lastScroll=now;
  const bounds=$('artHold').getBoundingClientRect();
  const target=reduced.matches || compact.matches ? 1 : Math.max(0,Math.min(1,(innerHeight*.95-bounds.top)/(innerHeight*.8)));
  progress=reduced.matches ? target : damp(progress,target,12,dt);
  const p=Math.abs(progress-target)<.001 ? target : progress;
  document.querySelector('.art-score').style.transform=reduced.matches || compact.matches ? 'none' : `translate3d(0,${24*(1-p)}px,0) scale(${.94+.06*p})`;
  const section=$('reel').getBoundingClientRect();
  const rp=Math.max(0,Math.min(1,(innerHeight-section.top)/(section.height*.82)));
  ribbon.style.strokeDashoffset=String((1-(reduced.matches ? 1 : rp))*ribbonLength);
  if (Math.abs(progress-target)>.001) requestScroll();
}
function requestScroll() { if (!scrollFrame && !document.hidden) scrollFrame=requestAnimationFrame(scrollTick); }
window.addEventListener('scroll',requestScroll,{passive:true});
window.addEventListener('resize',requestScroll,{passive:true});
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
  artworks.forEach(art => art.setLanguage(language));
  $('installCard').hidden=local;
  $('localInstallHint').hidden=!local;
  document.querySelector('.source-link').hidden=!local;
  if (!$("sampleError").hidden) $("sampleError").textContent = t("sampleError");
  showPlatform(platform);
  paintSample();
  paintMotion();
  syncMotion();
  requestScroll();
}
$("language").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  try {
    localStorage.setItem("ard-tour-language", language);
  } catch {}
  translate();
});

const modeChange = () => { userPausedScene = null; syncMotion(); paintMotion(); requestScroll(); };
reduced.addEventListener('change',modeChange);
compact.addEventListener('change',requestScroll);
document.addEventListener('visibilitychange',()=>{
  if (document.hidden) { stopSample(); cancelAnimationFrame(scrollFrame); scrollFrame=0; lastScroll=0; }
  else requestScroll();
  syncMotion();
});
window.addEventListener('pagehide',(event)=>{
  if (event.persisted) return;
  stopSample(); scene?.dispose(); artworks.forEach(art=>art.dispose());
  cancelAnimationFrame(scrollFrame); heroObserver.disconnect(); reveals.disconnect();
  audio?.close().catch(()=>{});
});
window.addEventListener('pageshow',event=>{ if (event.persisted) { syncMotion(); requestScroll(); } });
translate(); requestScroll();
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
