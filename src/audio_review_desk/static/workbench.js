import { words } from "./copy.js";
import { springValue, reveal, openDialog, closeDialog } from "./motion.js";
import { mountWaveform } from "./waveform.js";
import { mountTransport } from "./transport.js";
import { mountMarkers } from "./markers.js";
import { mountCommands } from "./commands.js";
import { errorText } from "./errors.js";
import { createListeningMemory, resumedTime } from "./listening.js";
import { mountPreview } from "./tour/preview.js";
import {
  formatTime,
  filterItems,
  sortItems,
  reviewPayload,
  playbackRange,
  searchText,
  sameReview,
  queueStamp,
  continueQueue,
} from "./ui.js";

const $ = (id) => document.getElementById(id);
let language = navigator.language.startsWith("zh") ? "zh" : "en";
try {
  language = localStorage.getItem("ard-language") || language;
} catch {}
if (!words[language]) language = "en";
let state = null,
  selected = null,
  dirty = false,
  busy = false,
  variant = "a",
  wave = { a: [], b: [] },
  generation = 0,
  job = null,
  pollTimer = null,
  handledJob = null;
const selectedKeys = new Set(),
  player = $("player");
const issueNames = [
  "cut_start",
  "cut_end",
  "noise",
  "reverb",
  "backing_voice",
  "instrument",
  "lyrics",
  "distortion",
  "identity",
  "other",
];
const t = (key) => words[language][key] || key;
const preview = mountPreview({
  video: $("workflowPreview"),
  button: $("previewToggle"),
  t,
});
const precise = (seconds) =>
  `${formatTime(seconds)}.${Math.floor(((seconds || 0) % 1) * 1000)
    .toString()
    .padStart(3, "0")}`;
const number = (value) => (value.trim() === "" ? null : Number(value));

let markersView,
  listeningMemory,
  persistedAt = 0;
let queueHasPosition = false,
  renderedQueueStamp = "",
  highlightedKey = null;
const queueRows = new Map();
let visibleCache = null;
let noticeTimer,
  choosing = false;
const waveformView = mountWaveform(
  $("waveform"),
  $("seek"),
  $("waveSelection"),
  $("playhead"),
  {
    start: $("trimStartHandle"),
    end: $("trimEndHandle"),
    pan: $("wavePan"),
    onEdit(start, end) {
      const duration = selected?.quality.duration || 0;
      $("trimStart").value = Math.min(duration, Number(start.toFixed(3)));
      $("trimEnd").value = Math.min(duration, Number(end.toFixed(3)));
      markDirty();
    },
    onView(start, end, zoom) {
      markersView?.view(start, end);
      $("rulerStart").textContent = precise(start);
      $("rulerMid").textContent = precise((start + end) / 2);
      $("rulerEnd").textContent = precise(end);
      $("zoomLevel").textContent = `${zoom.toFixed(zoom % 1 ? 1 : 0)}×`;
      $("zoomOut").disabled = zoom <= 1;
      $("zoomIn").disabled = zoom >= 8;
    },
  },
);
const moveGlider = springValue((value) => {
  $("abGlider").style.transform = `translateX(${value}px)`;
});
const moveQueue = springValue((y) => {
  $("queueHighlight").style.transform = `translateY(${y}px)`;
});
const transport = mountTransport({
  player,
  button: $("play"),
  seek: $("seek"),
  back: $("skipBack"),
  forward: $("skipForward"),
  volume: $("volume"),
  range,
  loop: $("loop"),
  onTime: updateTime,
  onError: () => notice(t("audioError")),
  labels: () => ({ play: t("play"), pause: t("pause") }),
});
markersView = mountMarkers({
  input: $("markerText"),
  add: $("addMarker"),
  list: $("markerList"),
  ticks: $("markerTicks"),
  player,
  duration: () => selected?.quality.duration || 0,
  t,
  onChange: markDirty,
  onError: (message) => notice(message),
});
const commandMenu = mountCommands({
  dialog: $("commandDialog"),
  input: $("commandInput"),
  list: $("commandList"),
  emptyText: () => t("commandEmpty"),
  onError: (error) => notice(errorText(error, language)),
  rows: () => {
    if (!state) return [];
    const actions = [
      { label: t("chooseFiles"), run: () => browse("files", true) },
      { label: t("import"), run: openImport },
      { label: t("help"), run: () => openDialog($("helpDialog")) },
    ];
    if (selected?.quality.decoded)
      actions.push(
        { label: t("addMarker"), hint: "M", run: () => markersView.focus() },
        {
          label: t(player.paused ? "play" : "pause"),
          hint: "Space",
          run: () => $("play").click(),
        },
      );
    if (selected)
      actions.push({
        label: t("save"),
        hint: "Ctrl ↵",
        run: () => save(false),
      });
    if (state.items.length)
      actions.push(
        {
          label: t("nextPending"),
          run: async () => {
            const item = state.items.find(
              (row) =>
                row.key !== selected?.key && row.review.status === "pending",
            );
            if (item) await select(item);
            else notice(t("noPending"), true);
          },
        },
        { label: t("focus"), run: () => $("focusMode").click() },
        { label: t("rescan"), run: () => $("rescan").click() },
      );
    return [
      ...actions,
      ...state.items.map((item) => ({
        label: item.label,
        search: searchText(item),
        hint: t(item.review.status),
        run: () => select(item),
      })),
    ];
  },
});
function notice(message = "", success = false) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  $("notice").hidden = !message;
  $("notice").classList.toggle("success", success);
  if (message) reveal($("notice"));
  if (message && success) noticeTimer = setTimeout(() => notice(), 3200);
}
async function request(path, options) {
  let response, result;
  try {
    response = await fetch(path, options);
    result = await response.json();
  } catch {
    const error = new Error(errorText({ code: "network" }, language));
    error.code = "network";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(errorText(result, language));
    error.code = result.code;
    throw error;
  }
  return result;
}
const post = (path, payload) =>
  request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Review-Token": state.session,
    },
    body: JSON.stringify(payload),
  });
