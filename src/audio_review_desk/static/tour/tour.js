import { copy } from "./tour-copy.js?v=0.10.0";
import { installCommands, mediaPath } from "./playback-policy.js";
import { sampleSignal, sampleDuration } from "./studio-signal.js";
import { filmDurations } from "./media-info.js";
import { mountScore } from "./score-scene.js?v=0.10.0";
import { mountStory } from "./story-demo.js?v=0.10.0";

import { playbackTime, rebaseLoop } from "./sample-playback.js?v=0.10.0";

const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion:reduce)");
const staticMotion =
  ["off"].includes(new URLSearchParams(location.search).get("motion")) ||
  new URLSearchParams(location.search).get("graphics") === "off";
const local = ["127.0.0.1", "localhost"].includes(location.hostname);
let language = navigator.language.startsWith("zh") ? "zh" : "en";
try {
  language = localStorage.getItem("ard-tour-language") || language;
} catch {}
if (!copy[language]) language = "en";
const t = (key) => copy[language][key];
const cinema = $("cinemaDialog"),
  cinemaVideo = $("cinemaVideo"),
  menu = $("siteMenu"),
  scrim = $("menuScrim");
let userPaused = staticMotion ? true : null,
  menuOpen = false,
  menuGeneration = 0,
  menuEffects = [],
  platform = "windows",
  storyMode = "compare",
  storyVariant = "a";
const scene = mountScore($("heroScene"));
const story = mountStory($("storyHost"));
let audio = null,
  sound = null,
  analyser = null,
  audioBins = null,
  audioFrame = 0,
  audioGeneration = 0;
const buffers = new Map();
const tones = new Set();
let toneGeneration = 0;
const playback = {
  owner: null,
  pending: false,
  playing: false,
  position: 0,
  offset: 0,
  started: 0,
  variant: "a",
  loop: false,
  start: 0,
  end: sampleDuration,
};
const view = { hero: true, story: false };
const timeLabel = (time) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

