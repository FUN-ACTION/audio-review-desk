import {
  sampleSignal,
  signalPeaks,
  sampleDuration,
  clampSampleTime,
  moveSampleEdge,
} from "./studio-signal.js?v=0.8.0";

const words = {
  zh: {
    sample: "试听示例",
    meta: "12 秒 · 钢琴片段",
    tag: "示例片段",
    play: "试听这个片段",
    pause: "暂停试听",
    a: "原音频",
    b: "参考版本",
    loop: "循环选中区间",
    range: "选中区间",
    note: "添加批注",
    noteLabel: "批注内容",
    noteValue: "第一个乐句",
    noteTime: "时间批注",
    close: "收起批注",
    seek: "播放位置",
    start: "区间起点",
    end: "区间终点",
    motionPlay: "播放动画",
    motionPause: "暂停动画",
    chapters: ["版本对照", "区间试听", "时间批注"],
    hints: [
      "切换原音频与参考版本",
      "拖动两端，圈出试听区间",
      "在当前位置留下批注",
    ],
    error: "这个浏览器暂时无法播放示例。",
  },
  en: {
    sample: "Try a sample",
    meta: "12 seconds · Piano",
    tag: "Sample clip",
    play: "Listen to this clip",
    pause: "Pause audio",
    a: "Original",
    b: "Reference",
    loop: "Loop selection",
    range: "Selection",
    note: "Add a note",
    noteLabel: "Note text",
    noteValue: "First phrase",
    noteTime: "Time note",
    close: "Hide note",
    seek: "Playback position",
    start: "Selection start",
    end: "Selection end",
    motionPlay: "Play animation",
    motionPause: "Pause animation",
    chapters: ["Compare", "Select a range", "Add a note"],
    hints: [
      "Switch between original and reference",
      "Drag either edge to select a phrase",
      "Leave a note at the playhead",
    ],
    error: "Audio playback is unavailable in this browser.",
  },
};
const root = document.getElementById("studioRoot");
if (root) mount(root);