let discardResolver = null;
async function discardAllowed() {
  if (!dirty) return true;
  if (discardResolver) return false;
  const allowed = await new Promise((resolve) => {
    discardResolver = resolve;
    openDialog($("discardDialog"));
    $("keepEditing").focus();
  });
  if (allowed) {
    dirty = false;
    if (selected) renderDetails(true);
  }
  return allowed;
}
const importing = () => job && ["running", "cancelling"].includes(job.state);

function translate() {
  const completed = !$("queueComplete").hidden;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  preview.language(language);
  if (!$("importError").hidden && $("importError").dataset.code)
    $("importError").textContent = errorText(
      { code: $("importError").dataset.code },
      language,
    );
  $("language").value = language;
  document.querySelectorAll("[data-t]").forEach((element) => {
    element.textContent = t(element.dataset.t);
  });
  document.querySelectorAll("[data-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.placeholder);
  });
  document.querySelectorAll("[data-title]").forEach((element) => {
    element.title = t(element.dataset.title);
    element.setAttribute("aria-label", t(element.dataset.title));
  });
  $("search").setAttribute("aria-label", t("search"));
  $("filter").setAttribute("aria-label", t("all"));
  for (const [id, key] of [
    ["seek", "position"],
    ["volume", "volume"],
    ["sort", "sort"],
    ["batchStatus", "batch"],
    ["trimStart", "trimStart"],
    ["trimEnd", "trimEnd"],
    ["score", "score"],
  ])
    $(id).setAttribute("aria-label", t(key));
  for (const label of $("issues").querySelectorAll("label"))
    label.querySelector("span").textContent = t(
      label.querySelector("input").value,
    );
  if (state) {
    renderSummary();
    renderQueue();
    if (selected) renderDetails(false);
  }
  if (completed) showCompletion();
  if (job) renderJob();
  markersView?.refresh(busy || !selected?.quality.decoded);
  transport.refresh();
  updateLibraryToggle();
}
for (const name of issueNames) {
  const label = document.createElement("label"),
    input = document.createElement("input"),
    span = document.createElement("span");
  input.type = "checkbox";
  input.value = name;
  span.textContent = t(name);
  label.append(input, span);
  $("issues").append(label);
}