function clock() {
  return playbackTime(playback, audio ? audio.currentTime : 0, sampleDuration);
}
function isOnscreen(owner) {
  const bounds = $(
    owner === "hero" ? "top" : "details",
  ).getBoundingClientRect();
  return bounds.bottom > 0 && bounds.top < innerHeight;
}
function paintAudio() {
  for (const [id, owner, label, keyOn, keyOff] of [
    ["samplePlay", "hero", "[data-sample-label]", "stopListening", "listen"],
    ["storyPlay", "story", "[data-story-play]", "examplePause", "examplePlay"],
  ]) {
    const active =
      playback.owner === owner && (playback.playing || playback.pending);
    $(id).setAttribute("aria-pressed", String(active));
    $(id).setAttribute("aria-label", t(active ? keyOn : keyOff));
    document.querySelector(label).textContent = t(active ? keyOn : keyOff);
  }
  $("storyClock").textContent = `${timeLabel(playback.position)} / 0:12`;
  story.setPlayback({
    time: playback.position,
    playing: playback.playing && playback.owner === "story",
    variant: storyVariant,
  });
}
function stopAudio() {
  stopTones();
  if (playback.owner === "story") playback.position = clock();
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
  playback.playing = false;
  playback.pending = false;
  playback.owner = null;
  scene.setAudioLevel(0);
  paintAudio();
}
async function context() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw Error("audio");
  audio ||= new Context();
  await audio.resume();
  return audio;
}
function buffer(variant) {
  if (!buffers.has(variant)) {
    const data = sampleSignal(22050, variant),
      result = audio.createBuffer(1, data.length, 22050);
    result.copyToChannel(data, 0);
    buffers.set(variant, result);
  }
  return buffers.get(variant);
}
async function startAudio(
  owner,
  { position = owner === "story" ? playback.position : 0 } = {},
) {
  const nextPosition = position;
  stopAudio();
  const generation = ++audioGeneration;
  playback.owner = owner;
  playback.pending = true;
  paintAudio();
  try {
    await context();
    if (generation !== audioGeneration) return;
    if (document.hidden || cinema.open || menuOpen || !isOnscreen(owner)) {
      stopAudio();
      return;
    }
    const variant = owner === "story" ? storyVariant : "a";
    let offset = Math.max(0, Math.min(sampleDuration, nextPosition));
    playback.loop =
      owner === "story" && storyMode === "range" && $("storyLoop").checked;
    const selection = story.range;
    playback.start = selection.start;
    playback.end = selection.end;
    if (playback.loop)
      offset = Math.max(
        selection.start,
        Math.min(selection.end - 0.01, offset),
      );
    else if (offset >= sampleDuration - 0.01) offset = 0;
    sound = audio.createBufferSource();
    sound.buffer = buffer(variant);
    sound.loop = playback.loop;
    if (playback.loop) {
      sound.loopStart = selection.start;
      sound.loopEnd = selection.end;
    }
    analyser ||= audio.createAnalyser();
    analyser.fftSize = 256;
    audioBins ||= new Float32Array(256);
    sound.connect(analyser);
    analyser.disconnect();
    analyser.connect(audio.destination);
    playback.variant = variant;
    playback.offset = offset;
    playback.started = audio.currentTime;
    if (owner === "story") playback.position = offset;
    playback.pending = false;
    playback.playing = true;
    sound.onended = () => {
      if (generation !== audioGeneration) return;
      stopAudio();
      if (owner === "story") playback.position = sampleDuration;
      paintAudio();
    };
    sound.start(0, offset);
    $("sampleError").hidden = true;
    $("storyError").hidden = true;
    paintAudio();
    const tick = () => {
      if (!playback.playing || generation !== audioGeneration) return;
      analyser.getFloatTimeDomainData(audioBins);
      let energy = 0;
      for (const n of audioBins) energy += n * n;
      if (owner === "hero")
        scene.setAudioLevel(Math.sqrt(energy / audioBins.length) * 5);
      if (owner === "story") {
        playback.position = clock();
        $("storyClock").textContent = `${timeLabel(playback.position)} / 0:12`;
        story.setPlayback({
          time: playback.position,
          playing: true,
          variant: storyVariant,
        });
      }
      audioFrame = requestAnimationFrame(tick);
    };
    audioFrame = requestAnimationFrame(tick);
  } catch {
    if (generation !== audioGeneration) return;
    stopAudio();
    const failure = $(owner === "story" ? "storyError" : "sampleError");
    failure.textContent = t("sampleError");
    failure.hidden = false;
  }
}
function toggleAudio(owner) {
  if (playback.owner === owner && (playback.playing || playback.pending))
    stopAudio();
  else startAudio(owner);
}
$("samplePlay").addEventListener("click", () => toggleAudio("hero"));
$("storyPlay").addEventListener("click", () => toggleAudio("story"));
async function pluck(frequency = 261.626, velocity = 0.6) {
  const generation = toneGeneration;
  try {
    await context();
    if (
      generation !== toneGeneration ||
      document.hidden ||
      cinema.open ||
      menuOpen ||
      !view.hero
    )
      return;
    if (!Number.isFinite(frequency) || frequency < 20 || frequency > 4000)
      return;
    const now = audio.currentTime,
      gain = audio.createGain(),
      osc = audio.createOscillator(),
      harmonic = audio.createOscillator(),
      partial = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    harmonic.type = "sine";
    harmonic.frequency.value = frequency * 2.001;
    partial.gain.value = 0.14;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(
      0.075 * Math.max(0.15, Math.min(1, velocity)),
      now + 0.008,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(gain);
    harmonic.connect(partial);
    partial.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    harmonic.start(now);
    osc.stop(now + 0.72);
    harmonic.stop(now + 0.72);
    const voice = {
      stop() {
        gain.gain.cancelScheduledValues(audio.currentTime);
        gain.gain.setTargetAtTime(0.0001, audio.currentTime, 0.008);
        try {
          osc.stop(audio.currentTime + 0.04);
          harmonic.stop(audio.currentTime + 0.04);
        } catch {}
      },
    };
    if (tones.size >= 12) {
      const first = tones.values().next().value;
      first.stop();
      tones.delete(first);
    }
    tones.add(voice);
    osc.onended = () => {
      tones.delete(voice);
      osc.disconnect();
      harmonic.disconnect();
      partial.disconnect();
      gain.disconnect();
    };
  } catch {
    $("sampleError").textContent = t("sampleError");
    $("sampleError").hidden = false;
  }
}
function stopTones() {
  toneGeneration++;
  for (const voice of tones) voice.stop();
  tones.clear();
}
$("heroScene").addEventListener("scorepluck", (event) =>
  pluck(event.detail.frequency, event.detail.velocity),
);
$("pluckScore").addEventListener("click", () => {
  scene.burst();
  [261.626, 329.628, 391.995].forEach((f) => pluck(f, 0.4));
});

function motionPaused() {
  return userPaused ?? reduced.matches;
}
function paintMotion() {
  const paused = motionPaused();
  $("motionToggle").setAttribute("aria-pressed", String(paused));
  $("motionToggle").setAttribute(
    "aria-label",
    t(paused ? "motionPlay" : "motionPause"),
  );
  $("motionLabel").textContent = t(paused ? "motionPlay" : "motionPause");
  $("motionToggle").disabled = !scene.ready;
}
function syncMotion() {
  const paused = motionPaused() || menuOpen || cinema.open;
  scene.setPaused(paused);
  story.setPaused(paused);
  paintMotion();
}
$("motionToggle").addEventListener("click", () => {
  userPaused = !motionPaused();
  syncMotion();
});
$("heroScene").addEventListener("motionchange", () => {
  $("heroScene").dataset.ready = String(scene.ready);
  paintMotion();
});
$("heroScene").dataset.ready = String(scene.ready);
reduced.addEventListener("change", syncMotion);
const audioView = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const owner = entry.target.id === "top" ? "hero" : "story";
      view[owner] = entry.isIntersecting;
      if (!entry.isIntersecting && owner === "hero") stopTones();
      if (!entry.isIntersecting && playback.owner === owner) stopAudio();
    }
  },
  { threshold: 0 },
);
audioView.observe($("top"));
audioView.observe($("details"));

