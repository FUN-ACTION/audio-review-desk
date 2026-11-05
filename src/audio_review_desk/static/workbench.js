import { stripMarkerText } from "./marker-text.js";
import { words } from "./copy.js";
import { springValue, reveal, openDialog, closeDialog } from "./motion.js";
import { mountWaveform } from "./waveform.js";
import { createWaveformReader } from "./waveform-reader.js";
import { mountTransport } from "./transport.js";
import { mountMarkers, formatMarkerTime } from "./markers.js";
import { mountCommands } from "./commands.js";
import { errorText } from "./errors.js";
import { createListeningMemory, resumedTime } from "./listening.js";
import { auditionBounds, quietRange, createAudition } from "./audition.js";
import { mountSpectrogram } from "./spectrogram.js";
import { createTrimEditor } from "./trim.js";
import { createMediaSession } from "./media-session.js";
import { createJobPoller } from "./job-poller.js";
import { readWithRecovery } from "./read-recovery.js";
import { readOnce } from "./read-once.js";
import { createDraftRecovery } from "./draft-recovery.js";
import { createDraftSession } from "./draft-session.js";
import {
  formatTime,
  hasItemWarnings,
  filterItems,
  sortItems,
  reviewPayload,
  playbackRange,
  searchText,
  searchTerms,
  reviewSearchContext,
  sameReview,
  queueStamp,
  continueQueue,
  nextPendingItem,
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
  historyGeneration = 0,
  refreshGeneration = 0,
  refreshController = null,
  refreshRead = null,
  pendingCompletion = null,
  suspendedCompletion = null,
  job = null,
  handledJob = null;
const selectedKeys = new Set(),
  player = $("player");
const savedThisSession = new Set();
let spectrumVisible = false;
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
const precise = (seconds) =>
  `${formatTime(seconds)}.${Math.floor(((seconds || 0) % 1) * 1000)
    .toString()
    .padStart(3, "0")}`;
const number = (value) => (value.trim() === "" ? null : Number(value));
const media = createMediaSession({
  player,
  playbackRate: () => Number($("speed").value),
  onChange: () => { transport.refresh(); transport.render(); },
  onError: (error) => notice(errorText(error, language)),
});
const trimEditor = createTrimEditor({
  start: $("trimStart"),
  end: $("trimEnd"),
  duration: () => selected?.quality.duration || 0,
  onChange: markDirty,
});

let markersView,
  listeningMemory,
  persistedAt = 0;
let queueHasPosition = false,
  renderedQueueStamp = "",
  highlightedKey = null;
const queueRows = new Map();
let visibleCache = null;
let noticeTimer,
  noticeResolver = null,
  choosing = false;
const spectrumView = mountSpectrogram({ canvas: $("spectrogram"), status: $("analysisStatus"), language, alignWaveform: true });
const audition = createAudition({
  player,
  loop: $("loop"),
  onChange(kind) {
    for (const [id, value] of [["auditionStart", "start"], ["auditionEnd", "end"], ["auditionSelection", "selection"]])
      $(id).setAttribute("aria-pressed", String(kind === value));
  },
  onError: () => notice(() => t("audioError")),
  onRangeUnavailable: () => notice(() => t("auditionUnavailable")),
});
// A manual transport action ends the temporary audition window immediately.
for (const id of ["play", "skipBack", "skipForward"])
  $(id).addEventListener("click", () => audition.cancel());
$("seek").addEventListener("pointerdown", () => audition.cancel());
$("seek").addEventListener("input", () => audition.cancel());
const waveformView = mountWaveform(
  $("waveform"),
  $("seek"),
  $("waveSelection"),
  $("playhead"),
  {
    start: $("trimStartHandle"),
    end: $("trimEndHandle"),
    pan: $("wavePan"),
    onEdit(start, end, side) {
      if (busy || !selected?.quality.decoded) return;
      audition.cancel();
      // The opposite form field may intentionally be blank or invalid. Never
      // replace it with the waveform's safe listening fallback.
      trimEditor.boundary(side, side === "start" ? start : end);
    },
    onView(start, end, zoom) {
      markersView?.view(start, end);
      spectrumView.setView({ start, end, duration: selected?.quality.duration || 0 });
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
  media,
  button: $("play"),
  seek: $("seek"),
  back: $("skipBack"),
  forward: $("skipForward"),
  volume: $("volume"),
  range,
  loop: $("loop"),
  onTime: updateTime,
  onError: () => notice(() => t("audioError")),
  onRangeUnavailable: () => notice(() => t("loopUnavailable")),
  labels: () => ({ play: t("play"), pause: t("pause") }),
});
markersView = mountMarkers({
  input: $("markerText"),
  add: $("addMarker"),
  list: $("markerList"),
  ticks: $("markerTicks"),
  player: media,
  duration: () => selected?.quality.duration || 0,
  t,
  onSeek: () => audition.cancel(),
  onChange: markDirty,
  onError: (message) => notice(message),
});
const draftSession = createDraftSession({
  createStore: workspaceId => createDraftRecovery({
    storage: () => sessionStorage, workspaceId,
  }),
  current: () => ({ workspaceId: state?.workspace_id, key: selected?.key,
    review: selected?.review, dirty, busy, selectionTurn: generation,
    refreshTurn: refreshGeneration, historyTurn: historyGeneration }),
  capture: () => {
    // Native number inputs can hide incomplete text from .value. Do not claim
    // to protect content the browser has not exposed to this page.
    if (["score", "trimStart", "trimEnd"].some(id => $(id).validity?.badInput))
      throw new Error("draft_input_unavailable");
    const { markers, ...form } = draftValues();
    return { form, markers: markersView.snapshot() };
  },
  apply: applyReloadDraft,
  canApply: canApplyReloadDraft,
  confirmDiscard: current => discardAllowed(current, { reset: false }),
  onChange: renderDraftRecovery,
});
async function goToNextPending() {
  if (busy) return;
  const item = nextPendingItem(state?.items || [], selected?.key);
  if (!item) {
    notice(t("noPending"), true);
    return;
  }
  const origin = $("nextPending"), ownedFocus = document.activeElement === origin;
  let focusMoved = false;
  const observeFocus = (event) => {
    if (event.target !== origin && event.target !== document.body &&
        !$("discardDialog").contains(event.target)) focusMoved = true;
  };
  const stopTracking = () => document.removeEventListener("focusin", observeFocus);
  if (ownedFocus) document.addEventListener("focusin", observeFocus);
  try {
    await select(item, { onSelected: () => {
      stopTracking();
      const heading = $("clipTitle");
      if (ownedFocus && !focusMoved && origin.isConnected &&
          (origin.disabled || !origin.getClientRects().length) &&
          document.activeElement === document.body && heading.isConnected &&
          !heading.disabled && heading.getClientRects().length)
        heading.focus({ preventScroll: true });
    } });
  } finally {
    stopTracking();
  }
}
const commandMenu = mountCommands({
  dialog: $("commandDialog"),
  input: $("commandInput"),
  list: $("commandList"),
  emptyStatus: $("commandEmptyStatus"),
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
        { label: t("focusMarker"), hint: "M", run: () => markersView.focus() },
        {
          label: t(media.paused ? "play" : "pause"),
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
          run: goToNextPending,
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
        run: () => {
          if (busy) return;
          // The palette can stay open while an import refreshes the catalog.
          // Resolve at activation, before asking to discard any current draft.
          const current = state.items.find(row => row.key === item.key);
          if (current) return select(current);
          notice(t("commandUnavailable"));
        },
      })),
    ];
  },
});
function notice(message = "", success = false) {
  const turn = ++noticeGeneration;
  clearTimeout(noticeTimer);
  noticeResolver = typeof message === "function" ? message : null;
  const text = noticeResolver ? noticeResolver() : message;
  $("notice").textContent = text;
  $("notice").hidden = !text;
  $("notice").classList.toggle("success", success);
  if (text) reveal($("notice"));
  if (text && success && turn === noticeGeneration)
    noticeTimer = setTimeout(() => {
      if (turn !== noticeGeneration) return;
      // Natural expiry is not a new user/operation notification. A request
      // already in flight retains its right to report its own outcome.
      noticeTimer = null;
      noticeResolver = null;
      $("notice").textContent = "";
      $("notice").hidden = true;
      $("notice").classList.toggle("success", false);
    }, 3200);
}
async function request(path, options = {}) {
  let response, result;
  try {
    const read = async (settings) => {
      const response = await fetch(path, settings);
      return { response, result: await response.json() };
    };
    // Writes retain their original lifecycle: a transport deadline cannot tell
    // whether a mutation committed. Only read-only requests get this bound.
    ({ response, result } = (options.method || "GET").toUpperCase() === "GET"
      ? await readOnce({ read: ({ signal }) => read({ ...options, signal }), signal: options.signal })
      : await read(options));
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
async function discardAllowed(current = () => true, { reset = true } = {}) {
  if (!current()) return false;
  if (!dirty) return true;
  if (discardResolver) return false;
  const allowed = await new Promise((resolve) => {
    discardResolver = resolve;
    openDialog($("discardDialog"));
    $("keepEditing").focus();
  });
  if (allowed && current()) {
    if (reset) {
      draftSession?.discardCurrent();
      dirty = false;
      if (selected) renderDetails(true);
    }
    return true;
  }
  return false;
}
const importing = () => job && ["running", "cancelling"].includes(job.state);

function translate() {
  const completed = !$("queueComplete").hidden;
  const completionFocus = completed && document.activeElement &&
    $("queueComplete").contains(document.activeElement) ? document.activeElement : null;
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  spectrumView.setLanguage(language);
  $("sessionCard").setAttribute("aria-label", t("sessionOverview"));
  if (!$("importError").hidden && $("importError").dataset.code)
    $("importError").textContent = errorText(
      { code: $("importError").dataset.code },
      language,
    );
  if ($("importPreviousStatus").dataset.result) {
    const code = $("importPreviousStatus").dataset.code;
    $("importPreviousStatus").textContent = code
      ? `${t("importEarlierFailed")} ${errorText({ code }, language)}`
      : t("importEarlierStarted");
  }
  paintRescanReceipt();
  const receipt = $("importSubmissionReceipt");
  if (receipt.dataset.result) {
    $("importSubmissionReceiptText").textContent = receipt.dataset.result === "failed"
      ? `${t("importReceiptFailed")} ${errorText({ code: receipt.dataset.code }, language)}`
      : t("importReceiptStarted");
  }
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
  if (completed) {
    showCompletion();
    // Detail translation temporarily hides completion. Recover only the same
    // still-usable completion control if that redraw displaced its focus.
    if (completionFocus?.isConnected && !completionFocus.disabled &&
        document.activeElement === document.body && completionFocus.getClientRects().length)
      completionFocus.focus({ preventScroll: true });
  }
  if (job) renderJob();
  markersView?.refresh(busy || !selected?.quality.decoded);
  transport.refresh();
  if ($("commandDialog").open) commandMenu.refresh();
  updateLibraryToggle();
  draftSession?.refresh();
  // Reword only the current localized notice; preserve its ownership and timer.
  if (noticeResolver) $("notice").textContent = noticeResolver();
  renderExportScope();
  validateNote();
}
function renderExportScope() {
  const key = savingReview ? "exportScopeSaving" : dirty ? "exportScopeDraft" : "exportScopeSaved";
  const message = t(key), hint = $("exportScope");
  if (hint.textContent !== message) hint.textContent = message;
}
function paintRescanReceipt() {
  const outcome = $("rescanSubmissionReceipt").dataset.outcome;
  const text = outcome ? t(outcome === "accepted" ? "rescanReceiptAccepted" : "rescanReceiptUnconfirmed") : "";
  for (const id of ["rescanSubmissionReceipt", "rescanSubmissionReceiptDialog"]) {
    $(id).hidden = !outcome;
    $(id + "Text").textContent = text;
  }
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
  renderExportScope();
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
  $("sessionCard").hidden = stats.files === 0;
  $("sessionSavedCount").textContent = state.items.filter(item => savedThisSession.has(item.key)).length;
  $("sessionPendingCount").textContent = stats.review_counts.pending;
  $("sessionApprovedTime").textContent = formatTime(stats.human_approved_seconds);
  $("nextPending").disabled = busy || !state.items.some(item => item.key !== selected?.key && item.review.status === "pending");
  $("pendingCount").textContent = stats.review_counts.pending;
  $("approvedCount").textContent = stats.review_counts.pass;
  $("flagCount").textContent = stats.warnings + stats.errors;
  $("candidateTime").textContent = formatTime(stats.candidate_seconds);
  $("approvedTime").textContent = formatTime(stats.human_approved_seconds);
  $("version").textContent = state.version || "0.13.0";
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
    $(id).disabled = choosing || importSubmitting || rescanSubmitting || busy || Boolean(importing());
  $("rescan").disabled = !state.can_rescan || choosing || importSubmitting || rescanSubmitting || busy || Boolean(importing());
  $("openImport").disabled = rescanSubmitting || busy || Boolean(importing());
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
  $("applyBatch").disabled = busy || !selectedKeys.size || selectedKeys.size > 500;
  $("clearSelection").disabled = busy || !selectedKeys.size;
  $("batchStatus").disabled = busy;
  const hidden = selectedKeys.size - count;
  const hint = [
    hidden ? t("selectionHidden").replace("{count}", hidden) : "",
    selectedKeys.size > 500 ? t("selectionLimit") : "",
  ].filter(Boolean).join(" ");
  $("batchSelectionHint").textContent = hint;
  $("batchSelectionHint").hidden = !hint;
}
function clearSelection() {
  if (busy || !selectedKeys.size) return;
  const restoreFocus = document.activeElement === $("clearSelection");
  selectedKeys.clear();
  renderQueue();
  // The batch bar disappears. Keep a keyboard user in the queue controls.
  if (restoreFocus)
    ($("selectAll").disabled ? $("search") : $("selectAll")).focus({ preventScroll: true });
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
  const query = $("search").value;
  const contexts = new Map(list.map(item => [item.key, reviewSearchContext(item, query)]));
  // Equal result keys do not imply equal search explanations. Include the
  // canonical query and the displayed saved content, even at the same version.
  const stamp = JSON.stringify([queueStamp(list, language), searchTerms(query), [...contexts]]);
  if (stamp !== renderedQueueStamp) {
    renderedQueueStamp = stamp;
    const origin = document.activeElement;
    let focusedRow = null, focusMoved = false;
    for (const [key, row] of queueRows) {
      for (const selector of [".clip", "input"])
        if (origin?.isConnected && row.querySelector(selector) === origin)
          focusedRow = { key, selector };
    }
    const observeFocus = (event) => {
      if (event.target !== origin && event.target !== document.body) focusMoved = true;
    };
    if (focusedRow) document.addEventListener("focusin", observeFocus);
    try {
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
          duration.textContent = formatTime(item.quality.duration);
          if (hasItemWarnings(item)) {
            const indicator = document.createElement("span"), attention = document.createElement("span");
            indicator.textContent = " · !";
            indicator.setAttribute("aria-hidden", "true");
            attention.className = "sr-only";
            attention.textContent = ` · ${t("flags")}`;
            duration.append(indicator, attention);
          }
          status.textContent = t(item.review.status);
          status.className = `status-${item.review.status}`;
          meta.append(duration, status);
          button.append(name, meta);
          const context = contexts.get(item.key);
          if (context) {
            row.classList.add("has-search-context");
            const summary = document.createElement("span"), source = document.createElement("span"),
              excerpt = document.createElement("span");
            summary.className = "clip-search-context";
            source.className = "clip-search-source";
            source.textContent = context.kind === "marker"
              ? `${t("matchedTimeNote")} ${formatMarkerTime(context.time)} · `
              : `${t("matchedReviewNote")} · `;
            excerpt.className = "clip-search-excerpt";
            excerpt.setAttribute("dir", "auto");
            excerpt.textContent = context.excerpt;
            summary.append(source, excerpt);
            button.append(summary);
          }
          button.addEventListener("click", () => select(item));
          row.append(checkbox, button);
          return row;
        }),
      );
    } finally {
      if (focusedRow) document.removeEventListener("focusin", observeFocus);
    }
    if (focusedRow && !focusMoved && document.activeElement === document.body) {
      const matching = queueRows.get(focusedRow.key)?.querySelector(focusedRow.selector);
      const target = [matching, $("search"), $("openCommands")].find(node =>
        node?.isConnected && !node.disabled && node.getClientRects().length);
      target?.focus({ preventScroll: true });
    }
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
function canApplyReloadDraft(record) {
  if (!selected || !markersView.canRestore(record.markers)) return false;
  if (!selected.quality.decoded && (record.form.status === "pass" ||
      ["score", "trimStart", "trimEnd"].some(key => record.form[key].trim() !== "") ||
      record.markers.rows.length || record.markers.input !== "" || record.markers.editing)) return false;
  return true;
}
function applyReloadDraft(record) {
  if (!canApplyReloadDraft(record) || !markersView.restore(record.markers, busy || !selected.quality.decoded)) return false;
  const form = record.form;
  document.querySelectorAll("input[name=decision]").forEach(input => {
    input.checked = input.value === form.status;
  });
  for (const id of ["score", "trimStart", "trimEnd"]) {
    $(id).setCustomValidity("");
    $(id).value = form[id];
  }
  $("note").value = form.note;
  $("issues").querySelectorAll("input").forEach(input => {
    input.checked = form.issues.includes(input.value);
  });
  audition.cancel();
  markDirty();
  renderDetails(false);
  return true;
}
function renderDraftRecovery(view) {
  const record = view.record, panel = $("draftRecovery"), compact = $("draftProtection");
  const protectedDraft = Boolean(view.protected);
  compact.hidden = !protectedDraft;
  if (!protectedDraft) compact.open = false;
  const shortStatus = protectedDraft ? t("recoveryProtectedShort") : "";
  if ($("draftProtectionStatus").textContent !== shortStatus)
    $("draftProtectionStatus").textContent = shortStatus;
  $("clearProtectedDraft").disabled = busy || view.restoring || !view.canForget;
  if (record && protectedDraft) $("draftProtectionWhen").textContent = new Date(record.updatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en");
  // A successful background copy belongs beside the review state. Only a
  // recovery choice or failure needs the full panel above the listening area.
  panel.hidden = protectedDraft || (!record && !["unavailable", "invalid"].includes(view.status));
  if (panel.hidden) {
    if ($("draftRecoveryText").textContent) $("draftRecoveryText").textContent = "";
    $("draftRecoveryPreview").hidden = true;
    return;
  }
  panel.dataset.state = view.status;
  $("draftRecoveryWhen").hidden = !record;
  if (record) $("draftRecoveryWhen").textContent = new Date(record.updatedAt).toLocaleString(language === "zh" ? "zh-CN" : "en");
  const item = record && state?.items.find(row => row.key === record.key);
  const matching = record && selected?.key === record.key;
  let message;
  if (view.status === "unavailable") message = t("recoveryUnavailable");
  else if (view.status === "invalid") message = t(view.owned ? "recoveryUnavailable" : "recoveryInvalid");
  else if (view.protected) message = t("recoveryProtected");
  else if (!item) message = t("recoveryMissing");
  else if (!matching) message = t("recoveryOther").replace("{label}", item.label);
  else if (view.reason === "incompatible") message = t("recoveryIncompatible");
  else if (!view.canRestore && !busy && !view.restoring) message = t("recoveryStale");
  else message = t("recoveryAvailable");
  if (record && !view.owned && dirty) message += ` ${t("recoveryWaiting")}`;
  if ($("draftRecoveryText").textContent !== message) $("draftRecoveryText").textContent = message;
  $("restoreDraft").hidden = !record || view.owned || !matching;
  $("restoreDraft").disabled = !view.canRestore || busy || view.restoring;
  $("locateDraft").hidden = !record || !item || matching;
  $("locateDraft").disabled = busy || view.restoring;
  $("discardDraft").disabled = busy || view.restoring || !view.canForget;
  $("draftRecoveryPreview").hidden = !record || view.protected;
  if (record && !view.protected) {
    const { form, markers } = record;
    const lines = [`${t("versionLabel")}: ${record.baseline.version}`, t(form.status),
      `${t("score")}: ${form.score}`, `${t("range")}: ${form.trimStart} – ${form.trimEnd}`,
      `${t("issues")}: ${form.issues.map(value => t(value)).join(" · ")}`, form.note,
      ...markers.rows.map(row => `${row.time} s · ${row.text}`)];
    if (markers.input) lines.push(`${t("recoveryMarkerInput")}: ${markers.input}`);
    if (markers.editing) lines.push(`${t("recoveryMarkerEdit")}: ${markers.editing.time} · ${markers.editing.text}`);
    const preview = lines.join("\n");
    if ($("draftRecoveryContent").textContent !== preview) $("draftRecoveryContent").textContent = preview;
  }
}
function markDirty() {
  validateNote();
  updateIssueCount();
  renderSelectedDuration();
  if (!busy && selected) {
    invalidateRefresh();
    dirty =
      !sameReview(reviewPayload(selected, draftValues()), selected.review) ||
      markersView.hasChanges(selected.review.markers) ||
      // Associated trim inputs live outside the form's descendant tree. Their
      // hidden partial number text must still count as unsaved work.
      ["score", "trimStart", "trimEnd"].some(id => $(id).validity?.badInput) ||
      Boolean($("reviewForm").querySelector(":invalid"));
    const saveState = dirty
      ? t("unsaved")
      : selected.review.version
        ? t("saved")
        : t("notReviewed");
    if ($("saveState").textContent !== saveState) $("saveState").textContent = saveState;
    if (["trimStart", "trimEnd"].includes(document.activeElement?.id))
      drawWave();
    draftSession?.changed();
  }
  renderExportScope();
}
function validateNote() {
  // Match Python len for well-formed Unicode text, not UTF-16 units or graphemes.
  const input = $("note");
  let count = 0;
  for (const character of input.value) {
    if (++count > 4000) break;
  }
  const invalid = count > 4000;
  input.setCustomValidity(invalid ? t("noteTooLong") : "");
  input.setAttribute("aria-invalid", String(invalid));
  return !invalid;
}
function selectedDraftRange() {
  const duration = selected?.quality.decoded ? selected.quality.duration : null;
  const startField = $("trimStart"), endField = $("trimEnd");
  const startText = String(startField.value ?? "").trim(), endText = String(endField.value ?? "").trim();
  const start = startText === "" ? 0 : Number(startText);
  const end = endText === "" ? duration : Number(endText);
  // This describes the editor, not playbackRange's forgiving listening fallback.
  // Native number controls can expose incomplete text as an empty value.
  const valid = Number.isFinite(duration) && duration > 0 &&
    !startField.validity?.badInput && !endField.validity?.badInput &&
    Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < end && end <= duration;
  return valid ? [start, end] : null;
}
function renderSelectedDuration() {
  const bounds = selectedDraftRange();
  const seconds = bounds ? bounds[1] - bounds[0] : null;
  const text = seconds === null ? t("selectedDurationUnavailable")
    : seconds < 0.001 ? t("selectedDurationTiny")
    : `${new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en", { maximumFractionDigits: 3 }).format(seconds)} s`;
  if ($("selectedDuration").textContent !== text) $("selectedDuration").textContent = text;
}
function range() {
  return playbackRange(
    selected?.quality.duration || 0,
    number($("trimStart").value),
    number($("trimEnd").value),
  );
}
function updateTime(seconds = media.currentTime || 0, text = true) {
  audition.check(seconds);
  for (const id of ["auditionStart", "auditionEnd", "auditionSelection"])
    $(id).disabled = busy || !selected?.quality.decoded || player.readyState < 1;
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
    (variant === "b" ? selected?.reference_quality : selected?.quality)?.duration,
  );
  waveformView.position(media.currentTime || 0);
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
    ogg_ending_unconfirmed: "oggEndingUnconfirmed",
    ogg_check_incomplete: "oggCheckIncomplete",
    mp3_frame_count_differs: "mp3FrameCountDiffers",
    mp3_check_incomplete: "mp3CheckIncomplete",
    mp4_extent_exceeds_file: "mp4ExtentExceedsFile",
    mp4_check_incomplete: "mp4CheckIncomplete",
    mp4_indexed_audio_bytes_unavailable: "mp4IndexedBytesUnavailable",
  };
  const isContainerAdvisory = flag => ["ogg_ending_unconfirmed", "ogg_check_incomplete", "mp3_frame_count_differs", "mp3_check_incomplete", "mp4_extent_exceeds_file", "mp4_check_incomplete", "mp4_indexed_audio_bytes_unavailable"].includes(flag);
  const advisories = [
    ...q.flags.map(flag => ({ flag, variant: "A" })),
    ...(item.reference_quality?.flags || []).filter(isContainerAdvisory).map(flag => ({ flag, variant: "B" })),
  ];
  const flags = advisories.map(({ flag, variant }) => ({
    text: `${isContainerAdvisory(flag) ? `${variant}: ` : ""}${t(names[flag] || "flagged")}`,
    neutral: flag === "ogg_check_incomplete" || flag === "mp3_check_incomplete" || flag === "mp4_check_incomplete",
  }));
  if (!item.eligible && !item.error) flags.push({ text: t("ineligible") });
  if (item.error) {
    // Keep B advisories visible even when A has a separate decode error.
    flags.splice(0, q.flags.length, {
      text: errorText({ code: item.error_code || "decode_failed" }, language), error: true,
    });
  }
  $("qualityFlags").replaceChildren(
    ...flags.map(({ text, neutral, error }) => {
      const span = document.createElement("span");
      span.className = `flag${error ? " error" : neutral ? " neutral" : ""}`;
      span.textContent = text;
      return span;
    }),
  );
  $("qualityFlags").hidden = !advisories.length && !item.error && item.eligible;
  $("audioSection").hidden = !q.decoded;
  spectrumView.setVisible(spectrumVisible && q.decoded);
  for (const id of ["play", "skipBack", "skipForward", "volume"])
    $(id).disabled = !q.decoded;
  $("seek").disabled = !q.decoded || player.readyState === 0;
  $("rulerMid").textContent = formatTime((q.duration || 0) / 2);
  $("rulerEnd").textContent = formatTime(q.duration || 0);
  $("variantB").disabled = !item.reference_quality || busy;
  for (const button of document.querySelectorAll("[data-marker-preset]")) button.disabled = busy || !q.decoded;
  for (const id of ["auditionStart", "auditionEnd", "auditionSelection", "showSpectrogram", "showWaveform"])
    $(id).disabled = busy || !q.decoded;
  $("suggestRange").disabled = busy || !quietRange(q);
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
  if (restore) restoreReviewFields(review);
  validateNote();
  updateIssueCount();
  for (const id of ["trimStart", "trimEnd"]) $(id).max = q.duration || 0;
  $("trimEnd").placeholder = q.duration?.toFixed(3) || "—";
  renderSelectedDuration();
  $("saveState").textContent = savingReview?.key === item.key
    ? t("saving")
    : dirty
    ? t("unsaved")
    : review.version
      ? t("saved")
      : t("notReviewed");
  renderExportScope();
  const list = visibleItems(),
    index = list.findIndex((row) => row.key === item.key);
  $("previous").disabled = busy || index <= 0;
  $("next").disabled = busy || index < 0 || index >= list.length - 1;
  $("clipPosition").textContent =
    index >= 0 ? `${index + 1} / ${list.length}` : "";
  $("outsideFilter").hidden = index >= 0;
  $("nextPending").disabled = busy || !state.items.some(row => row.key !== item.key && row.review.status === "pending");
  syncGlider();
  updateTime();
  drawWave();
  renderWaveStatus();
  draftSession?.refresh();
}
function restoreReviewFields(review) {
  document.querySelectorAll("input[name=decision]").forEach((input) => {
    input.checked = input.value === review.status;
  });
  $("issuePanel").open = false;
  for (const id of ["score", "trimStart", "trimEnd"])
    $(id).setCustomValidity("");
  markersView.set(review.markers || [], busy || !selected?.quality.decoded);
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
async function select(item, { refreshTurn = null, onSelected = null, revealQueue = true, preserveLibrary = false, preserveNotice = false } = {}) {
  if (busy) return;
  if (refreshTurn === null) {
    const intent = invalidateRefresh();
    // Expired navigation must not clear the draft before its later intent check.
    if (!(await discardAllowed(() => intent === refreshGeneration && !busy)) || intent !== refreshGeneration || busy) return;
  } else if (refreshTurn !== refreshGeneration || dirty) return;
  // A refresh has already checked ownership and draft safety. Its selection
  // applies synchronously, without opening another discard-confirmation gap.
  audition.cancel();
  rememberPosition();
  waveformReader.cancel();
  const turn = ++generation;
  invalidateHistory();
  $("history").textContent = "";
  media.cancel();
  player.pause();
  selected = item;
  try {
    sessionStorage.setItem(
      `ard-current-${state.workspace_id || state.workspace}`,
      item.key,
    );
  } catch {}
  // A same-clip catalog update must not hide queue controls or newer focus.
  // Explicit navigation keeps its existing mobile detail-first behavior.
  if (!preserveLibrary && matchMedia("(max-width:720px)").matches)
    document.body.classList.add("mobile-library-collapsed");
  $("mobileSelection").textContent = item.label;
  updateLibraryToggle();
  dirty = false;
  variant = "a";
  wave = { a: [], b: [] };
  waveStatus = null;
  waveNotice = null;
  spectrumView.setSource(item.quality.decoded ? `/media/${item.key}/a.wav` : null, `${item.key}:a`,
    { retryFailed: refreshTurn === null });
  waveformView.reset();
  if (refreshTurn === null && !preserveNotice) notice();
  renderQueue();
  if (revealQueue) revealQueueSelection();
  renderDetails();
  $("historyPanel").open = false;
  // The new clip is visible before its waveform read settles or fails.
  onSelected?.();
  if (item.quality.decoded) {
    const position = resumedTime(
      listeningMemory?.get() || { remember: false },
      item.key,
      item.quality.duration,
    );
    $("seek").disabled = true;
    media.load({ url: `/media/${item.key}/a.wav`, key: item.key,
      time: position, resume: false, duration: item.quality.duration });
    const loaded = await waveformReader.load({ key: item.key, selection: turn });
    if (!loaded) {
      if (turn === generation && waveStatus?.phase === "error" &&
          (refreshTurn === null || refreshTurn === refreshGeneration)) {
        notice(errorText(waveStatus.error, language));
        waveNotice = { selection: turn, notice: noticeGeneration };
      }
      return false;
    }
  } else {
    player.removeAttribute("src");
    player.load();
  }
  return true;
}
function revealQueueSelection() {
  const items = $("items"), container = items.parentElement;
  // A collapsed mobile/focus-mode library has no scroll viewport to reveal.
  if (!container?.clientHeight) return;
  const row = items.querySelector(".clip-row.selected");
  if (!row) return;
  const viewport = container.getBoundingClientRect(), bounds = row.getBoundingClientRect();
  if (!bounds.height) return;
  const top = viewport.top + container.clientTop, bottom = top + container.clientHeight;
  const delta = bounds.height > container.clientHeight || bounds.top < top
    ? bounds.top - top : bounds.bottom > bottom ? bounds.bottom - bottom : 0;
  const target = Math.max(0, Math.min(container.scrollHeight - container.clientHeight, container.scrollTop + delta));
  if (target !== container.scrollTop) {
    // Scroll only this list, never its ancestors. Instant movement keeps keyboard
    // navigation direct and avoids motion even when page CSS requests smooth scroll.
    container.scrollTo({ top: target, behavior: "instant" });
  }
}
let waveStatus = null, waveNotice = null, noticeGeneration = 0;
const waveformReader = createWaveformReader({
  read: (key, { signal }) => request(`/api/wave/${key}`, { signal }),
  onChange(snapshot) {
    if (snapshot.selection !== generation || snapshot.key !== selected?.key) return;
    waveStatus = snapshot;
    if (snapshot.phase === "ready") {
      wave = snapshot.data;
      drawWave();
      if (waveNotice?.selection === generation && waveNotice.notice === noticeGeneration)
        notice();
      waveNotice = null;
    }
    renderWaveStatus();
  },
});
function renderWaveStatus() {
  const row = $("waveStatus"), text = $("waveStatusText"), retry = $("retryWave");
  row.hidden = spectrumVisible || !selected?.quality.decoded;
  const phase = waveStatus?.phase || "loading";
  const ready = phase === "ready" && Boolean(wave[variant]?.length);
  const key = phase === "ready" ? ready ? "waveReady" : "waveEmpty"
    : phase === "error" ? "waveError" : phase === "interrupted" ? "waveInterrupted" : "waveLoading";
  const label = t(key);
  if (text.textContent !== label) text.textContent = label;
  const ownsFocus = document.activeElement === retry;
  retry.hidden = ready;
  // Keep the native button focused during a retry; its handler enforces this
  // disabled state without a browser's disabled-control blur.
  retry.setAttribute("aria-disabled", String(phase === "loading"));
  if (ready && ownsFocus && !row.hidden && !$("detailPanel").hidden)
    text.focus({ preventScroll: true });
}
function retryWave() {
  if (!selected?.quality.decoded || waveStatus?.phase === "loading") return;
  return waveformReader.load({ key: selected.key, selection: generation });
}
let refreshLoadError = null;
function createFeedbackOwner() {
  let expected = noticeGeneration, revoked = false;
  const owns = () => {
    if (noticeGeneration !== expected) revoked = true;
    return !revoked;
  };
  const publish = (...args) => {
    if (!owns()) return false;
    const next = noticeGeneration + 1;
    notice(...args);
    // A reentrant newer notification must not be adopted as our own.
    if (noticeGeneration !== next) { revoked = true; return false; }
    expected = next;
    return true;
  };
  return { publish, owns,
    clear(resolver) {
      if (!owns() || noticeResolver !== resolver) return false;
      return publish();
    },
  };
}
function invalidateRefresh() {
  refreshGeneration++;
  suspendedCompletion = null;
  const previous = refreshController, reading = refreshRead;
  refreshController = null;
  refreshRead = null;
  const retryResolver = reading?.retryResolver;
  if (reading) reading.retryResolver = null;
  previous?.abort();
  if (retryResolver) reading.feedback.owner.clear(retryResolver);
  return refreshGeneration;
}
async function refresh(force = false, { recover = false, feedback = {} } = {}) {
  if (busy) return false;
  const turn = invalidateRefresh();
  if (!force && !(await discardAllowed())) return false;
  if (turn !== refreshGeneration || busy || dirty) return false;
  feedback.owner ||= createFeedbackOwner();
  const controller = new AbortController();
  const reading = { turn, recover, feedback, retryResolver: null };
  refreshController = controller;
  refreshRead = reading;
  try {
    const previous = selected?.key;
    const read = ({ signal }) => request("/api/state", { signal });
    const next = recover
      ? await readWithRecovery({ read, signal: controller.signal,
          onRetry: () => {
            if (turn === refreshGeneration && feedback.owner.owns()) {
              reading.retryResolver = () => t("jobRefreshing");
              feedback.owner.publish(reading.retryResolver);
            }
          } })
      : await read({ signal: controller.signal });
    if (refreshRead === reading) refreshRead = null;
    // Requests are snapshots, not permission to discard newer user work.
    if (turn !== refreshGeneration || busy || dirty) return false;
    // Clear only feedback still owned by this read or its preceding failure.
    // Do this before selection/waveform work can produce a newer error.
    const oldError = refreshLoadError;
    refreshLoadError = null;
    if (reading.retryResolver) feedback.owner.clear(reading.retryResolver);
    if (oldError && oldError.turn < turn) feedback.owner.clear(oldError.resolver);
    reading.retryResolver = null;
    state = next;
    draftSession?.initialize(state.workspace_id);
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
    waveformView.cancelDrag();
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
    if (item) {
      // Replacement selection is automatic too: do not hide newer queue focus
      // (including a rebuild fallback) behind the mobile collapsed library.
      const libraryOwnsFocus = Boolean(document.activeElement?.closest?.(".library"));
      if (await select(item, { refreshTurn: turn, revealQueue: previous !== item.key,
        preserveLibrary: previous === item.key || libraryOwnsFocus }) === false) return false;
    } else {
      waveformReader.cancel();
      spectrumView.setSource(null, "");
      spectrumView.setVisible(false);
      $("detailPanel").hidden = true;
      $("emptyDetail").hidden = false;
      draftSession?.refresh();
    }
    return turn === refreshGeneration;
  } catch (error) {
    if (turn !== refreshGeneration) return false;
    if (!state) {
      $("bootStatus").querySelector("p").textContent = t("loadError");
      $("retryLoad").hidden = false;
    }
    const resolver = () => errorText(error, language);
    if (feedback.owner.publish(resolver)) refreshLoadError = { turn, resolver };
    return false;
  } finally {
    if (refreshController === controller) refreshController = null;
    if (refreshRead === reading) refreshRead = null;
  }
}
function setBusy(value) {
  if (value) {
    invalidateRefresh();
    invalidateHistory();
  }
  busy = value;
  if (value) waveformView.cancelDrag();
  for (const element of $("reviewForm").elements) element.disabled = value;
  for (const id of ["markIn", "markOut", "resetRange", "previous", "next"])
    $(id).disabled = value;
  if (state) {
    renderSummary();
    renderQueue();
    if (selected) renderDetails(false);
  }
}
// Persistence ownership is separate from busy (also used by Undo and Batch).
let savingReview = null;
async function save(advance = false) {
  if (busy || !selected) return;
  validateNote();
  if (!$("reviewForm").reportValidity()) return;
  const focusBeforeSave = document.activeElement;
  const restoreMarkerFocus = markersView.captureFocus();
  const target = selected,
    ordered = visibleItems();
  if (!markersView.flush()) return;
  const payload = reviewPayload(target, draftValues());
  // Disabling or replacing a focused control can leave focus on the body.
  // A deliberate move elsewhere revokes this save's focus ownership, even
  // if that newer control is subsequently blurred or replaced as well.
  let focusMoved = false;
  const observeFocus = (event) => {
    if (event.target !== focusBeforeSave && event.target !== document.body)
      focusMoved = true;
  };
  const stopTrackingFocus = () =>
    document.removeEventListener("focusin", observeFocus);
  const ownsFocus = () => !focusMoved &&
    (document.activeElement === document.body || document.activeElement === focusBeforeSave);
  const restoreFocus = () => {
    const allowed = ownsFocus();
    stopTrackingFocus();
    if (!allowed) return;
    if (["draftProtectionSummary", "clearProtectedDraft"].includes(focusBeforeSave?.id) &&
        $("draftProtection").hidden) {
      // A keyboard save can remove the disclosure that originally owned focus.
      ($("detailPanel").hidden ? $("search") : $("note")).focus({ preventScroll: true });
      return;
    }
    if (document.activeElement !== document.body) return;
    if (focusBeforeSave?.isConnected && !focusBeforeSave.disabled)
      focusBeforeSave.focus({ preventScroll: true });
    else restoreMarkerFocus?.();
  };
  document.addEventListener("focusin", observeFocus);
  const operation = { key: target.key };
  let feedback;
  savingReview = operation;
  try {
    setBusy(true);
    feedback = createFeedbackOwner();
    $("saveState").textContent = t("saving");
    let success = false, refreshFailed = false;
    try {
      const result = await post("/api/review", payload);
      draftSession?.saved(target.key, payload.expected_version);
      target.review = result.review;
      savedThisSession.add(target.key);
      visibleCache = null;
      dirty = false;
      success = true;
      const local = state.items.find((item) => item.key === target.key);
      if (local) local.review = result.review;
      try {
        state = await request("/api/state");
        feedback.publish(() => t("saved"), true);
      } catch {
        refreshFailed = true;
        feedback.publish(() => t("savedRefresh"));
      }
    } catch (error) {
      dirty = true;
      feedback.publish(() => errorText(error, language));
    } finally {
      // Commit and totals reconciliation have settled before editing unlocks.
      if (savingReview === operation) savingReview = null;
      setBusy(false);
      if (success) renderDetails(false);
      if (!advance || !success) restoreFocus();
    }
    // History is a separate read: do not delay saving or replace its feedback.
    if (!advance || !success) loadHistory();
    if (success && advance) {
      const next = continueQueue(ordered, visibleItems(), target.key);
      if (next) await select(next, {
        preserveNotice: true,
        onSelected() {
          // Automatic advance preserves current feedback. Its waveform may
          // still publish a newer, more specific playback error.
          const allowed = ownsFocus();
          stopTrackingFocus();
          // Normal focus scrolling reveals the new clip in stacked layouts.
          if (allowed) $("clipTitle").focus();
        },
      });
      else if (!refreshFailed && state.stats.review_counts.pending === 0) {
        invalidateHistory();
        $("historyPanel").open = false;
        showCompletion({ focus: ownsFocus() });
      } else {
        restoreFocus();
        loadHistory();
      }
    }
  } finally {
    if (savingReview === operation) savingReview = null;
    stopTrackingFocus();
  }
}

function showCompletion({ focus = false } = {}) {
  // Capture before hiding details can blur the active control. Translation
  // redraws preserve outside focus; save completion passes its own ownership.
  const active = document.activeElement;
  const moveFocus = focus || (active && $("detailPanel").contains(active));
  waveformReader.cancel();
  media.pause();
  spectrumView.setVisible(false);
  $("detailPanel").hidden = true;
  $("queueComplete").hidden = false;
  $("queueCompleteSummary").textContent = t("queueCompleteSummary")
    .replace("{total}", state.stats.files)
    .replace("{approved}", state.stats.review_counts.pass)
    .replace("{duration}", formatTime(state.stats.human_approved_seconds));
  if (moveFocus) $("queueCompleteTitle").focus({ preventScroll: true });
}
async function batch() {
  if (busy || !selectedKeys.size || !(await discardAllowed())) return;
  const changes = state.items
    .filter((item) => selectedKeys.has(item.key))
    .map((item) => ({ key: item.key, expected_version: item.review.version }));
  const focusBeforeBatch = document.activeElement;
  let focusMoved = false, focusTurn;
  const observeFocus = (event) => {
    if (event.target !== focusBeforeBatch && event.target !== document.body)
      focusMoved = true;
  };
  document.addEventListener("focusin", observeFocus);
  dirty = false;
  let count = 0;
  let reconciled = false;
  let feedback;
  try {
    setBusy(true);
    feedback = { owner: createFeedbackOwner() };
    focusTurn = refreshGeneration;
    const status = $("batchStatus").value;
    const result = await post("/api/batch", {
      changes,
      status,
    });
    if (result?.saved !== changes.length)
      throw Object.assign(new Error("Unexpected batch result"), { code: "batch_unconfirmed" });
    count = result.saved;
    const rows = Array.isArray(result.reviews) ? result.reviews : [];
    const reviews = new Map(rows.map(row => [row?.key, row?.review]));
    const optionalNumber = value => value === null || (typeof value === "number" && Number.isFinite(value));
    const validReview = (review, version) => review && !Array.isArray(review) &&
      review.status === status && Number.isSafeInteger(review.version) && review.version > version &&
      typeof review.updated_utc === "string" && review.updated_utc.length > 0 && review.origin === "batch_ui" &&
      optionalNumber(review.score) && (review.score === null || (review.score >= 0 && review.score <= 10)) &&
      optionalNumber(review.trim_start) && optionalNumber(review.trim_end) && typeof review.note === "string" &&
      Array.isArray(review.issues) && review.issues.every(issue => typeof issue === "string") &&
      Array.isArray(review.markers) && review.markers.every(marker => marker &&
        typeof marker.time === "number" && Number.isFinite(marker.time) && marker.time >= 0 && typeof marker.text === "string");
    reconciled = rows.length === changes.length && reviews.size === changes.length &&
      changes.every(change => validReview(reviews.get(change.key), change.expected_version));
    if (reconciled) {
      // These records belong to the committed transaction. Keep both catalog
      // and detached selection objects usable before editing is unlocked.
      for (const item of state.items)
        if (reviews.has(item.key)) item.review = reviews.get(item.key);
      if (selected && reviews.has(selected.key)) selected.review = reviews.get(selected.key);
      visibleCache = null;
      if (selected && reviews.has(selected.key)) renderDetails();
    }
    for (const change of changes) {
      savedThisSession.add(change.key);
      selectedKeys.delete(change.key);
    }
  } catch (error) {
    feedback.owner.publish(() => errorText(error, language));
  } finally {
    try {
      setBusy(false);
    } finally {
      document.removeEventListener("focusin", observeFocus);
    }
    // Finish focus recovery before the independent catalog refresh. A newer
    // focus intent, even followed by blur, belongs to the user rather than us.
    if (!focusMoved && !busy && refreshGeneration === focusTurn &&
        document.activeElement === document.body && focusBeforeBatch?.isConnected) {
      const usable = (node) => node?.isConnected && !node.disabled && node.getClientRects().length;
      const target = count && $("batchBar").hidden && $("batchBar").contains(focusBeforeBatch)
        ? [$("selectAll"), $("search")].find(usable) : focusBeforeBatch;
      if (usable(target)) target.focus({ preventScroll: true });
    }
  }
  if (count) {
    const previousState = state;
    const refreshing = refresh(true, { feedback }), turn = refreshGeneration;
    const refreshed = await refreshing;
    if (turn !== refreshGeneration || busy || dirty) return;
    if (!refreshed) {
      loadHistory();
      // A successful catalog followed by a waveform error keeps that error.
      // Count-only older servers require a stronger warning when the read fails.
      if (state === previousState) feedback.owner.publish(() => t(reconciled ? "batchRefresh" : "batchReviewRefresh"));
    } else feedback.owner.publish(
      () => `${count} ${language === "en" && count === 1 ? "review updated" : t("batchSaved")}`, true,
    );
  } else loadHistory();
}
async function undo() {
  if (busy || !selected || !(await discardAllowed())) return;
  const target = selected, focusBeforeUndo = document.activeElement;
  let focusMoved = false;
  const observeFocus = (event) => {
    if (event.target !== focusBeforeUndo && event.target !== document.body)
      focusMoved = true;
  };
  document.addEventListener("focusin", observeFocus);
  let success = false, focusTurn;
  let feedback;
  try {
    setBusy(true);
    feedback = { owner: createFeedbackOwner() };
    focusTurn = refreshGeneration;
    const result = await post("/api/undo", {
      key: target.key,
      expected_version: target.review.version,
    });
    // The undo response is the committed review. Keep it usable even if the
    // separate catalog/totals read fails, including after a prior save detached
    // the selected object from the latest catalog.
    target.review = result.review;
    const local = state.items.find((item) => item.key === target.key);
    if (local) local.review = result.review;
    visibleCache = null;
    savedThisSession.add(target.key);
    dirty = false;
    renderDetails();
    success = true;
  } catch (error) {
    feedback.owner.publish(() => errorText(error, language));
  } finally {
    try {
      setBusy(false);
    } finally {
      document.removeEventListener("focusin", observeFocus);
    }
    // Restore at mutation completion, before the independent refresh. Later
    // reads or operations must never reclaim focus from the user's next action.
    if (!focusMoved && selected === target && !busy && refreshGeneration === focusTurn &&
        document.activeElement === document.body && focusBeforeUndo?.isConnected &&
        !focusBeforeUndo.disabled)
      focusBeforeUndo.focus({ preventScroll: true });
  }
  if (success) {
    const previousState = state;
    const refreshing = refresh(true, { feedback }), turn = refreshGeneration;
    const refreshed = await refreshing;
    // Edits, navigation and newer reads/writes own their own feedback. A
    // waveform failure after the catalog applied also keeps its specific error.
    if (turn !== refreshGeneration || busy || dirty) return;
    if (!refreshed) {
      loadHistory();
      if (state === previousState) feedback.owner.publish(() => t("undoRefresh"));
    } else feedback.owner.publish(() => t("undoSaved"), true);
  } else loadHistory();
}
async function switchVariant(next) {
  if (
    !selected?.quality.decoded ||
    next === variant ||
    (next === "b" && !selected.reference_quality)
  )
    return;
  audition.cancel();
  variant = next;
  const url = `/media/${selected.key}/${variant}.wav`;
  spectrumView.setSource(url, `${selected.key}:${variant}`);
  $("seek").disabled = true;
  media.load({ url, key: selected.key,
    duration: (variant === "b" ? selected.reference_quality : selected.quality)?.duration });
  renderDetails(false);
  updateTime();
}
function showImportError(error) {
  $("importError").dataset.code = error.code || "operation_failed";
  $("importError").textContent = errorText(error, language);
  $("importError").hidden = false;
}
function clearPreviousImportResult() {
  const status = $("importPreviousStatus");
  status.dataset.result = "";
  status.dataset.code = "";
  status.textContent = "";
}
// One in-page submission receipt, independent of transient notifications and
// form ownership. No paths, form values, or raw error text are retained here.
function rememberImportSubmission(error = null) {
  const receipt = $("importSubmissionReceipt");
  receipt.dataset.result = error ? "failed" : "started";
  receipt.dataset.code = error ? error.code || "operation_failed" : "";
  $("importSubmissionReceiptText").textContent = error
    ? `${t("importReceiptFailed")} ${errorText({ code: receipt.dataset.code }, language)}`
    : t("importReceiptStarted");
  receipt.hidden = false;
}
async function postImport(payload) {
  let next;
  try {
    next = await post("/api/import", payload);
  } catch (error) {
    rememberImportSubmission(error);
    throw error;
  }
  rememberImportSubmission();
  return next;
}
function showPreviousImportResult(error = null, {
  sessionTurn = importDialogGeneration, feedbackTurn = noticeGeneration,
} = {}) {
  const status = $("importPreviousStatus");
  const code = error ? error.code || "operation_failed" : "";
  const message = () => code
    ? `${t("importEarlierFailed")} ${errorText({ code }, language)}`
    : t("importEarlierStarted");
  const ownsDialog = sessionTurn === importDialogGeneration &&
    !importDialogClosing && $("importDialog").open;
  if (ownsDialog) {
    status.dataset.result = error ? "failed" : "started";
    status.dataset.code = code;
    status.textContent = message();
  } else if (feedbackTurn === noticeGeneration) {
    // Closing intent counts immediately, before the native animated close.
    // Never write into a reopened form or replace a newer page notification.
    notice(message);
  }
}
// Keep only this page's most recent returned rescan outcome, never paths or errors.
function rememberRescanSubmission(next = null) {
  // start() copies its initial reading/0 snapshot while holding the same lock
  // as progress(). Other well-formed running progress snapshots below are
  // accepted for compatibility, not asserted to occur in current POST replies.
  const accepted = Boolean(next && typeof next === "object" && !Array.isArray(next) &&
    typeof next.id === "string" && /^[0-9a-f]{32}$/.test(next.id) &&
    next.state === "running" && ["reading", "decoding", "saving"].includes(next.phase) &&
    Number.isSafeInteger(next.done) && Number.isSafeInteger(next.total) &&
    next.done >= 0 && next.total >= next.done && typeof next.label === "string" &&
    next.error === null && next.error_code === null);
  $("rescanSubmissionReceipt").dataset.outcome = accepted ? "accepted" : "unconfirmed";
  paintRescanReceipt();
  return accepted;
}
// A native picker can return paths that the editable, line-based fallback
// cannot represent losslessly (for example a newline inside a filename).
// Retain its exact value only while the displayed selection is unedited.
let pickedImport = null, importSubmitting = false, rescanSubmitting = false, importEditGeneration = 0;
let importDialogGeneration = 0, importDialogClosing = false;
function invalidateImportDialog() {
  if (!importDialogClosing) importDialogGeneration++;
  importDialogClosing = true;
}
function dismissImportDialog() {
  invalidateImportDialog();
  closeDialog($("importDialog"));
}
$("importDialog").addEventListener("cancel", invalidateImportDialog);
$("importDialog").addEventListener("close", () => {
  // A queued close event from an older session cannot revoke a reopened one.
  if (!$("importDialog").open) invalidateImportDialog();
});
for (const [id, event] of [["importPath", "input"], ["importKind", "change"], ["appendImport", "change"]])
  $(id).addEventListener(event, () => {
    if (id !== "appendImport") pickedImport = null;
    importEditGeneration++;
  });
async function openImport({ current = () => true } = {}) {
  const sessionTurn = importDialogGeneration;
  const ownsOpening = () => !rescanSubmitting && current() && sessionTurn === importDialogGeneration;
  if (!ownsOpening() || busy || importing() || !(await discardAllowed(ownsOpening)) ||
      !ownsOpening() || busy || importing()) return false;
  importDialogGeneration++;
  importDialogClosing = false;
  $("importError").hidden = true;
  clearPreviousImportResult();
  $("appendOptions").hidden = !state.items.length;
  $("replaceHint").hidden = $("appendImport").checked;
  openDialog($("importDialog"));
  $("importPath").focus();
  return true;
}
function renderJob() {
  const stop = $("cancelImport");
  const ownedFocus = document.activeElement === stop && stop.isConnected;
  const active = importing();
  const phase = !active ? "" : job.state === "cancelling"
    ? t("jobCancel") : job.phase === "saving" ? t("jobSaving") : t("jobReading");
  // Only phase changes are live. Per-file names and counts update quietly.
  if ($("jobPhase").textContent !== phase) $("jobPhase").textContent = phase;
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
    if (job.total > 0) $("jobProgress").value = (100 * job.done) / job.total;
    else $("jobProgress").removeAttribute("value");
    $("cancelImport").disabled =
      job.state === "cancelling" || job.phase === "saving" || Boolean(cancelRequest && cancelRequest.id === job.id);
  }
  if (state) renderSummary();
  // Native disabling/hiding can blur Stop. Only repair focus this render lost;
  // a newer deliberate target (including during the POST) keeps ownership.
  if (ownedFocus && stop.isConnected && (stop.disabled || !active) &&
      document.activeElement === document.body) {
    const fallback = $("openCommands");
    if (fallback.isConnected && !fallback.disabled && fallback.getClientRects().length)
      fallback.focus({ preventScroll: true });
  }
}
let jobPollError = null;
let cancelRequest = null, jobSnapshotGeneration = 0;
function retireCancelRequest(operation) {
  if (!operation || cancelRequest !== operation) return;
  cancelRequest = null;
  const resolver = operation.errorResolver;
  operation.errorResolver = null;
  if (resolver) operation.feedback.clear(resolver);
}
function clearJobPollError() {
  if (jobPollError && noticeResolver === jobPollError) notice();
  jobPollError = null;
}
const jobPoller = createJobPoller({
  async read({ signal }) {
    // Only a GET begun after an uncertain POST settled may release its lock.
    const confirming = cancelRequest?.phase === "confirming" ? cancelRequest : null;
    const next = await request("/api/job", { signal });
    if (confirming && cancelRequest === confirming) confirming.snapshot = next;
    return next;
  },
  async onSnapshot(next, { restoring }) {
    // A successful read retires only this poller's still-current outage notice.
    clearJobPollError();
    const resume = suspendedCompletion && suspendedCompletion.id === next.id &&
      suspendedCompletion.turn === refreshGeneration && next.state === "succeeded" && !dirty;
    suspendedCompletion = null;
    if (cancelRequest && (next.id !== cancelRequest.id ||
        ["succeeded", "cancelled", "failed"].includes(next.state) ||
        (cancelRequest.phase === "confirming" && cancelRequest.snapshot === next &&
          ["running", "cancelling"].includes(next.state)))) retireCancelRequest(cancelRequest);
    jobSnapshotGeneration++;
    job = next;
    if (restoring && !importing() && !resume) handledJob = job.id;
    renderJob();
    if (!importing() && job.id && (handledJob !== job.id || resume)) {
      handledJob = job.id;
      if (job.state === "succeeded") {
        if (dirty) notice(t("refreshDraft"), true);
        else {
          const completion = { id: job.id }, feedback = {};
          pendingCompletion = completion;
          try {
            if (await refresh(true, { recover: true, feedback }) && job === next)
              feedback.owner.publish(() => t("jobDone"), true);
          } finally {
            if (pendingCompletion === completion) pendingCompletion = null;
          }
        }
      } else if (job.state === "cancelled") notice(t("jobCancelled"));
      else if (job.state === "failed") notice(errorText(job, language));
    }
  },
  onError(error) {
    const message = () => errorText(error, language);
    notice(message);
    jobPollError = message;
  },
  onCallbackError: (error) => notice(errorText(error, language)),
});
function acceptJob(next) {
  // A confirmed mutation response also ends the previous observation outage.
  clearJobPollError();
  invalidateRefresh();
  // A newly accepted import/rescan owns observation. Cancellation receipts
  // use their own guarded path because later snapshots may already exist.
  if (cancelRequest && cancelRequest.id !== next.id) retireCancelRequest(cancelRequest);
  jobSnapshotGeneration++;
  job = next;
  jobPoller.start({ delay: 200 });
  renderJob();
}
async function startImport(event) {
  event.preventDefault();
  if (choosing || importSubmitting || rescanSubmitting || importDialogClosing || busy || importing()) return;
  $("importError").hidden = true;
  clearPreviousImportResult();
  if (!$("importPath").value.trim()) {
    showImportError({ code: "path_required" });
    $("importPath").focus();
    return;
  }
  importSubmitting = true;
  const editTurn = importEditGeneration, sessionTurn = importDialogGeneration,
    feedbackTurn = noticeGeneration;
  const ownsDialog = () => sessionTurn === importDialogGeneration &&
    !importDialogClosing && $("importDialog").open;
  try {
    renderSummary();
    const kind = $("importKind").value, display = $("importPath").value;
    const exact = pickedImport?.kind === kind && pickedImport.display === display;
    const path = exact
      ? (Array.isArray(pickedImport.path) ? [...pickedImport.path] : pickedImport.path)
      : kind === "files" ? display.split(/\r?\n/).map((p) => p.trim()).filter(Boolean)
        : display.trim();
    const next = await postImport({
      kind, path, append: $("appendImport").checked,
    });
    if (editTurn === importEditGeneration && ownsDialog()) dismissImportDialog();
    else showPreviousImportResult(null, { sessionTurn, feedbackTurn });
    // The server accepted this job even if the user has since edited the form.
    acceptJob(next);
  } catch (error) {
    if (editTurn === importEditGeneration && ownsDialog()) showImportError(error);
    else showPreviousImportResult(error, { sessionTurn, feedbackTurn });
  } finally {
    importSubmitting = false;
    renderSummary();
  }
}
function markBoundary(side) {
  if (!selected?.quality.decoded || busy) return;
  audition.cancel();
  trimEditor.boundary(side, media.currentTime || 0);
  drawWave();
}
function invalidateHistory() {
  historyGeneration++;
}
function canLoadHistoryReview(review, item) {
  if (!review || !item || !Number.isSafeInteger(review.version) || review.version < 1 ||
      !["pending", "pass", "fix", "exclude"].includes(review.status) ||
      typeof review.note !== "string" || [...review.note].length > 4000 ||
      !Array.isArray(review.issues) || review.issues.some(issue => !issueNames.includes(issue))) return false;
  const q = item.quality, duration = q.duration || 0;
  const nullable = value => value == null || Number.isFinite(value);
  if (!nullable(review.score) || (review.score != null && (review.score < 0 || review.score > 10)) ||
      !nullable(review.trim_start) || !nullable(review.trim_end)) return false;
  const start = review.trim_start ?? 0, end = review.trim_end ?? duration;
  if (start < 0 || end < 0 || start > duration || end > duration || (duration > 0 && start >= end)) return false;
  const markers = review.markers ?? [];
  if (!Array.isArray(markers) || markers.length > 100 || markers.some(row => !row ||
      !Number.isFinite(row.time) || row.time < 0 || row.time > duration ||
      typeof row.text !== "string" || !stripMarkerText(row.text) || [...stripMarkerText(row.text)].length > 240)) return false;
  return Boolean(q.decoded || (review.status !== "pass" && review.score == null && !markers.length));
}
async function loadHistoryDraft(review, { key, selectionTurn, version, historyTurn }) {
  const refreshTurn = refreshGeneration;
  const current = () => !busy && key === selected?.key && selectionTurn === generation &&
    version === selected.review.version && historyTurn === historyGeneration &&
    refreshTurn === refreshGeneration && $("historyPanel").open;
  if (!current() || !canLoadHistoryReview(review, selected) || review.version >= version ||
      sameReview(review, selected.review)) return false;
  // Copy only review fields. Historical metadata must never replace the current
  // saved revision used by the ordinary Save conflict check.
  const draft = { status: review.status, score: review.score ?? null, note: review.note,
    trim_start: review.trim_start ?? null, trim_end: review.trim_end ?? null,
    issues: [...review.issues], markers: (review.markers || []).map(row => ({ ...row })) };
  if (!(await discardAllowed(current)) || !current()) return false;
  audition.cancel();
  restoreReviewFields(draft);
  markDirty();
  renderDetails(false);
  notice(t("historyDraftLoaded").replace("{version}", review.version));
  $("note").focus();
  return true;
}
async function loadHistory() {
  const turn = ++historyGeneration;
  if (!$("historyPanel").open || !selected || busy) return;
  const key = selected.key, selectionTurn = generation, version = selected.review.version;
  const current = () => turn === historyGeneration &&
    selectionTurn === generation && key === selected?.key &&
    $("historyPanel").open;
  $("history").textContent = t("historyLoading");
  try {
    const result = await request(`/api/history/${key}`);
    if (!current()) return;
    const outdated = result.history.some(review => review.version > version);
    $("history").replaceChildren(
      ...[...result.history].reverse().map((review) => {
        const card = document.createElement("article"),
          heading = document.createElement("div"),
          title = document.createElement("p"),
          detail = document.createElement("p"),
          button = document.createElement("button");
        card.className = "history-entry";
        heading.className = "history-entry-heading";
        title.className = "history-entry-title";
        title.textContent = `v${review.version} · ${t(review.status)} · ${new Date(review.updated_utc).toLocaleString(language === "zh" ? "zh-CN" : "en")}`;
        detail.className = "history-entry-detail";
        detail.textContent = [
          review.score != null ? `${t("score")}: ${review.score}` : "",
          review.issues?.length ? `${t("issues")}: ${review.issues.map(issue => t(issue)).join(" · ")}` : "",
          `${t("range")}: ${precise(review.trim_start ?? 0)} – ${precise(review.trim_end ?? selected.quality.duration ?? 0)}`,
          review.note,
          ...(review.markers || []).map(row => `${precise(row.time)} · ${row.text}`),
        ].filter(Boolean).join("\n");
        button.type = "button";
        button.className = "history-load";
        const latest = review.version === version, matching = sameReview(review, selected.review);
        button.textContent = t(latest ? "historyCurrent" : matching ? "historySame" : "historyLoad");
        button.setAttribute("aria-label", latest || matching ? button.textContent :
          t("historyLoadVersion").replace("{version}", review.version));
        button.disabled = outdated || latest || matching || !canLoadHistoryReview(review, selected);
        button.addEventListener("click", () => loadHistoryDraft(review,
          { key, selectionTurn, version, historyTurn: turn }));
        heading.append(title, button);
        card.append(heading, detail);
        return card;
      }),
    );
    if (outdated) {
      const hint = document.createElement("p");
      hint.className = "history-warning";
      hint.textContent = t("historyOutdated");
      $("history").append(hint);
    }
    if (!result.history.length) $("history").textContent = t("noHistory");
  } catch (error) {
    if (current()) $("history").textContent = `${t("historyError")} ${errorText(error, language)}`;
  }
}