function renderSummary() {
  document.body.classList.remove("is-loading");
  document.querySelector("main").removeAttribute("inert");
  $("exportMenu").removeAttribute("inert");
  $("openCommands").disabled = false;
  $("bootStatus").hidden = true;
  const stats = state.stats;
  document.body.classList.toggle("is-empty", state.items.length === 0);
  const done = stats.files - stats.review_counts.pending;
  $("reviewProgressText").textContent =
    `${t("reviewed")} ${done} / ${stats.files}`;
  $("reviewProgress").max = stats.files || 1;
  $("reviewProgress").value = done;
  $("fileCount").textContent = stats.files;
  $("pendingCount").textContent = stats.review_counts.pending;
  $("approvedCount").textContent = stats.review_counts.pass;
  $("flagCount").textContent = stats.warnings + stats.errors;
  $("candidateTime").textContent = formatTime(stats.candidate_seconds);
  $("approvedTime").textContent = formatTime(stats.human_approved_seconds);
  $("version").textContent = state.version || "0.11.1";
  $("scanTime").textContent = state.scan
    ? new Date(state.scan.at).toLocaleString(language === "zh" ? "zh-CN" : "en")
    : "";
  $("duplicateInfo").textContent =
    `${stats.duplicate_groups.length} ${language === "en" && stats.duplicate_groups.length === 1 ? "duplicate group" : t("duplicateGroups")}`;
  $("duplicateInfo").hidden = stats.duplicate_groups.length === 0;
  for (const id of [
    "chooseFiles",
    "chooseFolder",
    "chooseManifest",
    "browsePath",
  ])
    $(id).disabled = choosing || busy || Boolean(importing());
  $("rescan").disabled = !state.can_rescan || busy || Boolean(importing());
  $("openImport").disabled = busy || Boolean(importing());
}
function visibleItems() {
  const query = $("search").value,
    filter = $("filter").value,
    order = $("sort").value;
  if (
    visibleCache &&
    visibleCache.source === state.items &&
    visibleCache.query === query &&
    visibleCache.filter === filter &&
    visibleCache.order === order
  )
    return visibleCache.items;
  const items = sortItems(
    filterItems(
      state.items,
      query,
      filter,
      new Set(state.stats.duplicate_groups.flat()),
    ),
    order,
  );
  visibleCache = { source: state.items, query, filter, order, items };
  return items;
}
function renderSelection() {
  const list = visibleItems(),
    count = list.filter((item) => selectedKeys.has(item.key)).length;
  $("selectAll").checked = Boolean(list.length) && count === list.length;
  $("selectAll").indeterminate = count > 0 && count < list.length;
  $("selectAll").disabled = !list.length || busy;
  $("selectedCount").textContent = selectedKeys.size
    ? `${selectedKeys.size} ${t("selected")}`
    : "";
  $("batchBar").hidden = !selectedKeys.size;
  $("applyBatch").disabled = busy || selectedKeys.size > 500;
}
function renderQueue() {
  for (const button of document.querySelectorAll("[data-queue-filter]"))
    button.setAttribute(
      "aria-pressed",
      String($("filter").value === button.dataset.queueFilter),
    );
  const list = visibleItems();
  $("queueCount").textContent = `${list.length} / ${state.items.length}`;
  $("emptyLibrary").hidden = state.items.length > 0;
  $("emptyFilter").hidden = !state.items.length || list.length > 0;
  const stamp = queueStamp(list, language);
  if (stamp !== renderedQueueStamp) {
    renderedQueueStamp = stamp;
    queueRows.clear();
    $("items").replaceChildren(
      ...list.map((item) => {
        const row = document.createElement("div");
        row.className = "clip-row";
        queueRows.set(item.key, row);
        row.classList.toggle("selected", item.key === selected?.key);
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedKeys.has(item.key);
        checkbox.disabled = busy;
        checkbox.setAttribute(
          "aria-label",
          `${t("selectClip")}: ${item.label}`,
        );
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedKeys.add(item.key);
          else selectedKeys.delete(item.key);
          renderSelection();
        });
        const button = document.createElement("button");
        button.type = "button";
        button.className = "clip";
        button.setAttribute("aria-current", String(item.key === selected?.key));
        const name = document.createElement("span");
        name.className = "clip-name";
        name.textContent = item.label;
        const meta = document.createElement("span");
        meta.className = "clip-meta";
        const duration = document.createElement("span"),
          status = document.createElement("span");
        duration.textContent = `${formatTime(item.quality.duration)}${item.quality.flags.length ? " · !" : ""}`;
        status.textContent = t(item.review.status);
        status.className = `status-${item.review.status}`;
        meta.append(duration, status);
        button.append(name, meta);
        button.addEventListener("click", () => select(item));
        row.append(checkbox, button);
        return row;
      }),
    );
  }
  const oldRow = queueRows.get(highlightedKey);
  oldRow?.classList.remove("selected");
  oldRow?.querySelector(".clip")?.setAttribute("aria-current", "false");
  const activeRow = queueRows.get(selected?.key);
  activeRow?.classList.add("selected");
  activeRow?.querySelector(".clip")?.setAttribute("aria-current", "true");
  highlightedKey = selected?.key || null;
  for (const [key, row] of queueRows) {
    const checkbox = row.querySelector("input");
    checkbox.checked = selectedKeys.has(key);
    checkbox.disabled = busy;
  }
  $("queueHighlight").hidden = !activeRow;
  if (activeRow) {
    $("queueHighlight").style.height = `${activeRow.offsetHeight}px`;
    moveQueue(activeRow.offsetTop, !queueHasPosition);
    queueHasPosition = true;
  }
  renderSelection();
}
function draftValues() {
  return {
    status: document.querySelector("input[name=decision]:checked")?.value,
    score: $("score").value,
    trimStart: $("trimStart").value,
    trimEnd: $("trimEnd").value,
    issues: [...$("issues").querySelectorAll("input:checked")].map(
      (input) => input.value,
    ),
    note: $("note").value,
    markers: markersView.get(),
  };
}
function updateIssueCount() {
  const count = $("issues").querySelectorAll("input:checked").length;
  $("issueCount").textContent = count;
  $("issueCount").hidden = count === 0;
}
function markDirty() {
  updateIssueCount();
  if (!busy && selected) {
    dirty =
      !sameReview(reviewPayload(selected, draftValues()), selected.review) ||
      markersView.hasChanges(selected.review.markers) ||
      Boolean($("reviewForm").querySelector(":invalid"));
    $("saveState").textContent = dirty
      ? t("unsaved")
      : selected.review.version
        ? t("saved")
        : t("notReviewed");
    if (["trimStart", "trimEnd"].includes(document.activeElement?.id))
      drawWave();
  }
}
function range() {
  return playbackRange(
    selected?.quality.duration || 0,
    number($("trimStart").value),
    number($("trimEnd").value),
  );
}
function updateTime(seconds = player.currentTime || 0, text = true) {
  if (text) {
    $("playTime").textContent = precise(seconds);
    $("totalTime").textContent =
      `/ ${formatTime(selected?.quality.duration || 0)}`;
    $("seek").setAttribute(
      "aria-valuetext",
      `${precise(seconds)} / ${formatTime(selected?.quality.duration || 0)}`,
    );
  }
  waveformView.position(seconds);
}
function drawWave() {
  const [start, end] = range();
  waveformView.set(
    wave[variant] || [],
    selected?.quality.duration || 0,
    start,
    end,
  );
  waveformView.position(player.currentTime || 0);
}
function syncGlider(instant = false) {
  const button = $(variant === "a" ? "variantA" : "variantB");
  $("abGlider").style.width = `${button.offsetWidth}px`;
  moveGlider(button.offsetLeft - 3, instant);
}
function renderDetails(restore = true) {
  if (!selected) return;
  const item = selected,
    review = item.review,
    q = item.quality;
  $("queueComplete").hidden = true;
  $("detailPanel").hidden = false;
  $("emptyDetail").hidden = true;
  $("clipTitle").textContent = item.label;
  $("clipId").textContent = t(review.status);
  const names = {
    silence_or_very_quiet: "quiet",
    near_full_scale: "nearClip",
    multichannel: "multichannel",
    decode_error: "decodeError",
  };
  const flags = q.flags.length
    ? q.flags.map((flag) => t(names[flag] || "flagged"))
    : [t("noFlags")];
  if (!item.eligible) flags.push(t("ineligible"));
  if (item.error) {
    flags.length = 0;
    flags.push(
      errorText({ code: item.error_code || "decode_failed" }, language),
    );
  }
  $("qualityFlags").replaceChildren(
    ...flags.map((text) => {
      const span = document.createElement("span");
      span.className = `flag${item.error ? " error" : q.flags.length ? "" : " good"}`;
      span.textContent = text;
      return span;
    }),
  );
  $("qualityFlags").hidden = !q.flags.length && !item.error && item.eligible;
  $("audioSection").hidden = !q.decoded;
  for (const id of ["play", "skipBack", "skipForward", "volume"])
    $(id).disabled = !q.decoded;
  $("seek").disabled = !q.decoded || player.readyState === 0;
  $("rulerMid").textContent = formatTime((q.duration || 0) / 2);
  $("rulerEnd").textContent = formatTime(q.duration || 0);
  $("variantB").disabled = !item.reference_quality || busy;
  for (const [id, value] of [
    ["variantA", "a"],
    ["variantB", "b"],
  ]) {
    $(id).classList.toggle("active", variant === value);
    $(id).setAttribute("aria-pressed", String(variant === value));
  }
  const rows = [
    ["rate", q.sample_rate ? `${q.sample_rate.toLocaleString()} Hz` : "—"],
    ["channels", q.channels || "—"],
    [
      "rms",
      Number.isFinite(q.rms_dbfs) ? `${q.rms_dbfs.toFixed(1)} dBFS` : "—",
    ],
    [
      "duration",
      Number.isFinite(q.duration) ? `${q.duration.toFixed(3)} s` : "—",
    ],
    ["peak", Number.isFinite(q.peak) ? `${(q.peak * 100).toFixed(2)}%` : "—"],
    [
      "edges",
      q.decoded
        ? `${q.leading_quiet_seconds.toFixed(3)} / ${q.trailing_quiet_seconds.toFixed(3)} s`
        : "—",
    ],
  ];
  $("technical").replaceChildren(
    ...rows.map(([key, value]) => {
      const div = document.createElement("div"),
        dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = t(key);
      dd.textContent = value;
      div.append(dt, dd);
      return div;
    }),
  );
  $("sourceInfo").textContent =
    `${item.source_id} · ${item.source_start.toFixed(3)}–${item.source_end.toFixed(3)} s`;
  document.querySelectorAll("input[name=decision]").forEach((input) => {
    input.disabled = busy || (input.value === "pass" && !q.decoded);
    if (restore) input.checked = input.value === review.status;
  });
  $("score").disabled = busy || !q.decoded;
  for (const id of [
    "trimStart",
    "trimEnd",
    "markIn",
    "markOut",
    "resetRange",
    "trimStartHandle",
    "trimEndHandle",
    "fitRange",
  ])
    $(id).disabled = busy || !q.decoded;
  $("undo").disabled = busy || review.version === 0;
  if (!restore) markersView.refresh(busy || !q.decoded);
  if (restore) {
    $("issuePanel").open = false;
    for (const id of ["score", "trimStart", "trimEnd"])
      $(id).setCustomValidity("");
    markersView.set(review.markers || [], busy || !q.decoded);
    $("score").value = review.score ?? "";
    $("trimStart").value = review.trim_start ?? "";
    $("trimEnd").value = review.trim_end ?? "";
    $("note").value = review.note;
    $("issues")
      .querySelectorAll("input")
      .forEach((input) => {
        input.checked = review.issues.includes(input.value);
      });
  }
  updateIssueCount();
  for (const id of ["trimStart", "trimEnd"]) $(id).max = q.duration || 0;
  $("trimEnd").placeholder = q.duration?.toFixed(3) || "—";
  $("saveState").textContent = dirty
    ? t("unsaved")
    : review.version
      ? t("saved")
      : t("notReviewed");
  const list = visibleItems(),
    index = list.findIndex((row) => row.key === item.key);
  $("previous").disabled = busy || index <= 0;
  $("next").disabled = busy || index < 0 || index >= list.length - 1;
  $("clipPosition").textContent =
    index >= 0 ? `${index + 1} / ${list.length}` : "";
  $("outsideFilter").hidden = index >= 0;
  syncGlider();
  updateTime();
  drawWave();
}
async function select(item) {
  if (busy || !(await discardAllowed())) return;
  rememberPosition();
  const turn = ++generation;
  player.pause();
  player.onloadedmetadata = null;
  selected = item;
  try {
    sessionStorage.setItem(
      `ard-current-${state.workspace_id || state.workspace}`,
      item.key,
    );
  } catch {}
  if (matchMedia("(max-width:720px)").matches)
    document.body.classList.add("mobile-library-collapsed");
  $("mobileSelection").textContent = item.label;
  updateLibraryToggle();
  dirty = false;
  variant = "a";
  wave = { a: [], b: [] };
  waveformView.reset();
  notice();
  renderQueue();
  renderDetails();
  $("historyPanel").open = false;
  if (item.quality.decoded) {
    const position = resumedTime(
      listeningMemory?.get() || { remember: false },
      item.key,
      item.quality.duration,
    );
    player.onloadedmetadata = () => {
      if (turn === generation) {
        player.currentTime = position;
        updateTime();
      }
    };
    player.src = `/media/${item.key}/a.wav`;
    $("seek").disabled = true;
    player.load();
    player.playbackRate = Number($("speed").value);
    try {
      const result = await request(`/api/wave/${item.key}`);
      if (turn === generation) {
        wave = result;
        drawWave();
      }
    } catch (error) {
      if (turn === generation) notice(errorText(error, language));
    }
  } else {
    player.removeAttribute("src");
    player.load();
  }
}
async function refresh(force = false) {
  if (busy || (!force && !(await discardAllowed()))) return;
  try {
    const previous = selected?.key;
    state = await request("/api/state");
    if (!listeningMemory) {
      listeningMemory = createListeningMemory(
        {
          getItem: (key) => localStorage.getItem(key),
          setItem: (key, value) => localStorage.setItem(key, value),
        },
        state.workspace_id || state.workspace,
      );
      const preferences = listeningMemory.get();
      $("speed").value = String(preferences.speed);
      $("volume").value = preferences.volume;
      player.volume = preferences.volume;
      $("loop").checked = preferences.loop;
      $("rememberPosition").checked = preferences.remember;
    }
    selected = null;
    dirty = false;
    for (const key of selectedKeys)
      if (!state.items.some((item) => item.key === key))
        selectedKeys.delete(key);
    renderSummary();
    renderQueue();
    let remembered = previous;
    try {
      remembered =
        remembered ||
        sessionStorage.getItem(
          `ard-current-${state.workspace_id || state.workspace}`,
        ) ||
        listeningMemory.get().selected;
    } catch {}
    const item =
      state.items.find((row) => row.key === remembered) ||
      visibleItems()[0] ||
      state.items[0];
    if (item) await select(item);
    else {
      $("detailPanel").hidden = true;
      $("emptyDetail").hidden = false;
    }
  } catch (error) {
    if (!state) {
      $("bootStatus").querySelector("p").textContent = t("loadError");
      $("retryLoad").hidden = false;
    }
    notice(errorText(error, language));
  }
}
function setBusy(value) {
  busy = value;
  for (const element of $("reviewForm").elements) element.disabled = value;
  for (const id of ["markIn", "markOut", "resetRange", "previous", "next"])
    $(id).disabled = value;
  if (state) {
    renderSummary();
    renderQueue();
    if (selected) renderDetails(false);
  }
}
async function save(advance = false) {
  if (busy || !selected || !$("reviewForm").reportValidity()) return;
  const focusBeforeSave = document.activeElement;
  const restoreMarkerFocus = markersView.captureFocus();
  const target = selected,
    ordered = visibleItems();
  if (!markersView.flush()) return;
  const payload = reviewPayload(target, draftValues());
  setBusy(true);
  $("saveState").textContent = t("saving");
  let success = false;
  try {
    const result = await post("/api/review", payload);
    target.review = result.review;
    visibleCache = null;
    dirty = false;
    success = true;
    const local = state.items.find((item) => item.key === target.key);
    if (local) local.review = result.review;
    try {
      state = await request("/api/state");
      notice(t("saved"), true);
    } catch {
      notice(t("savedRefresh"), true);
    }
  } catch (error) {
    dirty = true;
    notice(errorText(error, language));
  } finally {
    setBusy(false);
    if (success) renderDetails(false);
    if (!advance && document.activeElement === document.body) {
      if (focusBeforeSave?.isConnected && !focusBeforeSave.disabled)
        focusBeforeSave.focus({ preventScroll: true });
      else restoreMarkerFocus?.();
    }
  }
  if (success && advance) {
    const next = continueQueue(ordered, visibleItems(), target.key);
    if (next) await select(next);
    else if (state.stats.review_counts.pending === 0) showCompletion();
  }
}
function showCompletion() {
  player.pause();
  $("detailPanel").hidden = true;
  $("queueComplete").hidden = false;
  $("queueCompleteSummary").textContent = t("queueCompleteSummary")
    .replace("{total}", state.stats.files)
    .replace("{approved}", state.stats.review_counts.pass)
    .replace("{duration}", formatTime(state.stats.human_approved_seconds));
  $("queueCompleteTitle").focus({ preventScroll: true });
}
async function batch() {
  if (busy || !selectedKeys.size || !(await discardAllowed())) return;
  const changes = state.items
    .filter((item) => selectedKeys.has(item.key))
    .map((item) => ({ key: item.key, expected_version: item.review.version }));
  dirty = false;
  setBusy(true);
  let count = 0;
  try {
    const result = await post("/api/batch", {
      changes,
      status: $("batchStatus").value,
    });
    count = result.saved;
    selectedKeys.clear();
  } catch (error) {
    notice(errorText(error, language));
  } finally {
    setBusy(false);
  }
  if (count) {
    await refresh(true);
    notice(
      `${count} ${language === "en" && count === 1 ? "review updated" : t("batchSaved")}`,
      true,
    );
  }
}
async function undo() {
  if (busy || !selected || !(await discardAllowed())) return;
  const target = selected;
  setBusy(true);
  let success = false;
  try {
    await post("/api/undo", {
      key: target.key,
      expected_version: target.review.version,
    });
    dirty = false;
    success = true;
  } catch (error) {
    notice(errorText(error, language));
  } finally {
    setBusy(false);
  }
  if (success) {
    await refresh(true);
    notice(t("undoSaved"), true);
  }
}
async function switchVariant(next) {
  if (
    !selected?.quality.decoded ||
    next === variant ||
    (next === "b" && !selected.reference_quality)
  )
    return;
  const time = player.currentTime,
    resume = !player.paused;
  player.pause();
  variant = next;
  player.src = `/media/${selected.key}/${variant}.wav`;
  player.onloadedmetadata = () => {
    player.currentTime = Math.min(time, player.duration || 0);
    player.playbackRate = Number($("speed").value);
    if (resume)
      player.play().catch((error) => notice(errorText(error, language)));
  };
  player.load();
  renderDetails(false);
  updateTime(time);
}
function showImportError(error) {
  $("importError").dataset.code = error.code || "operation_failed";
  $("importError").textContent = errorText(error, language);
  $("importError").hidden = false;
}
async function openImport() {
  if (busy || importing() || !(await discardAllowed())) return;
  $("importError").hidden = true;
  $("appendOptions").hidden = !state.items.length;
  $("replaceHint").hidden = $("appendImport").checked;
  openDialog($("importDialog"));
  $("importPath").focus();
}
function renderJob() {
  const active = importing();
  $("jobStrip").hidden = !active;
  if (active) {
    $("jobText").textContent =
      job.state === "cancelling"
        ? t("jobCancel")
        : job.phase === "saving"
          ? t("jobSaving")
          : job.label || t("jobReading");
    $("jobCounter").textContent = job.total
      ? `${job.done} / ${job.total}`
      : "…";
    $("jobProgress").value = job.total ? (100 * job.done) / job.total : 0;
    $("cancelImport").disabled =
      job.state === "cancelling" || job.phase === "saving";
  }
  if (state) renderSummary();
}
async function poll(restoring = false) {
  clearTimeout(pollTimer);
  try {
    job = await request("/api/job");
    if (restoring && !importing()) handledJob = job.id;
    renderJob();
    if (importing()) {
      pollTimer = setTimeout(poll, 700);
      return;
    }
    if (job.id && handledJob !== job.id) {
      handledJob = job.id;
      if (job.state === "succeeded") {
        if (dirty) notice(t("refreshDraft"), true);
        else {
          await refresh(true);
          notice(t("jobDone"), true);
        }
      } else if (job.state === "cancelled") notice(t("jobCancelled"));
      else if (job.state === "failed") notice(errorText(job, language));
    }
  } catch (error) {
    notice(errorText(error, language));
  }
}
async function startImport(event) {
  event.preventDefault();
  $("importError").hidden = true;
  if (!$("importPath").value.trim()) {
    showImportError({ code: "path_required" });
    $("importPath").focus();
    return;
  }
  try {
    job = await post("/api/import", {
      kind: $("importKind").value,
      path:
        $("importKind").value === "files"
          ? $("importPath")
              .value.split(/\r?\n/)
              .map((p) => p.trim())
              .filter(Boolean)
          : $("importPath").value.trim(),
      append: $("appendImport").checked,
    });
    closeDialog($("importDialog"));
    renderJob();
    pollTimer = setTimeout(poll, 200);
  } catch (error) {
    showImportError(error);
  }
}
function markBoundary(side) {
  if (!selected?.quality.decoded || busy) return;
  $(side === "start" ? "trimStart" : "trimEnd").value = (
    player.currentTime || 0
  ).toFixed(3);
  markDirty();
  drawWave();
}
async function loadHistory() {
  if (!$("historyPanel").open || !selected) return;
  const key = selected.key;
  try {
    const result = await request(`/api/history/${key}`);
    if (key !== selected?.key) return;
    $("history").replaceChildren(
      ...result.history.map((review) => {
        const p = document.createElement("p");
        const detail = [
          review.score !== null ? `${t("score")}: ${review.score}` : "",
          review.note,
          ...(review.markers || []).map(
            (row) => `${precise(row.time)} · ${row.text}`,
          ),
        ]
          .filter(Boolean)
          .join("\n");
        p.textContent = `v${review.version} · ${t(review.status)} · ${new Date(review.updated_utc).toLocaleString(language === "zh" ? "zh-CN" : "en")}\n${detail}`;
        return p;
      }),
    );
    if (!result.history.length) $("history").textContent = t("noHistory");
  } catch (error) {
    notice(errorText(error, language));
  }
}