const tabKeys = (event, elements, current, select) => {
  let index = elements.indexOf(current),
    next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? elements.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % elements.length
            : event.key === "ArrowLeft"
              ? (index + elements.length - 1) % elements.length
              : null;
  if (next !== null) {
    event.preventDefault();
    select(elements[next]);
    elements[next].focus();
  }
};
function setStoryMode(next) {
  const resume = playback.playing && playback.owner === "story",
    position = clock();
  storyMode = next;
  story.setMode(next);
  for (const button of document.querySelectorAll("[data-story]")) {
    const active = button.dataset.story === next;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  $("storyHost").setAttribute("aria-labelledby", `story-${next}`);
  $("loopControl").hidden = next !== "range";
  $("storyCaption").textContent = t(
    next === "compare"
      ? "captionCompare"
      : next === "range"
        ? "captionRange"
        : "captionNotes",
  );
  if (resume) startAudio("story", { position });
}
for (const button of document.querySelectorAll("[data-story]")) {
  button.addEventListener("click", () => setStoryMode(button.dataset.story));
  button.addEventListener("keydown", (event) =>
    tabKeys(
      event,
      [...document.querySelectorAll("[data-story]")],
      button,
      (item) => setStoryMode(item.dataset.story),
    ),
  );
}
$("storyHost").addEventListener("storyvariantchange", (event) => {
  const position = clock(),
    resume = playback.playing && playback.owner === "story";
  storyVariant = event.detail.variant;
  story.setPlayback({
    time: playback.position,
    playing: resume,
    variant: storyVariant,
  });
  if (resume) startAudio("story", { position });
});
$("storyHost").addEventListener("storyseek", (event) => {
  const resume =
    (playback.playing || playback.pending) && playback.owner === "story";
  playback.position = event.detail.time;
  if (resume) startAudio("story", { position: event.detail.time });
  else paintAudio();
});
$("storyHost").addEventListener("storyrangechange", () => {
  if (playback.playing && playback.owner === "story" && playback.loop) {
    const range = story.range,
      time = clock();
    if (time < range.start || time >= range.end)
      startAudio("story", { position: range.start });
    else {
      Object.assign(
        playback,
        rebaseLoop(playback, range, audio.currentTime, sampleDuration),
      );
      sound.loopStart = range.start;
      sound.loopEnd = range.end;
    }
  }
});
$("storyLoop").addEventListener("change", () => {
  if (playback.playing && playback.owner === "story")
    startAudio("story", { position: clock() });
});

function animate(element, frames, options = {}) {
  if (reduced.matches) return null;
  return element.animate(frames, {
    duration: 220,
    easing: "cubic-bezier(.23,1,.32,1)",
    fill: "both",
    ...options,
  });
}
async function setMenu(open, { focus = true } = {}) {
  const generation = ++menuGeneration,
    card = menu.querySelector(".menu-card"),
    wasHidden = menu.hidden;
  const current = {
      opacity: getComputedStyle(card).opacity,
      transform: getComputedStyle(card).transform,
    },
    scrimOpacity = scrim.hidden ? "0" : getComputedStyle(scrim).opacity;
  menuEffects.forEach((effect) => effect?.cancel());
  menuEffects = [];
  menuOpen = open;
  $("menuToggle").setAttribute("aria-expanded", String(open));
  $("menuToggle").setAttribute("aria-label", t(open ? "close" : "menu"));
  $("menuLabel").textContent = t(open ? "close" : "menu");
  $("main").toggleAttribute("inert", open);
  if (open) {
    menu.hidden = false;
    menu.removeAttribute("inert");
    scrim.hidden = false;
    stopAudio();
    menuEffects.push(
      animate(card, [
        wasHidden
          ? { opacity: 0, transform: "translateY(-8px) scale(.98)" }
          : current,
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ]),
      animate(scrim, [{ opacity: scrimOpacity }, { opacity: 1 }]),
    );
  } else {
    menu.setAttribute("inert", "");
    if (focus) $("menuToggle").focus({ preventScroll: true });
    menuEffects.push(
      animate(
        card,
        [current, { opacity: 0, transform: "translateY(-8px) scale(.98)" }],
        { duration: 160 },
      ),
      animate(scrim, [{ opacity: scrimOpacity }, { opacity: 0 }], {
        duration: 160,
      }),
    );
    await Promise.all(
      menuEffects
        .filter(Boolean)
        .map((effect) => effect.finished.catch(() => {})),
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
    const controls = [$("menuToggle"), ...menu.querySelectorAll("a,button")],
      index = controls.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      controls.at(-1).focus();
    } else if (!event.shiftKey && index === controls.length - 1) {
      event.preventDefault();
      controls[0].focus();
    }
  }
});
document.querySelectorAll('a[href^="#"]').forEach((link) =>
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    if (menuOpen) setMenu(false, { focus: false });
    const destination = target.querySelector(".section-heading,h2") || target;
    destination.setAttribute("tabindex", "-1");
    destination.focus({ preventScroll: true });
    destination.scrollIntoView({
      behavior: reduced.matches ? "instant" : "smooth",
      block: "start",
    });
  }),
);