$("restoreDraft").addEventListener("click", async () => {
  if (await draftSession.restore()) {
    $("note").focus();
    notice(() => t("recoveryRestored"));
  }
});
$("locateDraft").addEventListener("click", async () => {
  if (busy) return;
  const record = draftSession.state().record;
  const item = record && state?.items.find(row => row.key === record.key);
  if (item) await select(item);
});
function clearDraftCopy(control) {
  if (busy) return;
  const heldFocus = document.activeElement === control;
  const result = draftSession.forget();
  // Successful clear removes the focused action. A failed compact clear moves
  // its retry into the full error panel. Do not steal a newer focus intent.
  const hidden = control === $("clearProtectedDraft")
    ? $("draftProtection").hidden : $("draftRecovery").hidden;
  if (heldFocus && hidden &&
      (document.activeElement === control || document.activeElement === document.body)) {
    const target = !$("draftRecovery").hidden ? $("discardDraft")
      : selected && !$("detailPanel").hidden ? $("note") : $("search");
    target.focus({ preventScroll: true });
  }
  if (result) notice(() => t("recoveryCleared"));
}
for (const id of ["discardDraft", "clearProtectedDraft"])
  $(id).addEventListener("click", () => clearDraftCopy($(id)));
$("draftProtection").addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !$("draftProtection").open || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  event.stopPropagation();
  $("draftProtection").open = false;
  $("draftProtectionSummary").focus({ preventScroll: true });
});
$("draftProtection").addEventListener("focusout", (event) => {
  if (event.relatedTarget && !$("draftProtection").contains(event.relatedTarget))
    $("draftProtection").open = false;
});
document.addEventListener("click", (event) => {
  if (!$("draftProtection").contains(event.target)) $("draftProtection").open = false;
});
$("note").addEventListener("input", validateNote);
$("note").addEventListener("compositionend", markDirty);
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
$("clearSelection").addEventListener("click", clearSelection);
for (const id of ["openImport", "emptyImport", "welcomeImport"])
  $(id).addEventListener("click", openImport);