$("reviewForm").addEventListener("input", markDirty);
for (const [id, code] of [
  ["score", "score_range"],
  ["trimStart", "trim_invalid"],
  ["trimEnd", "trim_invalid"],
]) {
  $(id).addEventListener("invalid", () =>
    $(id).setCustomValidity(errorText({ code }, language)),
  );
  $(id).addEventListener("input", () => $(id).setCustomValidity(""));
}
for (const id of ["trimStart", "trimEnd"])
  $(id).addEventListener("input", markDirty);
$("reviewForm").addEventListener("submit", (event) => {
  event.preventDefault();
  save(true);
});
$("save").addEventListener("click", () => save(false));
$("undo").addEventListener("click", undo);
$("applyBatch").addEventListener("click", batch);
for (const id of ["openImport", "emptyImport", "welcomeImport"])
  $(id).addEventListener("click", openImport);
for (const id of ["closeImport", "dismissImport"])
  $(id).addEventListener("click", () => closeDialog($("importDialog")));
$("importForm").addEventListener("submit", startImport);
async function browse(kind, importNow = false) {
  if (choosing || busy || importing() || !(await discardAllowed())) return;
  choosing = true;
  let picked = false;
  renderSummary();
  try {
    const result = await post("/api/browse", { kind, language });
    if (!result.path) return;
    picked = true;
    $("importError").hidden = true;
    $("importKind").value = kind;
    $("importPath").value = Array.isArray(result.path)
      ? result.path.join("\n")
      : result.path;
    if (importNow) {
      job = await post("/api/import", {
        kind,
        path: result.path,
        append: true,
      });
      renderJob();
      pollTimer = setTimeout(poll, 200);
    }
  } catch (error) {
    await openImport();
    $("importKind").value = kind;
    showImportError(
      picked ? error : { code: error.code || "picker_unavailable" },
    );
  } finally {
    choosing = false;
    renderSummary();
  }
}
$("chooseFiles").addEventListener("click", () => browse("files", true));
$("appendImport").addEventListener("change", () => {
  $("replaceHint").hidden = $("appendImport").checked;
});
$("openCommands").addEventListener("click", () => commandMenu.open());
$("closeCommands").addEventListener("click", () => $("commandDialog").close());
$("chooseFolder").addEventListener("click", () => browse("directory", true));
$("chooseManifest").addEventListener("click", () => browse("manifest", true));
$("browsePath").addEventListener("click", () => browse($("importKind").value));
$("zoomIn").addEventListener("click", () => waveformView.zoom(2));
$("zoomOut").addEventListener("click", () => waveformView.zoom(0.5));
$("fitRange").addEventListener("click", () => waveformView.fit());
$("wavePan").addEventListener("input", () =>
  waveformView.pan(Number($("wavePan").value)),
);
$("cancelImport").addEventListener("click", async () => {
  try {
    job = await post("/api/cancel-import", { id: job.id });
    renderJob();
  } catch (error) {
    notice(errorText(error, language));
  }
});
$("rescan").addEventListener("click", async () => {
  if (busy || importing() || !(await discardAllowed())) return;
  try {
    job = await post("/api/rescan", {});
    renderJob();
    pollTimer = setTimeout(poll, 200);
  } catch (error) {
    notice(errorText(error, language));
  }
});
$("language").addEventListener("change", () => {
  language = $("language").value;
  try {
    localStorage.setItem("ard-language", language);
  } catch {}
  notice();
  translate();
  if ($("historyPanel").open) loadHistory();
});
$("refresh").addEventListener("click", () => refresh());
$("retryLoad").addEventListener("click", () => refresh(true));
$("keepEditing").addEventListener("click", () =>
  closeDialog($("discardDialog"), "keep"),
);
$("discardChanges").addEventListener("click", () =>
  closeDialog($("discardDialog"), "discard"),
);
$("discardDialog").addEventListener("close", () => {
  const resolve = discardResolver;
  discardResolver = null;
  if (resolve) resolve($("discardDialog").returnValue === "discard");
});
$("discardDialog").addEventListener("cancel", () => {
  $("discardDialog").returnValue = "keep";
});
for (const button of document.querySelectorAll("[data-queue-filter]"))
  button.addEventListener("click", () => {
    $("filter").value =
      $("filter").value === button.dataset.queueFilter
        ? "all"
        : button.dataset.queueFilter;
    renderQueue();
    if (selected) renderDetails(false);
  });
