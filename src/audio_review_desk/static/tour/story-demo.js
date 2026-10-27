import { sampleSignal, signalPeaks } from "./studio-signal.js";
import {
  STORY_DURATION,
  MIN_STORY_RANGE,
  clampStoryTime,
  moveStoryEdge,
  closestStoryEdge,
  storyKeyRange,
  storyTimeAt,
  storyTimeLabel,
} from "./story-math.js";

const SVG = "http://www.w3.org/2000/svg";
let sequence = 0;
let cachedPeaks;
const words = {
  zh: {
    compare: "原音与参考",
    range: "选择保留区间",
    notes: "时间标记",
    original: "原音",
    reference: "参考",
    start: "区间起点",
    end: "区间终点",
    retained: "已选",
    seconds: "秒",
    rangeHint: "拖动两端，或选中后用方向键微调。",
    noteHint: "点选波形，或按 Enter 记下时间点。",
    marker: "标记",
    remove: "移除",
    seek: "选择播放位置",
    empty: "还没有时间标记",
    audition: "示例片段",
    waveform: "音频波形",
  },
  en: {
    compare: "Original and reference",
    range: "Choose a range",
    notes: "Time markers",
    original: "Original",
    reference: "Reference",
    start: "Range start",
    end: "Range end",
    retained: "Selected",
    seconds: "seconds",
    rangeHint: "Drag either edge, or focus it and use the arrow keys.",
    noteHint: "Click the waveform, or press Enter to mark a moment.",
    marker: "Marker",
    remove: "Remove",
    seek: "Choose playback position",
    empty: "No time markers yet",
    audition: "Sample clip",
    waveform: "Audio waveform",
  },
};

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  return node;
}
function element(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
}
function peaks() {
  cachedPeaks ||= {
    a: signalPeaks(sampleSignal(8000, "a"), 144),
    b: signalPeaks(sampleSignal(8000, "b"), 144),
  };
  return cachedPeaks;
}
function wavePath(values) {
  const maximum = Math.max(...values);
  return values
    .map((peak, index) => {
      const x = ((index + 0.5) / values.length) * 1000;
      const height = Math.max(1.3, (peak / maximum) * 78);
      return (
        "M" +
        x.toFixed(2) +
        "," +
        (100 - height).toFixed(2) +
        "v" +
        (height * 2).toFixed(2)
      );
    })
    .join(" ");
}