let filmTrigger = null,
  filmKind = null,
  filmGeneration = 0;
for (const button of document.querySelectorAll("[data-open-film]"))
  button.addEventListener("click", () => {
    filmTrigger = button;
    filmKind = button.dataset.openFilm;
    const generation = ++filmGeneration;
    stopAudio();
    if (menuOpen) setMenu(false, { focus: false });
    $("cinemaTitle").textContent = t(
      filmKind === "workflow"
        ? "workflowFilm"
        : filmKind === "notes"
          ? "notesFilm"
          : "rangeFilm",
    );
    $("cinemaError").hidden = true;
    cinemaVideo.poster = `${mediaPath(filmKind, language, "webp")}?v=0.10.0`;
    cinemaVideo.src = `${mediaPath(filmKind, language)}?v=0.10.0`;
    cinemaVideo.load();
    cinema.showModal();
    document.documentElement.style.overflow = "hidden";
    syncMotion();
    animate(cinema, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 200,
      fill: "none",
    });
    cinemaVideo.play().catch(() => {
      if (generation === filmGeneration && cinema.open)
        $("cinemaError").hidden = false;
    });
  });
$("closeCinema").addEventListener("click", () => cinema.close());
cinema.addEventListener("close", () => {
  filmGeneration++;
  cinemaVideo.pause();
  cinemaVideo.removeAttribute("src");
  cinemaVideo.load();
  document.documentElement.style.overflow = "";
  syncMotion();
  filmTrigger?.focus({ preventScroll: true });
});
cinemaVideo.addEventListener("error", () => {
  if (cinema.open) $("cinemaError").hidden = false;
});