for (const id of ["closeImport", "dismissImport"])
  $(id).addEventListener("click", dismissImportDialog);
$("importForm").addEventListener("submit", startImport);
async function browse(kind, importNow = false) {
  if (choosing || importSubmitting || rescanSubmitting || busy || importing()) return;
  choosing = true;
  const editTurn = importEditGeneration, sessionTurn = importDialogGeneration,
    feedbackTurn = noticeGeneration;
  const current = () => editTurn === importEditGeneration &&
    sessionTurn === importDialogGeneration;
  let picked = false;
  try {
    if (!(await discardAllowed(current)) || !current()) return;
    renderSummary();
    const result = await post("/api/browse", { kind, language });
    if (!result.path || !current()) return;
    picked = true;
    $("importError").hidden = true;
    $("importKind").value = kind;
    $("importPath").value = Array.isArray(result.path)
      ? result.path.join("\n")
      : result.path;
    pickedImport = { kind, display: $("importPath").value,
      path: Array.isArray(result.path) ? [...result.path] : result.path };
    if (importNow) {
      const next = await postImport({
        kind,
        path: result.path,
        append: true,
      });
      acceptJob(next);
    }
  } catch (error) {
    // A newer manual choice owns the fields and recovery dialog.
    if (!current()) {
      if (picked) showPreviousImportResult(error, { sessionTurn, feedbackTurn });
      return;
    }
    // Quick-add recovery must retain the failed action's append scope rather
    // than inheriting an earlier manual replacement choice.
    if (importNow) {
      $("appendImport").checked = true;
      // No new selection means an old manual path is not a retry target.
      if (!picked) { $("importPath").value = ""; pickedImport = null; }
    }
    if (!(await openImport({ current }))) return;
    // openImport starts exactly one new session after validating the old one.
    if (editTurn !== importEditGeneration || importDialogGeneration !== sessionTurn + 1 ||
        importDialogClosing) return;
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
for (const [id, factor, fallbackId] of [["zoomIn", 2, "zoomOut"], ["zoomOut", 0.5, "zoomIn"]])
  $(id).addEventListener("click", (event) => {
    const origin = $(id);
    const ownedFocus = event.detail === 0 && document.activeElement === origin;
    let focusMoved = false;
    const observeFocus = (event) => {
      if (event.target !== origin && event.target !== document.body) focusMoved = true;
    };
    if (ownedFocus) document.addEventListener("focusin", observeFocus);
    try {
      waveformView.zoom(factor);
    } finally {
      if (ownedFocus) document.removeEventListener("focusin", observeFocus);
    }
    const fallback = $(fallbackId);
    if (ownedFocus && !focusMoved && origin.isConnected && origin.disabled &&
        document.activeElement === document.body && fallback.isConnected &&
        !fallback.disabled && fallback.getClientRects().length)
      fallback.focus({ preventScroll: true });
  });
$("fitRange").addEventListener("click", () => waveformView.fit());
$("wavePan").addEventListener("input", () =>
  waveformView.pan(Number($("wavePan").value)),
);
$("cancelImport").addEventListener("click", async () => {
  if (!job?.id || job.state !== "running" || job.phase === "saving" || cancelRequest?.id === job.id) return;
  const operation = { id: job.id, phase: "posting", generation: jobSnapshotGeneration,
    feedback: createFeedbackOwner(), snapshot: null, errorResolver: null };
  cancelRequest = operation;
  renderJob();
  try {
    const next = await post("/api/cancel-import", { id: operation.id });
    if (cancelRequest !== operation || job?.id !== operation.id) return;
    if (!["running", "cancelling"].includes(job.state) || job.phase === "saving") {
      retireCancelRequest(operation);
      renderJob();
      return;
    }
    if (next?.id !== operation.id || next.state !== "cancelling" || next.phase === "saving")
      throw Object.assign(new Error("Unconfirmed cancellation response"), { code: "network" });
    // Acknowledgement is not completion. Preserve progress already observed
    // while the POST was pending instead of replaying its older snapshot.
    job = jobSnapshotGeneration === operation.generation ? next : { ...job, state: "cancelling" };
    jobSnapshotGeneration++;
    retireCancelRequest(operation);
    clearJobPollError();
    renderJob();
    jobPoller.start({ delay: 200 });
  } catch (error) {
    if (cancelRequest !== operation || job?.id !== operation.id) return;
    if (!["running", "cancelling"].includes(job.state)) { retireCancelRequest(operation); return; }
    operation.phase = "confirming";
    operation.snapshot = null;
    const resolver = () => errorText(error, language);
    if (operation.feedback.publish(resolver)) operation.errorResolver = resolver;
    // Restart only observation. Old in-flight GETs cannot confirm this POST,
    // and a missing response is never permission to repeat the mutation.
    jobPoller.start();
    renderJob();
  }
});
$("rescan").addEventListener("click", async () => {
  if (rescanSubmitting || choosing || importSubmitting || busy || importing()) return;
  rescanSubmitting = true;
  try {
    const refreshTurn = refreshGeneration, editTurn = importEditGeneration,
      sessionTurn = importDialogGeneration, feedbackTurn = noticeGeneration;
    const current = () => refreshTurn === refreshGeneration &&
      editTurn === importEditGeneration && sessionTurn === importDialogGeneration &&
      !busy && !importing() && !choosing && !importSubmitting;
    renderSummary();
    if (!(await discardAllowed(current)) || !current()) return;
    let next;
    try {
      next = await post("/api/rescan", {});
    } catch {
      rememberRescanSubmission();
      if (feedbackTurn === noticeGeneration) notice(() => t("rescanReceiptUnconfirmed"));
      return;
    }
    if (!rememberRescanSubmission(next)) {
      if (feedbackTurn === noticeGeneration) notice(() => t("rescanReceiptUnconfirmed"));
      return;
    }
    // A valid accepted task is observed even after local edits or newer notices.
    acceptJob(next);
  } finally {
    rescanSubmitting = false;
    renderSummary();
  }
});
$("language").addEventListener("change", () => {
  language = $("language").value;
  try {
    localStorage.setItem("ard-language", language);
  } catch {}
  // A language change is not a newer notification. Keep localized notices
  // and their timers; dismiss only fixed-language text without revoking a
  // pending request's feedback ownership.
  if (!noticeResolver) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
    $("notice").textContent = "";
    $("notice").hidden = true;
    $("notice").classList.toggle("success", false);
  }
  translate();
  if ($("historyPanel").open) loadHistory();
});
$("refresh").addEventListener("click", () => refresh());
$("retryLoad").addEventListener("click", () => refresh(true));
$("retryWave").addEventListener("click", retryWave);
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
    // Search is hidden in collapsed mobile and focus layouts. Keep the user
    // on a visible target without changing their layout or review draft.
    const target = [$("search"), $("clipTitle")].find(node =>
      node.isConnected && !node.disabled && node.getClientRects().length);
    target?.focus({ preventScroll: true });
  });
