import { copy } from "./tour-copy.js";
import { shouldPlay, activeClip, mediaPath } from "./playback-policy.js";
import { animateStyle as animate } from "../motion-vendor.js";

const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
  saveData = navigator.connection?.saveData === true;
let language = navigator.language.startsWith("zh") ? "zh" : "en";
try {
  language = localStorage.getItem("ard-tour-language") || language;
} catch {}
if (!copy[language]) language = "en";
const entries = [...document.querySelectorAll("video[data-clip]")].map(
  (video) => ({
    id: video.dataset.clip,
    video,
    ratio: 0,
    choice: "auto",
    loaded: false,
    rejected: false,
    failed: false,
    button: document.querySelector(`[data-for="${video.dataset.clip}"]`),
  }),
);

function label(entry) {
  const playing = !entry.video.paused;
  entry.button.textContent =
    copy[language][entry.failed ? "videoError" : playing ? "pause" : "play"];
  entry.button.setAttribute("aria-pressed", String(playing));
  entry.button.disabled = entry.failed;
}

function load(entry) {
  if (entry.loaded) return;
  entry.video.src = mediaPath(entry.id, language);
  entry.video.load();
  entry.loaded = true;
}

function sync() {
  const active = activeClip(entries);
  for (const entry of entries) {
    const play =
      !entry.failed &&
      !entry.rejected &&
      shouldPlay({
        visible: active === entry.id,
        pageVisible: !document.hidden,
        reducedMotion: reduced.matches,
        saveData,
        choice: entry.choice,
      });
    if (play) {
      load(entry);
      if (entry.video.paused)
        entry.video.play().catch((error) => {
          if (error.name === "NotAllowedError") entry.rejected = true;
          label(entry);
        });
    } else entry.video.pause();
    label(entry);
  }
}

function translate() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.title = copy[language].title;
  document.querySelector('meta[name="description"]').content =
    copy[language].heroIntro;
  for (const element of document.querySelectorAll("[data-copy]"))
    element.textContent = copy[language][element.dataset.copy];
  for (const element of document.querySelectorAll("[data-label]"))
    element.setAttribute("aria-label", copy[language][element.dataset.label]);
  const button = document.querySelector("#language");
  button.textContent = language === "zh" ? "English" : "中文";
  button.setAttribute(
    "aria-label",
    language === "zh" ? "Switch to English" : "切换到中文",
  );
  for (const entry of entries) {
    entry.video.pause();
    entry.video.removeAttribute("src");
    entry.video.poster = mediaPath(entry.id, language, "webp");
    entry.video.load();
    entry.loaded = false;
    entry.failed = false;
    entry.rejected = false;
    label(entry);
  }
  sync();
}

for (const entry of entries) {
  entry.button.addEventListener("click", () => {
    const requestingPlay = entry.video.paused;
    // Transfer focus to a newly requested recording without reviving another paused recording.
    if (requestingPlay)
      for (const other of entries)
        if (other !== entry && other.choice === "play") other.choice = "auto";
    entry.choice = requestingPlay ? "play" : "pause";
    entry.rejected = false;
    sync();
  });
  for (const event of ["play", "pause", "loadeddata"])
    entry.video.addEventListener(event, () => label(entry));
  entry.video.addEventListener("error", () => {
    if (entry.loaded) {
      entry.failed = true;
      label(entry);
    }
  });
}

const visibility = new IntersectionObserver(
  (changes) => {
    for (const change of changes)
      entries.find((entry) => entry.video === change.target).ratio =
        change.intersectionRatio;
    sync();
  },
  { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
);
for (const entry of entries) visibility.observe(entry.video);
document.addEventListener("visibilitychange", sync);
reduced.addEventListener("change", sync);
document.querySelector("#language").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  try {
    localStorage.setItem("ard-tour-language", language);
  } catch {}
  translate();
});

if (["127.0.0.1", "localhost"].includes(location.hostname)) {
  document.querySelector("[data-local]").hidden = false;
  document.querySelector("[data-download]").hidden = true;
}
document.addEventListener(
  "keydown",
  () => (document.documentElement.dataset.keyboard = "true"),
  { capture: true },
);
document.addEventListener(
  "pointerdown",
  () => delete document.documentElement.dataset.keyboard,
  { capture: true, passive: true },
);

const reveal = new IntersectionObserver(
  (changes) => {
    for (const change of changes)
      if (change.isIntersecting) {
        reveal.unobserve(change.target);
        if (!reduced.matches && !document.documentElement.dataset.keyboard)
          animate(
            change.target,
            {
              opacity: [0, 1],
              transform: ["translateY(18px)", "translateY(0px)"],
            },
            { duration: 0.65, ease: [0.22, 1, 0.36, 1] },
          );
      }
  },
  { threshold: 0.13 },
);
for (const element of document.querySelectorAll("[data-reveal]"))
  reveal.observe(element);
translate();