function showPlatform(next) {
  platform = next;
  for (const button of document.querySelectorAll("[data-platform]")) {
    const active = button.dataset.platform === next;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
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
for (const button of document.querySelectorAll("[data-platform]")) {
  button.addEventListener("click", () => showPlatform(button.dataset.platform));
  button.addEventListener("keydown", (event) =>
    tabKeys(
      event,
      [...document.querySelectorAll("[data-platform]")],
      button,
      (item) => showPlatform(item.dataset.platform),
    ),
  );
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
  document.querySelector("meta[name=description]").content = t("intro");
  document
    .querySelectorAll("[data-copy]")
    .forEach((element) => (element.textContent = t(element.dataset.copy)));
  document
    .querySelectorAll("[data-label]")
    .forEach((element) =>
      element.setAttribute("aria-label", t(element.dataset.label)),
    );
  $("language").textContent = language === "zh" ? "English" : "中文";
  $("language").setAttribute(
    "aria-label",
    language === "zh" ? "Switch to English" : "切换到中文",
  );
  menu.setAttribute("aria-label", language === "zh" ? "导航" : "Navigation");
  $("menuLabel").textContent = t(menuOpen ? "close" : "menu");
  $("menuToggle").setAttribute("aria-label", t(menuOpen ? "close" : "menu"));
  for (const link of document.querySelectorAll("[data-primary]")) {
    link.href = local
      ? "/"
      : "https://github.com/FUN-ACTION/audio-review-desk/releases/latest";
    if (local) link.querySelector("[data-copy]").textContent = t("open");
  }
  $("installCard").hidden = local;
  $("localInstallHint").hidden = !local;
  document.querySelector(".source-link").hidden = !local;
  document
    .querySelectorAll("[data-duration]")
    .forEach(
      (element) =>
        (element.textContent = timeLabel(
          filmDurations[element.dataset.duration][language],
        )),
    );
  story.setLanguage(language);
  setStoryMode(storyMode);
  showPlatform(platform);
  paintMotion();
  paintAudio();
  if (!$("sampleError").hidden) $("sampleError").textContent = t("sampleError");
}
$("language").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  try {
    localStorage.setItem("ard-tour-language", language);
  } catch {}
  translate();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAudio();
    cinemaVideo.pause();
  }
  syncMotion();
});
const reveals = new IntersectionObserver(
  (changes) => {
    for (const entry of changes) {
      if (!entry.isIntersecting) continue;
      reveals.unobserve(entry.target);
      animate(
        entry.target,
        [
          { opacity: 0, transform: "translateY(14px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 400, fill: "none" },
      );
    }
  },
  { threshold: 0.15 },
);
document
  .querySelectorAll(".section-heading,.film-list,.download-section")
  .forEach((element) => reveals.observe(element));
translate();
syncMotion();