for (const id of ["clearFilters", "showAllAudio"])
  $(id).addEventListener("click", () => {
    $("search").value = "";
    $("filter").value = "all";
    renderQueue();
    if (selected) renderDetails(false);
    $("search").focus();
  });
$("reopenLast").addEventListener("click", () => {
  if (selected) renderDetails(false);
});
for (const id of ["search", "filter", "sort"])
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    renderQueue();
    if (selected) renderDetails(false);
  });
$("selectAll").addEventListener("change", () => {
  for (const item of visibleItems()) {
    if ($("selectAll").checked) selectedKeys.add(item.key);
    else selectedKeys.delete(item.key);
  }
  renderQueue();
});
for (const [id, direction] of [
  ["previous", -1],
  ["next", 1],
])
  $(id).addEventListener("click", () => {
    const list = visibleItems(),
      index = list.findIndex((item) => item.key === selected?.key),
      target = list[index + direction];
    if (target) select(target);
  });
$("variantA").addEventListener("click", () => switchVariant("a"));
$("variantB").addEventListener("click", () => switchVariant("b"));
$("markIn").addEventListener("click", () => markBoundary("start"));
$("markOut").addEventListener("click", () => markBoundary("end"));
$("resetRange").addEventListener("click", () => {
  $("trimStart").value = "";
  $("trimEnd").value = "";
  markDirty();
});
$("speed").addEventListener("change", () => {
  player.playbackRate = Number($("speed").value);
  listeningMemory?.preferences({ speed: player.playbackRate });
});
$("loop").addEventListener("change", () =>
  listeningMemory?.preferences({ loop: $("loop").checked }),
);
$("volume").addEventListener("change", () =>
  listeningMemory?.preferences({ volume: player.volume }),
);
$("rememberPosition").addEventListener("change", () =>
  listeningMemory?.preferences({ remember: $("rememberPosition").checked }),
);
function rememberPosition() {
  if (selected?.quality.decoded && player.readyState >= 1)
    listeningMemory?.position(selected.key, player.currentTime);
}
player.addEventListener("timeupdate", () => {
  if (Date.now() - persistedAt > 1500) {
    rememberPosition();
    persistedAt = Date.now();
  }
});
player.addEventListener("pause", rememberPosition);
window.addEventListener("pagehide", rememberPosition);
player.addEventListener("play", () => {
  player.playbackRate = Number($("speed").value);
  const [start, end] = range();
  if (
    $("loop").checked &&
    (player.currentTime < start || player.currentTime >= end)
  )
    player.currentTime = start;
});
player.addEventListener("error", () => {
  if (selected?.quality.decoded) notice(t("audioError"));
});
$("historyPanel").addEventListener("toggle", loadHistory);
window.addEventListener("resize", () => {
  if (!matchMedia("(max-width:720px)").matches) closeSettings();
  drawWave();
  syncGlider(true);
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function closeSettings() {
  document.body.classList.remove("settings-open");
  $("openSettings").setAttribute("aria-expanded", "false");
}
$("openSettings").addEventListener("click", () => {
  const open = document.body.classList.toggle("settings-open");
  $("openSettings").setAttribute("aria-expanded", String(open));
  if (open) {
    reveal($("settingsPanel"), "menu");
    $("theme").focus();
  }
});
$("settingsPanel").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeSettings();
    $("openSettings").focus();
  }
});
document.addEventListener("click", (event) => {
  if (
    !$("settingsPanel").contains(event.target) &&
    !$("openSettings").contains(event.target) &&
    !event.target.closest("dialog")
  )
    closeSettings();
  if (!$("exportMenu").contains(event.target)) $("exportMenu").open = false;
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (
      !$("importDialog").open &&
      !$("discardDialog").open &&
      !$("helpDialog").open
    )
      $("commandDialog").open ? $("commandDialog").close() : commandMenu.open();
    return;
  }
  if (
    $("importDialog").open ||
    $("discardDialog").open ||
    $("helpDialog").open ||
    $("commandDialog").open
  )
    return;
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    save(false);
    return;
  }
  if (
    event.target.closest("input,textarea,select") ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    busy
  )
    return;
  if (event.key === "?") {
    event.preventDefault();
    openDialog($("helpDialog"));
    return;
  }
  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    markersView.focus();
    return;
  }
  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    $("focusMode").click();
    return;
  }
  if (event.code === "Space") {
    if (event.target.closest("button,a,summary")) return;
    event.preventDefault();
    if (selected?.quality.decoded) {
      if (player.paused) {
        const [start, end] = range();
        if (
          $("loop").checked &&
          (player.currentTime < start || player.currentTime >= end)
        )
          player.currentTime = start;
        player.play().catch((error) => notice(errorText(error, language)));
      } else player.pause();
    }
  }
  if (event.key.toLowerCase() === "b")
    switchVariant(variant === "a" ? "b" : "a");
  if (["j", "k"].includes(event.key.toLowerCase()))
    $(event.key.toLowerCase() === "j" ? "next" : "previous").click();
  if (event.code === "BracketLeft") markBoundary("start");
  if (event.code === "BracketRight") markBoundary("end");
  if (["1", "2", "3", "4"].includes(event.key)) {
    const input = document.querySelector(
      `input[name=decision][value=${["pass", "fix", "exclude", "pending"][Number(event.key) - 1]}]`,
    );
    if (input && !input.disabled) {
      input.checked = true;
      markDirty();
    }
  }
});
let theme = "light";
function updateLibraryToggle() {
  const collapsed = document.body.classList.contains(
    "mobile-library-collapsed",
  );
  $("toggleLibrary").setAttribute("aria-expanded", String(!collapsed));
  $("toggleLibrary").setAttribute(
    "aria-label",
    t(collapsed ? "expandLibrary" : "collapseLibrary"),
  );
}
$("toggleLibrary").addEventListener("click", () => {
  document.body.classList.toggle("mobile-library-collapsed");
  updateLibraryToggle();
  if (!document.body.classList.contains("mobile-library-collapsed"))
    reveal($("items"));
});
try {
  theme = localStorage.getItem("ard-theme") || theme;
} catch {}
document.documentElement.dataset.theme = theme;
$("theme").setAttribute("aria-pressed", String(theme === "dark"));
$("theme").addEventListener("click", () => {
  theme = theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  $("theme").setAttribute("aria-pressed", String(theme === "dark"));
  try {
    localStorage.setItem("ard-theme", theme);
  } catch {}
  drawWave();
});
$("focusMode").addEventListener("click", () => {
  const focused = document.body.classList.toggle("focus-mode");
  $("focusMode").setAttribute("aria-pressed", String(focused));
  requestAnimationFrame(() => {
    drawWave();
    syncGlider(true);
  });
});
for (const id of ["openHelp", "shortcuts"])
  $(id).addEventListener("click", () => openDialog($("helpDialog")));
$("closeHelp").addEventListener("click", () => closeDialog($("helpDialog")));
$("exportMenu").addEventListener("toggle", () => {
  if ($("exportMenu").open) reveal(document.querySelector(".menu"), "menu");
});
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("cancel", (event) => {
    if (dialog.id === "commandDialog") return;
    event.preventDefault();
    closeDialog(dialog, dialog.id === "discardDialog" ? "keep" : "");
  });
const checkVersion = async () => {
  try {
    const result = await request("/api/version");
    $("updateNotice").hidden = result.version === "0.11.1";
  } catch {}
};
window.addEventListener("focus", checkVersion);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkVersion();
});
$("reloadApp").addEventListener("click", async () => {
  if (await discardAllowed()) location.reload();
});
translate();
refresh(true).then(() => {
  syncGlider(true);
  poll(true);
  checkVersion();
});