$("reopenLast").addEventListener("click", () => {
  if (!selected) return;
  const restoreFocus = document.activeElement === $("reopenLast");
  renderDetails(false);
  if (restoreFocus && (document.activeElement === $("reopenLast") ||
      document.activeElement === document.body)) $("clipTitle").focus();
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
  $(id).addEventListener("click", async () => {
    const list = visibleItems(),
      index = list.findIndex((item) => item.key === selected?.key),
      target = list[index + direction];
    if (!target) return;
    const origin = $(id), ownedFocus = document.activeElement === origin;
    let focusMoved = false;
    const observeFocus = (event) => {
      // The discard dialog is part of this navigation, not a new focus intent.
      if (event.target !== origin && event.target !== document.body &&
          !$("discardDialog").contains(event.target)) focusMoved = true;
    };
    const stopTracking = () => document.removeEventListener("focusin", observeFocus);
    if (ownedFocus) document.addEventListener("focusin", observeFocus);
    try {
      await select(target, { onSelected: () => {
        stopTracking();
        const heading = $("clipTitle");
        if (ownedFocus && !focusMoved && origin.isConnected && origin.disabled &&
            document.activeElement === document.body && heading.isConnected &&
            !heading.disabled && heading.getClientRects().length)
          heading.focus({ preventScroll: true });
      } });
    } finally {
      stopTracking();
    }
  });
$("variantA").addEventListener("click", () => switchVariant("a"));
$("variantB").addEventListener("click", () => switchVariant("b"));
for (const [id, visible] of [["showWaveform", false], ["showSpectrogram", true]])
  $(id).addEventListener("click", () => {
    spectrumVisible = visible;
    $("showWaveform").setAttribute("aria-pressed", String(!visible));
    $("showSpectrogram").setAttribute("aria-pressed", String(visible));
    // Keep the waveform's layout box for zoom and trim hit-testing.
    $("waveform").style.visibility = visible ? "hidden" : "visible";
    $("waveArea").dataset.view = visible ? "spectrum" : "waveform";
    $("analysisStatus").hidden = !visible;
    spectrumView.setVisible(visible && Boolean(selected?.quality.decoded));
    drawWave();
    renderWaveStatus();
  });
for (const [id, kind] of [["auditionStart", "start"], ["auditionEnd", "end"], ["auditionSelection", "selection"]])
  $(id).addEventListener("click", () => {
    if (busy || !selected?.quality.decoded) return;
    const bounds = selectedDraftRange();
    if (!bounds) {
      notice(() => errorText({ code: "trim_invalid" }, language));
      return;
    }
    const [start, end] = bounds;
    audition.start(auditionBounds(selected.quality.duration, start, end, kind), kind);
  });
$("suggestRange").addEventListener("click", () => {
  if (busy || !selected) return;
  const suggestion = quietRange(selected.quality);
  if (!suggestion) return;
  audition.cancel();
  trimEditor.range(...suggestion);
  drawWave();
  notice(t("rangeSuggested"), true);
});
for (const button of document.querySelectorAll("[data-marker-preset]"))
  button.addEventListener("click", () => {
    if (busy || !selected?.quality.decoded || !markersView.flush()) return;
    $("markerText").value = t(button.dataset.markerPreset);
    markDirty();
    $("addMarker").click();
  });
$("nextPending").addEventListener("click", goToNextPending);
$("markIn").addEventListener("click", () => markBoundary("start"));
$("markOut").addEventListener("click", () => markBoundary("end"));
$("resetRange").addEventListener("click", () => {
  audition.cancel();
  trimEditor.reset();
  drawWave();
});
$("speed").addEventListener("change", () => {
  player.playbackRate = Number($("speed").value);
  listeningMemory?.preferences({ speed: player.playbackRate });
});
$("loop").addEventListener("change", () => {
  audition.cancel({ restore: false });
  listeningMemory?.preferences({ loop: $("loop").checked });
});
$("volume").addEventListener("change", () =>
  listeningMemory?.preferences({ volume: player.volume }),
);
$("rememberPosition").addEventListener("change", () =>
  listeningMemory?.preferences({ remember: $("rememberPosition").checked }),
);
function rememberPosition() {
  if (selected?.quality.decoded && (media.pending || player.readyState >= 1))
    listeningMemory?.position(selected.key, media.currentTime);
}
player.addEventListener("timeupdate", () => {
  if (Date.now() - persistedAt > 1500) {
    rememberPosition();
    persistedAt = Date.now();
  }
});
player.addEventListener("pause", rememberPosition);
window.addEventListener("pagehide", rememberPosition);
window.addEventListener("pagehide", (event) => {
  waveformReader.cancel();
  const resumeId = event.persisted && refreshRead?.recover &&
    refreshRead.turn === refreshGeneration && !dirty ? pendingCompletion?.id : null;
  invalidateRefresh();
  if (resumeId) suspendedCompletion = { id: resumeId, turn: refreshGeneration };
  jobPoller.stop();
  audition.cancel();
  spectrumView.setVisible(false);
  if (!event.persisted) spectrumView.dispose();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) draftSession?.refresh();
  if (event.persisted) jobPoller.start({ restoring: !job });
  if (event.persisted) spectrumView.setVisible(spectrumVisible && Boolean(selected?.quality.decoded) && !$("detailPanel").hidden);
});
document.addEventListener("visibilitychange", () => {
  spectrumView.setVisible(!document.hidden && spectrumVisible && Boolean(selected?.quality.decoded) && !$("detailPanel").hidden);
});
player.addEventListener("play", () => {
  player.playbackRate = Number($("speed").value);
});
player.addEventListener("error", () => {
  if (selected?.quality.decoded) notice(() => t("audioError"));
});
$("historyPanel").addEventListener("toggle", loadHistory);
window.addEventListener("resize", () => {
  if (!matchMedia("(max-width:720px)").matches) closeSettings();
  drawWave();
  syncGlider(true);
});
document.fonts?.ready.then(() => {
  // The local CJK face may settle after the initial workspace has rendered.
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
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
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
  // 229 also covers IME boundary keys when isComposing is already false.
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  // Match only the documented Ctrl / Command chords, not browser/OS variants.
  const primaryChord = Boolean(event.ctrlKey) !== Boolean(event.metaKey) &&
    !event.shiftKey && !event.altKey;
  if ($("importDialog").open || $("discardDialog").open || $("helpDialog").open)
    return;
  if (primaryChord && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (event.repeat) return;
    $("commandDialog").open ? $("commandDialog").close() : commandMenu.open();
    return;
  }
  if ($("commandDialog").open) return;
  if (primaryChord && event.key === "Enter") {
    event.preventDefault();
    if (event.repeat) return;
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
    if (event.repeat) return;
    $("focusMode").click();
    return;
  }
  if (event.code === "Space") {
    if (event.target.closest("button,a,summary")) return;
    event.preventDefault();
    if (event.repeat) return;
    if (selected?.quality.decoded) $("play").click();
  }
  if (event.key.toLowerCase() === "b" && !event.repeat)
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
$("focusMode").addEventListener("click", (event) => {
  // Capture before display:none can blur a keyboard user's active control.
  const hiddenFocus = event.detail === 0 && document.activeElement?.closest(
    ".library, .review-pane, .review-progress, .summary-bar",
  );
  const focused = document.body.classList.toggle("focus-mode");
  $("focusMode").setAttribute("aria-pressed", String(focused));
  if (focused && hiddenFocus) $("focusMode").focus({ preventScroll: true });
  requestAnimationFrame(() => {
    drawWave();
    syncGlider(true);
  });
});
for (const id of ["openHelp", "shortcuts"])
  $(id).addEventListener("click", () => openDialog($("helpDialog")));
$("closeHelp").addEventListener("click", () => closeDialog($("helpDialog")));
$("exportMenu").addEventListener("toggle", () => {
  renderExportScope();
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
    $("updateNotice").hidden = result.version === "0.13.0";
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
  jobPoller.start({ restoring: true });
  checkVersion();
});