function mount(root) {
  root.innerHTML = `<div class="studio-stage"><div class="studio-top"><span data-studio="sample"></span><button type="button" class="motion-toggle"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h3v10H4zm5 0h3v10H9z"/></svg></button></div><div class="studio-workspace" id="sample-panel" role="tabpanel" aria-labelledby="sample-chapter-0"><div class="sample-card"><div class="sample-heading"><div><h3>piano_01.wav</h3><p data-studio="meta"></p></div><span class="sample-tag" data-studio="tag"></span></div><div class="sample-wave"><canvas aria-hidden="true"></canvas><div class="sample-selection"></div><input class="sample-seek" type="range" min="0" max="12" step="0.01" value="0"><button class="sample-edge" data-edge="start" type="button" role="slider" aria-orientation="horizontal"></button><button class="sample-edge" data-edge="end" type="button" role="slider" aria-orientation="horizontal"></button><div class="sample-playhead"></div><span class="sample-pin" hidden>0:04.200</span></div><div class="sample-ruler"><span>0:00</span><span>0:03</span><span>0:06</span><span>0:09</span><span>0:12</span></div><div class="sample-transport"><button class="sample-play" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 2 9 6-9 6z"/></svg></button><span class="sample-time"><strong><span class="sample-current">0:00</span><span class="sample-fraction">.000</span></strong> / 0:12</span><div class="sample-segment"><i class="sample-glider" aria-hidden="true"></i><button data-variant="a" type="button" aria-pressed="true" data-studio="a"></button><button data-variant="b" type="button" aria-pressed="false" data-studio="b"></button></div><button class="sample-loop" type="button" aria-pressed="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15 4H6a4 4 0 0 0-4 4v2m13-6-3-3m3 3-3 3M5 16h9a4 4 0 0 0 4-4v-2m-13 6 3 3m-3-3 3-3"/></svg></button></div><div class="sample-bottom"><span class="sample-range"><span data-studio="range"></span><strong>0:01.200 — 0:09.600</strong></span><button class="sample-annotation" type="button"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h12v10H9l-5 4zm3 4h6m-6 3h4"/></svg><span data-studio="note"></span></button></div></div><div class="sample-note"><div class="note-meta"><span class="note-position">0:04.200</span><span data-studio="noteTime"></span><button type="button" class="note-close">×</button></div><input maxlength="80" type="text"></div></div><div class="studio-chapters" role="tablist"><button role="tab" type="button" id="sample-chapter-0" aria-controls="sample-panel" data-chapter="0" aria-selected="true"></button><button role="tab" type="button" id="sample-chapter-1" aria-controls="sample-panel" data-chapter="1" aria-selected="false" tabindex="-1"></button><button role="tab" type="button" id="sample-chapter-2" aria-controls="sample-panel" data-chapter="2" aria-selected="false" tabindex="-1"></button></div><p class="studio-hint"></p><p class="sample-error" role="status" hidden></p></div>`;
  const $ = (s) => root.querySelector(s),
    $$ = (s) => [...root.querySelectorAll(s)];
  $(".sample-range").append($(".sample-loop"));
  const stage = $(".studio-stage"),
    wave = $(".sample-wave"),
    canvas = $("canvas"),
    ctx = canvas.getContext("2d");
  const seek = $(".sample-seek"),
    playButton = $(".sample-play"),
    note = $(".sample-note"),
    noteInput = $(".sample-note input"),
    motionButton = $(".motion-toggle");
  const signals = { a: sampleSignal(22050, "a"), b: sampleSignal(22050, "b") };
  const peaks = { a: signalPeaks(signals.a), b: signalPeaks(signals.b) };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let language = "zh",
    chapter = 0,
    variant = "a",
    start = 1.2,
    end = 9.6,
    position = 0,
    noteTime = 4.2,
    noteVisible = false,
    noteEdited = false,
    loop = false;
  let audio = null,
    source = null,
    audioStart = 0,
    audioOffset = 0,
    playing = false,
    raf = 0,
    width = 600,
    height = 188;
  let intro = false,
    introStart = 0,
    introOffset = 0,
    seen = false,
    drag = null,
    userPaused = false,
    playGeneration = 0,
    introComplete = false;
  const t = (key) => words[language][key];
  const format = (n) =>
    `${Math.floor(n / 60)}:${(n % 60).toFixed(3).padStart(6, "0")}`;
  let paintedControls = "",
    paintedWave = "",
    paintedChapter = "";
  function paint() {
    $(".sample-playhead").style.transform =
      `translateX(${(position / 12) * width}px)`;
    const timestamp = format(position).split(".");
    $(".sample-current").textContent = timestamp[0];
    $(".sample-fraction").textContent = "." + timestamp[1];
    seek.value = position;
    seek.setAttribute("aria-valuetext", format(position));
    const key = [
      variant,
      start,
      end,
      noteTime,
      noteVisible,
      playing,
      intro,
      loop,
      language,
    ].join("|");
    if (key === paintedControls) return;
    paintedControls = key;
    stage.dataset.variant = variant;
    $(".sample-selection").style.left = `${(start / 12) * 100}%`;
    $(".sample-selection").style.width = `${((end - start) / 12) * 100}%`;
    for (const edge of $$(".sample-edge")) {
      const isStart = edge.dataset.edge === "start",
        value = isStart ? start : end;
      edge.style.left = `${(value / 12) * 100}%`;
      edge.setAttribute("aria-valuemin", String(isStart ? 0 : start + 0.25));
      edge.setAttribute("aria-valuemax", String(isStart ? end - 0.25 : 12));
      edge.setAttribute("aria-valuenow", value.toFixed(3));
      edge.setAttribute("aria-valuetext", format(value));
    }
    $(".sample-range strong").textContent = `${format(start)} — ${format(end)}`;
    $(".sample-pin").style.left = `${(noteTime / 12) * 100}%`;
    $(".sample-pin").textContent = format(noteTime);
    $(".sample-pin").hidden = !noteVisible;
    $(".note-position").textContent = format(noteTime);
    note.classList.toggle("is-visible", noteVisible);
    note.toggleAttribute("inert", !noteVisible);
    noteInput.tabIndex = noteVisible ? 0 : -1;
    $(".note-close").tabIndex = noteVisible ? 0 : -1;
    note.setAttribute("aria-hidden", String(!noteVisible));
    playButton.setAttribute("aria-label", t(playing ? "pause" : "play"));
    playButton.setAttribute("aria-pressed", String(playing));
    playButton
      .querySelector("path")
      .setAttribute(
        "d",
        playing ? "M4 2h3v12H4zm6 0h3v12h-3z" : "m5 2 9 6-9 6z",
      );
    motionButton.setAttribute(
      "aria-label",
      t(intro ? "motionPause" : "motionPlay"),
    );
    motionButton.setAttribute("aria-pressed", String(intro));
    motionButton
      .querySelector("path")
      .setAttribute("d", intro ? "M4 3h3v10H4zm5 0h3v10H9z" : "m5 3 8 5-8 5z");
    for (const button of $$("[data-variant]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.variant === variant),
      );
    $(".sample-loop").setAttribute("aria-pressed", String(loop));
    const waveKey = [variant, start, end].join("|");
    if (waveKey !== paintedWave) {
      paintedWave = waveKey;
      draw();
    }
  }
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const values = peaks[variant],
      bar = width / values.length;
    for (let i = 0; i < values.length; i++) {
      const time = (i / values.length) * 12,
        amp = Math.max(3, Math.pow(values[i], 0.63) * height * 0.83);
      ctx.fillStyle =
        time >= start && time <= end
          ? variant === "a"
            ? "#4b5eea"
            : "#8065db"
          : "#cdd2e2";
      const x = i * bar,
        y = (height - amp) / 2,
        w = Math.max(1, bar * 0.57);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, amp, Math.min(w / 2, 2));
      else ctx.rect(x, y, w, amp);
      ctx.fill();
    }
  }
  function resize() {
    const r = wave.getBoundingClientRect();
    width = r.width;
    height = r.height;
    const d = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * d);
    canvas.height = Math.round(height * d);
    ctx?.setTransform(d, 0, 0, d, 0, 0);
    draw();
    paint();
  }
  function readTime() {
    if (!playing || !audio) return position;
    let value = audioOffset + (audio.currentTime - audioStart);
    if (loop && value >= end) value = start + ((value - start) % (end - start));
    return clampSampleTime(value);
  }
  function stopSource() {
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
      source = null;
    }
    playing = false;
  }
  function stopIntro() {
    playGeneration++;
    if (intro) {
      introOffset = performance.now() - introStart;
      intro = false;
    }
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function pause() {
    position = readTime();
    stopSource();
    stopIntro();
    paint();
  }
  function tick(now) {
    raf = 0;
    if (intro) {
      const elapsed = (now - introStart) / 1000;
      position = Math.min(8.6, elapsed * 1.1);
      if (elapsed < 2.6) {
        setChapter(0, false);
        variant = elapsed > 1.15 ? "b" : "a";
        start = 1.2;
        end = 9.6;
        noteVisible = false;
      } else if (elapsed < 5.2) {
        setChapter(1, false);
        variant = "a";
        const p = Math.min(1, (elapsed - 2.6) / 1.6);
        const ease = 1 - Math.pow(1 - p, 3);
        start = 1.2 + 1.4 * ease;
        end = 9.6 - 1.2 * ease;
        noteVisible = false;
      } else {
        setChapter(2, false);
        noteVisible = true;
        noteTime = 4.2;
      }
      if (elapsed >= 8) {
        intro = false;
        introOffset = 0;
        introComplete = true;
      }
    } else if (playing) position = readTime();
    paint();
    if (intro || playing) raf = requestAnimationFrame(tick);
  }
  function startIntro(manual = false) {
    pause();
    if (reduced.matches && !manual) return;
    intro = true;
    introStart = performance.now() - introOffset;
    raf = requestAnimationFrame(tick);
    paint();
  }
  async function play() {
    const hadIntro = intro;
    stopIntro();
    userPaused = true;
    if (playing) {
      pause();
      return;
    }
    if (hadIntro || introComplete || position >= 12) position = 0;
    introComplete = false;
    if (loop && (position < start || position >= end)) position = start;
    const request = ++playGeneration;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error("audio unavailable");
      audio ||= new Context();
      await audio.resume();
      if (request !== playGeneration || document.hidden) return;
      stopSource();
      const buffer = audio.createBuffer(1, signals[variant].length, 22050);
      buffer.copyToChannel(signals[variant], 0);
      source = audio.createBufferSource();
      source.buffer = buffer;
      source.connect(audio.destination);
      source.loop = loop;
      source.loopStart = start;
      source.loopEnd = end;
      audioStart = audio.currentTime;
      audioOffset = position;
      playing = true;
      source.onended = () => {
        playing = false;
        source = null;
        position = 12;
        paint();
      };
      source.start(0, position);
      $(".sample-error").hidden = true;
      paint();
      raf = requestAnimationFrame(tick);
    } catch {
      if (request !== playGeneration) return;
      $(".sample-error").textContent = t("error");
      $(".sample-error").hidden = false;
      playing = false;
      paint();
    }
  }
  function seekTo(value) {
    introComplete = false;
    const resume = playing;
    position = clampSampleTime(value);
    stopSource();
    stopIntro();
    userPaused = true;
    paint();
    if (resume) play();
  }
  function setChapter(index, manual = true) {
    chapter = index;
    const chapterKey = `${index}|${language}`;
    if (!manual && chapterKey === paintedChapter) return;
    paintedChapter = chapterKey;
    $(".studio-workspace").setAttribute(
      "aria-labelledby",
      `sample-chapter-${index}`,
    );
    for (const b of $$("[data-chapter]")) {
      const active = Number(b.dataset.chapter) === index;
      b.setAttribute("aria-selected", String(active));
      b.tabIndex = active ? 0 : -1;
    }
    $(".studio-hint").textContent = t("hints")[index];
    if (manual) {
      pause();
      userPaused = true;
      if (index === 0) {
        noteVisible = false;
      }
      if (index === 1) {
        noteVisible = false;
        loop = true;
      }
      if (index === 2) {
        noteVisible = true;
        noteTime = position;
      }
      paint();
    }
  }
  function translate() {
    language = document.documentElement.lang.startsWith("zh") ? "zh" : "en";
    for (const node of $$("[data-studio]"))
      node.textContent = t(node.dataset.studio);
    if (!noteEdited) noteInput.value = t("noteValue");
    noteInput.setAttribute("aria-label", t("noteLabel"));
    seek.setAttribute("aria-label", t("seek"));
    $(".sample-loop").setAttribute("aria-label", t("loop"));
    $(".sample-annotation").setAttribute("aria-label", t("note"));
    $(".note-close").setAttribute("aria-label", t("close"));
    for (const b of $$("[data-edge]"))
      b.setAttribute("aria-label", t(b.dataset.edge));
    for (const b of $$("[data-chapter]"))
      b.textContent = t("chapters")[Number(b.dataset.chapter)];
    $(".studio-chapters").setAttribute(
      "aria-label",
      language === "zh" ? "示例操作" : "Sample actions",
    );
    setChapter(chapter, false);
    paint();
  }
  playButton.addEventListener("click", play);
  motionButton.addEventListener("click", () => {
    if (intro || playing) {
      userPaused = true;
      pause();
    } else {
      introOffset = 0;
      userPaused = false;
      startIntro(true);
    }
  });
  seek.addEventListener("input", () => seekTo(Number(seek.value)));
  for (const b of $$("[data-variant]"))
    b.addEventListener("click", () => {
      const resume = playing;
      position = readTime();
      stopSource();
      stopIntro();
      userPaused = true;
      variant = b.dataset.variant;
      paint();
      if (resume) play();
    });
  $(".sample-loop").addEventListener("click", () => {
    const resume = playing;
    position = readTime();
    stopSource();
    stopIntro();
    userPaused = true;
    loop = !loop;
    paint();
    if (resume) play();
  });
  $(".sample-annotation").addEventListener("click", () => {
    position = readTime();
    stopIntro();
    userPaused = true;
    noteTime = position;
    noteVisible = true;
    setChapter(2, false);
    paint();
    noteInput.focus();
    if (playing) raf = requestAnimationFrame(tick);
  });
  $(".note-close").addEventListener("click", () => {
    noteVisible = false;
    paint();
    $(".sample-annotation").focus();
  });
  noteInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      noteVisible = false;
      paint();
      $(".sample-annotation").focus();
    }
  });
  noteInput.addEventListener("input", () => {
    noteEdited = true;
  });
  for (const b of $$("[data-chapter]")) {
    b.addEventListener("click", () => setChapter(Number(b.dataset.chapter)));
    b.addEventListener("keydown", (event) => {
      const index = Number(b.dataset.chapter);
      const next =
        event.key === "ArrowRight"
          ? (index + 1) % 3
          : event.key === "ArrowLeft"
            ? (index + 2) % 3
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? 2
                : null;
      if (next !== null) {
        event.preventDefault();
        setChapter(next);
        $$("[data-chapter]")[next].focus();
      }
    });
  }
  for (const b of $$("[data-edge]")) {
    b.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      pause();
      userPaused = true;
      const rect = wave.getBoundingClientRect(),
        value = b.dataset.edge === "start" ? start : end;
      drag = {
        edge: b.dataset.edge,
        left: rect.left,
        width: rect.width,
        offset: event.clientX - rect.left - (value / 12) * rect.width,
      };
      b.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    b.addEventListener("pointermove", (event) => {
      if (!drag) return;
      [start, end] = moveSampleEdge(
        start,
        end,
        drag.edge,
        ((event.clientX - drag.left - drag.offset) / drag.width) * 12,
      );
      setChapter(1, false);
      paint();
    });
    b.addEventListener("pointerup", () => {
      drag = null;
    });
    b.addEventListener("pointercancel", () => {
      drag = null;
    });
    b.addEventListener("keydown", (event) => {
      const isStart = b.dataset.edge === "start";
      const value = isStart ? start : end;
      const next =
        event.key === "Home"
          ? isStart
            ? 0
            : start + 0.25
          : event.key === "End"
            ? isStart
              ? end - 0.25
              : 12
            : event.key === "ArrowLeft"
              ? value - (event.shiftKey ? 1 : 0.1)
              : event.key === "ArrowRight"
                ? value + (event.shiftKey ? 1 : 0.1)
                : null;
      if (next === null) return;
      event.preventDefault();
      pause();
      userPaused = true;
      [start, end] = moveSampleEdge(start, end, b.dataset.edge, next);
      setChapter(1, false);
      paint();
    });
  }
  new ResizeObserver(resize).observe(wave);
  new MutationObserver(translate).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) {
        pause();
      } else if (!seen) {
        seen = true;
        if (
          !reduced.matches &&
          navigator.connection?.saveData !== true &&
          !document.hidden &&
          !userPaused
        )
          startIntro();
      }
    },
    { threshold: 0.25 },
  ).observe(stage);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  reduced.addEventListener("change", () => {
    if (reduced.matches) {
      stopIntro();
      paint();
    }
  });
  stage.addEventListener("focusin", (event) => {
    if (intro && event.target !== motionButton) {
      stopIntro();
      introComplete = true;
      userPaused = true;
      paint();
    }
  });
  translate();
  resize();
}
