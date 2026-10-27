import { copy } from "./tour-copy.js?v=0.8.1";
import { filmDurations } from "./media-info.js?v=0.8.1";
import {
  shouldPlay,
  activeClip,
  mediaPath,
  clampFilmTime,
  installCommands,
} from "./playback-policy.js";
import { animateStyle as animate } from "../motion-vendor.js";
const $ = (id) => document.getElementById(id);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const saveData = navigator.connection?.saveData === true;
let language = navigator.language.startsWith("zh") ? "zh" : "en";
try {
  language = localStorage.getItem("ard-tour-language") || language;
} catch {}
if (!copy[language]) language = "en";
let platform = "windows",
  frame = 0,
  cinemaEntry = null,
  cinemaTrigger = null;
const cinema = $("cinemaDialog"),
  cinemaVideo = $("cinemaVideo");
const entries = [...document.querySelectorAll("video[data-clip]")].map(
  (video) => ({
    id: video.dataset.clip,
    video,
    ratio: 0,
    choice: video.hasAttribute("data-manual") ? "pause" : "auto",
    loaded: false,
    failed: false,
    rejected: false,
    completed: false,
    seeking: false,
    resume: false,
    button: document.querySelector(`[data-for="${video.dataset.clip}"]`),
    seek: document.querySelector(`[data-seek="${video.dataset.clip}"]`),
    time: document.querySelector(`[data-time="${video.dataset.clip}"]`),
  }),
);
const t = (key) => copy[language][key];
const clock = (seconds) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(
    Math.max(0, seconds) % 60,
  )
    .toString()
    .padStart(2, "0")}`;
function paint(entry) {
  const { video, button, seek, time } = entry;
  button.textContent = t(
    entry.failed
      ? "videoError"
      : !video.paused
        ? "pause"
        : entry.completed
          ? "replay"
          : "play",
  );
  button.setAttribute("aria-pressed", String(!video.paused));
  button.setAttribute("aria-label", button.textContent);
  const loadedDuration = Number.isFinite(video.duration) ? video.duration : 0;
  const duration = loadedDuration || filmDurations[entry.id][language];
  seek.disabled = !loadedDuration || entry.failed;
  seek.max = String(duration || 1);
  if (!entry.seeking)
    seek.value = String(clampFilmTime(video.currentTime, duration));
  seek.setAttribute(
    "aria-valuetext",
    `${clock(video.currentTime || 0)} / ${clock(duration)}`,
  );
  time.textContent = `${clock(video.currentTime || 0)} / ${clock(duration)}`;
}
function paintPlayback() {
  cancelAnimationFrame(frame);
  frame = 0;
  for (const entry of entries) paint(entry);
  if (!document.hidden && entries.some((entry) => !entry.video.paused))
    frame = requestAnimationFrame(paintPlayback);
}
function load(entry) {
  if (entry.loaded) return;
  entry.loaded = true;
  entry.failed = false;
  entry.video.src = `${mediaPath(entry.id, language)}?v=0.8.1`;
  entry.video.load();
}
function sync() {
  const active = activeClip(entries);
  for (const entry of entries) {
    const play =
      !entry.failed &&
      !entry.rejected &&
      !entry.seeking &&
      shouldPlay({
        visible: entry.id === active,
        pageVisible: !document.hidden,
        reducedMotion: reduced.matches,
        saveData,
        choice: entry.choice,
        completed: entry.completed,
        modalOpen: cinema.open,
      });
    if (play) {
      load(entry);
      if (entry.video.paused)
        entry.video.play().catch((error) => {
          if (error.name === "NotAllowedError") entry.rejected = true;
          paint(entry);
        });
    } else entry.video.pause();
    paint(entry);
  }
}
function requestPlay(entry) {
  if (entry.failed) {
    entry.loaded = false;
    entry.failed = false;
  }
  if (entry.completed || entry.video.ended) {
    entry.video.currentTime = 0;
    entry.completed = false;
  }
  for (const other of entries)
    if (other !== entry && other.choice === "play") other.choice = "auto";
  entry.choice = "play";
  entry.rejected = false;
  sync();
}
function startSeek(entry) {
  if (entry.seeking) return;
  entry.resume = !entry.video.paused;
  entry.seeking = true;
  entry.video.pause();
}
function finishSeek(entry) {
  if (!entry.seeking) return;
  entry.seeking = false;
  entry.completed = false;
  entry.choice = entry.resume ? "play" : "pause";
  sync();
}
for (const entry of entries) {
  entry.button.addEventListener("click", () => {
    if (!entry.video.paused) {
      entry.choice = "pause";
      sync();
    } else requestPlay(entry);
  });
  for (const event of [
    "play",
    "pause",
    "loadedmetadata",
    "timeupdate",
    "seeked",
  ])
    entry.video.addEventListener(event, paintPlayback);
  entry.video.addEventListener("ended", () => {
    entry.completed = true;
    entry.choice = "auto";
    paintPlayback();
  });
  entry.video.addEventListener("error", () => {
    if (entry.loaded) {
      entry.failed = true;
      paint(entry);
    }
  });
  entry.seek.addEventListener("pointerdown", () => startSeek(entry));
  entry.seek.addEventListener("input", () => {
    entry.video.currentTime = clampFilmTime(
      Number(entry.seek.value),
      entry.video.duration,
    );
    entry.completed = false;
    paint(entry);
  });
  for (const event of ["change", "pointerup", "pointercancel", "blur"])
    entry.seek.addEventListener(event, () => finishSeek(entry));
  entry.seek.addEventListener("keydown", (event) => {
    if (
      ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(
        event.key,
      )
    )
      startSeek(entry);
  });
  entry.seek.addEventListener("keyup", () => finishSeek(entry));
  document
    .querySelector(`[data-expand="${entry.id}"]`)
    .addEventListener("click", (event) => {
      cinemaEntry = entry;
      cinemaTrigger = event.currentTarget;
      load(entry);
      const time =
        entry.completed || entry.video.ended ? 0 : entry.video.currentTime || 0;
      $("cinemaError").hidden = true;
      cinemaVideo.poster = `${mediaPath(entry.id, language, "webp")}?v=0.8.1`;
      cinemaVideo.onloadedmetadata = () => {
        cinemaVideo.currentTime = clampFilmTime(time, cinemaVideo.duration);
      };
      cinemaVideo.src = `${mediaPath(entry.id, language)}?v=0.8.1`;
      cinemaVideo.load();
      cinema.showModal();
      sync();
      if (!reduced.matches && event.detail > 0)
        animate(
          cinema,
          {
            opacity: [0, 1],
            transform: [
              "translateY(5px) scale(.99)",
              "translateY(0px) scale(1)",
            ],
          },
          { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
        );
      cinemaVideo.play().catch(() => {});
    });
}
$("closeCinema").addEventListener("click", () => cinema.close());
cinema.addEventListener("click", (event) => {
  if (event.target !== cinema) return;
  const r = cinema.getBoundingClientRect();
  if (
    event.clientX < r.left ||
    event.clientX > r.right ||
    event.clientY < r.top ||
    event.clientY > r.bottom
  )
    cinema.close();
});
cinema.addEventListener("close", () => {
  cinemaVideo.pause();
  if (cinemaEntry) {
    cinemaEntry.video.currentTime = clampFilmTime(
      cinemaVideo.currentTime,
      cinemaEntry.video.duration,
    );
    cinemaEntry.completed = cinemaVideo.ended;
    cinemaEntry.choice = "pause";
    paint(cinemaEntry);
  }
  cinemaVideo.removeAttribute("src");
  cinemaVideo.onloadedmetadata = null;
  cinemaVideo.load();
  cinemaEntry = null;
  sync();
  cinemaTrigger?.focus({ preventScroll: true });
});
cinemaVideo.addEventListener("error", () => {
  if (cinema.open) $("cinemaError").hidden = false;
});
function showPlatform(next) {
  platform = next;
  for (const tab of document.querySelectorAll("[data-platform]")) {
    const active = tab.dataset.platform === platform;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  $("installInstructions").setAttribute(
    "aria-labelledby",
    `platform-${platform}`,
  );
  $("installHint").textContent = t(
    platform === "windows" ? "installWindows" : "installUnix",
  );
  $("installCode").textContent = installCommands(platform);
  $("installCode").parentElement.hidden = platform === "windows";
  $("copyInstall").hidden = platform === "windows";
  $("copyStatus").textContent = "";
}
for (const tab of document.querySelectorAll("[data-platform]")) {
  tab.addEventListener("click", () => showPlatform(tab.dataset.platform));
  tab.addEventListener("keydown", (event) => {
    const all = [...document.querySelectorAll("[data-platform]")],
      index = all.indexOf(tab);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? all.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % all.length
            : event.key === "ArrowLeft"
              ? (index + all.length - 1) % all.length
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
  document.title = t("title");
  document.querySelector('meta[name="description"]').content = t("heroIntro");
  for (const element of document.querySelectorAll("[data-copy]"))
    element.textContent = t(element.dataset.copy);
  for (const element of document.querySelectorAll("[data-label]"))
    element.setAttribute("aria-label", t(element.dataset.label));
  $("language").textContent = language === "zh" ? "English" : "中文";
  $("language").setAttribute(
    "aria-label",
    language === "zh" ? "Switch to English" : "切换到中文",
  );
  for (const entry of entries) {
    entry.video.pause();
    entry.loaded = false;
    entry.failed = false;
    entry.completed = false;
    entry.rejected = false;
    entry.seeking = false;
    entry.resume = false;
    entry.video.removeAttribute("src");
    entry.video.poster = `${mediaPath(entry.id, language, "webp")}?v=0.8.1`;
    entry.video.load();
    paint(entry);
  }
  showPlatform(platform);
  sync();
}
$("language").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  try {
    localStorage.setItem("ard-tour-language", language);
  } catch {}
  translate();
});
const observer = new IntersectionObserver(
  (changes) => {
    for (const change of changes)
      entries.find((entry) => entry.video === change.target).ratio =
        change.intersectionRatio;
    sync();
  },
  { threshold: [0, 0.05, 0.2, 0.4, 0.6, 0.8, 1] },
);
for (const entry of entries) observer.observe(entry.video);
reduced.addEventListener("change", sync);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cinemaVideo.pause();
  sync();
  paintPlayback();
});
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
if (["127.0.0.1", "localhost"].includes(location.hostname)) {
  document.querySelector("[data-local]").hidden = false;
  document.querySelector("[data-download]").hidden = true;
}
translate();

for (const button of document.querySelectorAll("[data-recording-tab]")) {
  const choose = () => {
    for (const tab of document.querySelectorAll("[data-recording-tab]")) {
      const active = tab === button;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    for (const panel of document.querySelectorAll("[data-recording]"))
      panel.hidden = panel.dataset.recording !== button.dataset.recordingTab;
    for (const entry of entries) {
      entry.video.pause();
      entry.choice = "pause";
      paint(entry);
    }
  };
  button.addEventListener("click", choose);
  button.addEventListener("keydown", (event) => {
    const all = [...document.querySelectorAll("[data-recording-tab]")],
      index = all.indexOf(button);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % all.length
        : event.key === "ArrowLeft"
          ? (index + all.length - 1) % all.length
          : null;
    if (next !== null) {
      event.preventDefault();
      all[next].click();
      all[next].focus();
    }
  });
}