export function mountStory(host) {
  const ownRoot = element("div", "story-demo", host);
  const componentId = "score-story-" + ++sequence;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = [];
  const waveforms = [];
  const paths = { a: wavePath(peaks().a), b: wavePath(peaks().b) };
  const panels = {};
  const variantButtons = {};
  let language = "zh",
    mode = "compare",
    selection = { start: 2.4, end: 7.8 };
  let variant = "a",
    markers = [],
    markerSequence = 0,
    drag = null;
  let visible = true,
    disposed = false,
    motionPaused = reduced.matches,
    manualPause = null,
    raf = 0;
  let playback = { time: 0, playing: false, received: performance.now() };
  let paintedState = "";
  const text = (key) => words[language][key];
  const on = (node, type, listener, options) => {
    node.addEventListener(type, listener, options);
    listeners.push(() => node.removeEventListener(type, listener, options));
  };
  const emit = (type, detail) =>
    host.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));

  const topline = element("div", "story-topline", ownRoot);
  const modeLabel = element("span", "story-mode-label", topline);
  const sourceLabel = element("span", "story-source-label", topline);
  const panelHost = element("div", "story-panels", ownRoot);

  function makePanel(name) {
    const panel = element("div", "story-panel story-panel-" + name, panelHost);
    panel.dataset.panel = name;
    panels[name] = panel;
    return panel;
  }

  function makeWave(
    parent,
    source,
    { selectable = false, range = false } = {},
  ) {
    const frame = element("div", "story-wave", parent);
    const svg = svgElement("svg", {
      viewBox: "0 0 1000 200",
      preserveAspectRatio: "none",
      role: "img",
    });
    const defs = svgElement("defs");
    const clip = svgElement("clipPath", {
      id: componentId + "-" + waveforms.length,
    });
    const clipRect = svgElement("rect", { x: 0, y: 0, width: 0, height: 200 });
    clip.append(clipRect);
    defs.append(clip);
    svg.append(defs);
    const rangeFill = range
      ? svgElement("rect", { class: "story-range-fill", y: 0, height: 200 })
      : null;
    if (rangeFill) svg.append(rangeFill);
    svg.append(
      svgElement("line", {
        x1: 0,
        y1: 100,
        x2: 1000,
        y2: 100,
        class: "story-wave-baseline",
      }),
    );
    const d = paths[source];
    const base = svgElement("path", { d, class: "story-wave-base" });
    svg.append(base);
    const ink = svgElement("path", {
      d,
      class: "story-wave-ink",
      "clip-path": "url(#" + clip.id + ")",
    });
    svg.append(ink);
    const playhead = svgElement("line", {
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 200,
      class: "story-playhead",
    });
    svg.append(playhead);
    const markerGroup = svgElement("g", { class: "story-marker-pins" });
    svg.append(markerGroup);
    frame.append(svg);
    const wave = {
      frame,
      svg,
      playhead,
      clipRect,
      rangeFill,
      source,
      base,
      ink,
      markerGroup,
      panel: parent.closest(".story-panel").dataset.panel,
    };
    waveforms.push(wave);
    if (selectable) {
      frame.tabIndex = 0;
      frame.setAttribute("role", "slider");
      frame.setAttribute("aria-valuemin", "0");
      frame.setAttribute("aria-valuemax", String(STORY_DURATION));
      on(frame, "click", (event) => {
        if (event.target.closest(".story-edge")) return;
        const rect = frame.getBoundingClientRect();
        const time = storyTimeAt(event.clientX, rect.left, rect.width);
        if (mode === "notes") addMarker(time);
        emit("storyseek", { time });
      });
      on(frame, "keydown", (event) => {
        if (
          !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        const time =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? STORY_DURATION
              : clampStoryTime(
                  playback.time +
                    (event.key === "ArrowLeft"
                      ? -0.1
                      : event.key === "ArrowRight"
                        ? 0.1
                        : 0),
                );
        if (event.key === "Enter" && mode === "notes") addMarker(time);
        else emit("storyseek", { time });
      });
    }
    return wave;
  }

  const comparePanel = makePanel("compare");
  for (const source of ["a", "b"]) {
    const lane = element("div", "story-lane", comparePanel);
    lane.dataset.variant = source;
    const button = element("button", "story-variant", lane);
    button.type = "button";
    button.dataset.variant = source;
    const letter = element("span", "story-variant-letter", button);
    letter.textContent = source.toUpperCase();
    const label = element("span", "story-variant-name", button);
    variantButtons[source] = { button, label, lane };
    const wave = makeWave(lane, source);
    wave.variantLane = true;
    on(button, "click", () => {
      variant = source;
      paint();
      emit("storyvariantchange", { variant });
    });
  }

  const rangePanel = makePanel("range");
  const rangeWave = makeWave(rangePanel, "a", { range: true });
  const edges = {};
  for (const edge of ["start", "end"]) {
    const button = element("button", "story-edge", rangeWave.frame);
    button.type = "button";
    button.dataset.edge = edge;
    button.setAttribute("role", "slider");
    button.setAttribute("aria-orientation", "horizontal");
    edges[edge] = button;
    on(button, "pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = rangeWave.frame.getBoundingClientRect();
      const point = ((event.clientX - rect.left) / rect.width) * STORY_DURATION;
      const pickedEdge = closestStoryEdge(selection, point);
      edges[pickedEdge].focus({ preventScroll: true });
      drag = {
        edge: pickedEdge,
        id: event.pointerId,
        offset: point - selection[pickedEdge],
        original: { ...selection },
        button,
      };
      button.setPointerCapture(event.pointerId);
      ownRoot.classList.add("is-dragging");
    });
    on(button, "pointermove", (event) => {
      if (!drag || drag.button !== button || drag.id !== event.pointerId)
        return;
      const rect = rangeWave.frame.getBoundingClientRect();
      updateRange(
        moveStoryEdge(
          selection,
          drag.edge,
          storyTimeAt(event.clientX, rect.left, rect.width, drag.offset),
        ),
      );
    });
    on(button, "pointerup", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      finishDrag(false);
    });
    on(button, "pointercancel", () => finishDrag(true));
    on(button, "lostpointercapture", () => {
      if (drag?.button === button) finishDrag(true);
    });
    on(button, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    on(button, "keydown", (event) => {
      const next = storyKeyRange(selection, edge, event.key, event.shiftKey);
      if (!next) return;
      event.preventDefault();
      updateRange(next);
    });
  }
  const rangeSummary = element("div", "story-range-summary", rangePanel);
  const rangeName = element("span", "", rangeSummary);
  const rangeValue = element("span", "story-range-value", rangeSummary);
  const rangeHint = element("p", "story-hint", rangePanel);

  const notesPanel = makePanel("notes");
  const noteWave = makeWave(notesPanel, "a", { selectable: true });
  const noteHint = element("p", "story-hint", notesPanel);
  noteHint.id = componentId + "-note-hint";
  noteWave.frame.setAttribute("aria-describedby", noteHint.id);
  const markerList = element("div", "story-marker-list", notesPanel);
  markerList.setAttribute("role", "list");
  const emptyMarkers = element("span", "story-markers-empty", markerList);
  const timeline = element("div", "story-timeline", ownRoot);
  const nowLabel = element("span", "story-now", timeline);
  const durationLabel = element("span", "", timeline);
  durationLabel.textContent = "0:12";

  function updateRange(next) {
    selection = next;
    paint();
    emit("storyrangechange", { ...selection });
  }
  function finishDrag(cancelled) {
    if (!drag) return;
    const current = drag;
    drag = null;
    ownRoot.classList.remove("is-dragging");
    if (current.button.hasPointerCapture(current.id))
      current.button.releasePointerCapture(current.id);
    if (cancelled) updateRange(current.original);
  }
  function addMarker(time) {
    if (markers.some((marker) => Math.abs(marker.time - time) < 0.08)) return;
    markers.push({ id: ++markerSequence, time: clampStoryTime(time) });
    markers.sort((a, b) => a.time - b.time);
    paintMarkers();
  }
  function paintMarkers() {
    markerList.replaceChildren();
    noteWave.markerGroup.replaceChildren();
    if (!markers.length) {
      emptyMarkers.textContent = text("empty");
      markerList.append(emptyMarkers);
    }
    for (const marker of markers) {
      const x = (marker.time / STORY_DURATION) * 1000;
      const pin = svgElement("g");
      pin.append(svgElement("line", { x1: x, y1: 0, x2: x, y2: 200 }));
      pin.append(svgElement("circle", { cx: x, cy: 8, r: 5 }));
      noteWave.markerGroup.append(pin);
      const chip = element("div", "story-marker", markerList);
      chip.setAttribute("role", "listitem");
      const seek = element("button", "story-marker-seek", chip);
      seek.type = "button";
      seek.textContent =
        storyTimeLabel(marker.time) + " · " + text("marker") + " " + marker.id;
      seek.addEventListener("click", () =>
        emit("storyseek", { time: marker.time }),
      );
      const remove = element("button", "story-marker-remove", chip);
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute(
        "aria-label",
        text("remove") + " " + text("marker") + " " + marker.id,
      );
      remove.addEventListener("click", () => {
        markers = markers.filter((item) => item.id !== marker.id);
        paintMarkers();
        noteWave.frame.focus({ preventScroll: true });
      });
    }
  }
  function timeNow(now = performance.now()) {
    return clampStoryTime(
      playback.time + (playback.playing ? (now - playback.received) / 1000 : 0),
    );
  }
  function paint(now = performance.now()) {
    if (disposed) return;
    const time = timeNow(now),
      x = (time / STORY_DURATION) * 1000;
    const state = [
      language,
      mode,
      variant,
      selection.start,
      selection.end,
    ].join("|");
    const stateChanged = paintedState !== state;
    if (stateChanged) {
      paintedState = state;
      ownRoot.dataset.mode = mode;
      for (const [name, panel] of Object.entries(panels)) {
        const active = name === mode;
        panel.classList.toggle("is-active", active);
        panel.toggleAttribute("inert", !active);
        panel.setAttribute("aria-hidden", String(!active));
      }
      modeLabel.textContent = text(mode);
      sourceLabel.textContent = text("audition");
      for (const wave of waveforms) {
        wave.svg.setAttribute(
          "aria-label",
          text("waveform") +
            " " +
            (wave.variantLane
              ? wave.source.toUpperCase()
              : variant.toUpperCase()),
        );
        if (!wave.variantLane) {
          wave.base.setAttribute("d", paths[variant]);
          wave.ink.setAttribute("d", paths[variant]);
        }
      }
      for (const source of ["a", "b"]) {
        const entry = variantButtons[source];
        entry.label.textContent = text(
          source === "a" ? "original" : "reference",
        );
        entry.button.setAttribute("aria-pressed", String(source === variant));
        entry.lane.classList.toggle("is-current", source === variant);
      }
    }
    for (const wave of waveforms) {
      if (wave.panel !== mode) continue;
      wave.playhead.setAttribute("x1", x);
      wave.playhead.setAttribute("x2", x);
      wave.playhead.style.opacity = time > 0 ? "1" : "0";
      const start = wave.rangeFill
        ? (selection.start / STORY_DURATION) * 1000
        : 0;
      const end = wave.rangeFill ? (selection.end / STORY_DURATION) * 1000 : x;
      if (!wave.rangeFill || stateChanged) {
        wave.clipRect.setAttribute("x", start);
        wave.clipRect.setAttribute("width", Math.max(0, end - start));
      }
      if (wave.rangeFill && stateChanged) {
        wave.rangeFill.setAttribute("x", start);
        wave.rangeFill.setAttribute("width", end - start);
      }
      if (wave.frame.tabIndex === 0) {
        wave.frame.setAttribute("aria-label", text("seek"));
        wave.frame.setAttribute(
          "aria-valuenow",
          String(Math.round(time * 100) / 100),
        );
        wave.frame.setAttribute("aria-valuetext", storyTimeLabel(time));
      }
    }
    if (stateChanged) {
      for (const edge of ["start", "end"]) {
        const button = edges[edge];
        button.style.left = (selection[edge] / STORY_DURATION) * 100 + "%";
        button.setAttribute("aria-label", text(edge));
        button.setAttribute(
          "aria-valuemin",
          String(edge === "start" ? 0 : selection.start + MIN_STORY_RANGE),
        );
        button.setAttribute(
          "aria-valuemax",
          String(
            edge === "end" ? STORY_DURATION : selection.end - MIN_STORY_RANGE,
          ),
        );
        button.setAttribute(
          "aria-valuenow",
          String(Math.round(selection[edge] * 1000) / 1000),
        );
        button.setAttribute("aria-valuetext", storyTimeLabel(selection[edge]));
      }
      rangeName.textContent = text("retained");
      rangeValue.textContent =
        storyTimeLabel(selection.start) + " — " + storyTimeLabel(selection.end);
      rangeHint.textContent = text("rangeHint");
      noteHint.textContent = text("noteHint");
    }
    const label = storyTimeLabel(time);
    if (nowLabel.textContent !== label) nowLabel.textContent = label;
  }
  function tick(now) {
    raf = 0;
    if (disposed || !visible || document.hidden) return;
    paint(now);
    if (playback.playing && timeNow(now) < STORY_DURATION)
      raf = requestAnimationFrame(tick);
  }
  function request() {
    if (!raf && !disposed && visible && !document.hidden)
      raf = requestAnimationFrame(tick);
  }
  function stopFrame() {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function preference() {
    motionPaused = reduced.matches || manualPause === true;
    ownRoot.classList.toggle("motion-paused", motionPaused);
  }
  on(document, "visibilitychange", () => {
    if (document.hidden) {
      finishDrag(true);
      stopFrame();
    } else request();
  });
  on(reduced, "change", preference);
  const observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) request();
      else stopFrame();
    },
    { threshold: 0 },
  );
  observer.observe(ownRoot);
  paint();
  paintMarkers();
  preference();

  return {
    setMode(next) {
      if (!Object.hasOwn(panels, next))
        throw new RangeError("Unknown story mode");
      finishDrag(true);
      mode = next;
      paint();
    },
    setLanguage(next) {
      if (!Object.hasOwn(words, next))
        throw new RangeError("Unknown story language");
      language = next;
      paint();
      paintMarkers();
    },
    setPaused(value) {
      manualPause = !!value;
      motionPaused = manualPause || reduced.matches;
      ownRoot.classList.toggle("motion-paused", motionPaused);
    },
    setPlayback(next = {}) {
      if (disposed) return;
      playback = {
        time: Object.hasOwn(next, "time")
          ? clampStoryTime(next.time)
          : timeNow(),
        playing: Object.hasOwn(next, "playing")
          ? !!next.playing
          : playback.playing,
        received: performance.now(),
      };
      if (["a", "b"].includes(next.variant)) variant = next.variant;
      if (visible && !document.hidden && !playback.playing) paint();
      request();
    },
    get range() {
      return { ...selection };
    },
    dispose() {
      if (disposed) return;
      finishDrag(true);
      disposed = true;
      stopFrame();
      observer.disconnect();
      listeners.forEach((remove) => remove());
      ownRoot.remove();
    },
  };
}
