import { words } from "./copy.js";
import { springValue, reveal, openDialog, closeDialog } from "./motion.js";
import { mountWaveform } from "./waveform.js";
import { mountTransport } from "./transport.js";
import {
  formatTime,
  filterItems,
  sortItems,
  reviewPayload,
  playbackRange,
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
const precise = (seconds) =>
  `${formatTime(seconds)}.${Math.floor(((seconds || 0) % 1) * 1000)
    .toString()
    .padStart(3, "0")}`;
const number = (value) => (value.trim() === "" ? null : Number(value));

let noticeTimer;
const waveformView = mountWaveform(
  $("waveform"),
  $("seek"),
  $("waveSelection"),
  $("playhead"),
);
const moveGlider = springValue((value) => {
  $("abGlider").style.transform = `translateX(${value}px)`;
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
  onError: (message) => notice(message),
  labels: () => ({ play: t("play"), pause: t("pause") }),
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
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) {
    let message = result.error || `HTTP ${response.status}`;
    if (
      language === "zh" &&
      /Another page updated|updated elsewhere/.test(message)
    )
      message = "这条审核刚被另一页更新。先刷新，再核对更改。";
    if (
      language === "zh" &&
      /Source changed|Audio version changed/.test(message)
    )
      message = "音频已有变化，重新扫描后再保存。";
    throw new Error(message);
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
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
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
  if (job) renderJob();
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
  const stats = state.stats;
  $("fileCount").textContent = stats.files;
  $("pendingCount").textContent = stats.review_counts.pending;
  $("approvedCount").textContent = stats.review_counts.pass;
  $("flagCount").textContent = stats.warnings + stats.errors;
  $("candidateTime").textContent = formatTime(stats.candidate_seconds);
  $("approvedTime").textContent = formatTime(stats.human_approved_seconds);
  $("collectionName").textContent = state.scan?.label || state.workspace || "—";
  $("version").textContent = state.version || "0.3.0";
  $("scanTime").textContent = state.scan
    ? new Date(state.scan.at).toLocaleString(language === "zh" ? "zh-CN" : "en")
    : "";
  $("duplicateInfo").textContent =
    `${stats.duplicate_groups.length} ${t("duplicateGroups")}`;
  $("rescan").disabled = !state.can_rescan || busy || Boolean(importing());
  $("openImport").disabled = busy || Boolean(importing());
}
function visibleItems() {
  return sortItems(
    filterItems(
      state.items,
      $("search").value,
      $("filter").value,
      new Set(state.stats.duplicate_groups.flat()),
    ),
    $("sort").value,
  );
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
  const list = visibleItems();
  $("queueCount").textContent = `${list.length} / ${state.items.length}`;
  $("emptyLibrary").hidden = state.items.length > 0;
  $("emptyFilter").hidden = !state.items.length || list.length > 0;
  $("items").replaceChildren(
    ...list.map((item) => {
      const row = document.createElement("div");
      row.className = "clip-row";
      row.classList.toggle("selected", item.key === selected?.key);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedKeys.has(item.key);
      checkbox.disabled = busy;
      checkbox.setAttribute("aria-label", `${t("selected")}: ${item.id}`);
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
  renderSelection();
}
function markDirty() {
  if (!busy && selected) {
    dirty = true;
    $("saveState").textContent = t("unsaved");
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
  $("detailPanel").hidden = false;
  $("emptyDetail").hidden = true;
  $("clipTitle").textContent = item.label;
  $("clipId").textContent = item.id;
  const names = {
    silence_or_very_quiet: "quiet",
    near_full_scale: "nearClip",
    multichannel: "multichannel",
    decode_error: "decodeError",
  };
  const flags = q.flags.length
    ? q.flags.map((flag) => t(names[flag] || flag))
    : [t("noFlags")];
  if (!item.eligible) flags.push(t("ineligible"));
  if (item.error) flags.push(item.error);
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
  for (const id of ["trimStart", "trimEnd", "markIn", "markOut", "resetRange"])
    $(id).disabled = busy || !q.decoded;
  $("undo").disabled = busy || review.version === 0;
  if (restore) {
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
  $("clipPosition").textContent = `${index + 1} / ${list.length}`;
  syncGlider();
  updateTime();
  drawWave();
}
async function select(item) {
  if (busy || !(await discardAllowed())) return;
  const turn = ++generation;
  player.pause();
  player.onloadedmetadata = null;
  selected = item;
  try {
    sessionStorage.setItem(`ard-current-${state.workspace}`, item.key);
  } catch {}
  if (matchMedia("(max-width:720px)").matches)
    document.body.classList.add("mobile-library-collapsed");
  $("mobileSelection").textContent = item.label;
  updateLibraryToggle();
  dirty = false;
  variant = "a";
  wave = { a: [], b: [] };
  notice();
  renderQueue();
  renderDetails();
  reveal($("audioSection"));
  $("historyPanel").open = false;
  if (item.quality.decoded) {
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
      if (turn === generation) notice(error.message);
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
        remembered || sessionStorage.getItem(`ard-current-${state.workspace}`);
    } catch {}
    const item =
      state.items.find((row) => row.key === remembered) ||
      visibleItems()[0] ||
      state.items[0];
    if (item) await select(item);
    else {
      $("detailPanel").hidden = true;
      $("emptyDetail").hidden = false;
      reveal($("emptyDetail"));
    }
  } catch (error) {
    notice(`${t("loadError")} ${error.message}`);
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
  const target = selected,
    ordered = visibleItems(),
    index = ordered.findIndex((item) => item.key === target.key);
  const payload = reviewPayload(target, {
    status: document.querySelector("input[name=decision]:checked")?.value,
    score: $("score").value,
    trimStart: $("trimStart").value,
    trimEnd: $("trimEnd").value,
    issues: [...$("issues").querySelectorAll("input:checked")].map(
      (input) => input.value,
    ),
    note: $("note").value,
  });
  setBusy(true);
  $("saveState").textContent = t("saving");
  let success = false;
  try {
    const result = await post("/api/review", payload);
    target.review = result.review;
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
    notice(error.message);
  } finally {
    setBusy(false);
    if (success) renderDetails(false);
  }
  if (success && advance) {
    const next =
      ordered
        .slice(index + 1)
        .map((row) => state.items.find((item) => item.key === row.key))
        .find(Boolean) ||
      visibleItems().find(
        (item) => item.key !== target.key && item.review.status === "pending",
      );
    if (next) await select(next);
  }
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
    notice(error.message);
  } finally {
    setBusy(false);
  }
  if (count) {
    await refresh(true);
    notice(`${count} ${t("batchSaved")}`, true);
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
    notice(error.message);
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
    if (resume) player.play().catch((error) => notice(error.message));
  };
  player.load();
  renderDetails(false);
  updateTime(time);
}
async function openImport() {
  if (busy || importing() || !(await discardAllowed())) return;
  $("importError").hidden = true;
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
async function poll() {
  clearTimeout(pollTimer);
  try {
    job = await request("/api/job");
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
      else if (job.state === "failed")
        notice(`${t("jobFailed")}: ${job.error}`);
    }
  } catch (error) {
    notice(error.message);
  }
}
async function startImport(event) {
  event.preventDefault();
  $("importError").hidden = true;
  try {
    job = await post("/api/import", {
      kind: $("importKind").value,
      path: $("importPath").value.trim(),
      append: $("appendImport").checked,
    });
    closeDialog($("importDialog"));
    renderJob();
    pollTimer = setTimeout(poll, 200);
  } catch (error) {
    $("importError").textContent = error.message;
    $("importError").hidden = false;
  }
}
function markBoundary(side) {
  if (!selected?.quality.decoded || busy) return;
  $(side === "start" ? "trimStart" : "trimEnd").value = (
    player.currentTime || 0
  ).toFixed(3);
  markDirty();
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
        p.textContent = `v${review.version} · ${t(review.status)} · ${new Date(review.updated_utc).toLocaleString()}\n${review.note}`;
        return p;
      }),
    );
    if (!result.history.length) $("history").textContent = t("noHistory");
  } catch (error) {
    notice(error.message);
  }
}

$("reviewForm").addEventListener("input", markDirty);
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
$("cancelImport").addEventListener("click", async () => {
  try {
    job = await post("/api/cancel-import", { id: job.id });
    renderJob();
  } catch (error) {
    notice(error.message);
  }
});
$("rescan").addEventListener("click", async () => {
  if (busy || importing() || !(await discardAllowed())) return;
  try {
    job = await post("/api/rescan", {});
    renderJob();
    pollTimer = setTimeout(poll, 200);
  } catch (error) {
    notice(error.message);
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
});
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
  drawWave();
  syncGlider(true);
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("click", (event) => {
  if (!$("exportMenu").contains(event.target)) $("exportMenu").open = false;
});
document.addEventListener("keydown", (event) => {
  if ($("importDialog").open || $("discardDialog").open || $("helpDialog").open)
    return;
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    save(false);
    return;
  }
  if (
    event.target.closest("input,textarea,select,button,a,summary") ||
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
  if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    $("focusMode").click();
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    if (selected?.quality.decoded) {
      if (player.paused) {
        const [start, end] = range();
        if (
          $("loop").checked &&
          (player.currentTime < start || player.currentTime >= end)
        )
          player.currentTime = start;
        player.play().catch((error) => notice(error.message));
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
  reveal($("listening-pane") || document.querySelector(".listening-pane"));
});
for (const id of ["openHelp", "shortcuts"])
  $(id).addEventListener("click", () => openDialog($("helpDialog")));
$("closeHelp").addEventListener("click", () => closeDialog($("helpDialog")));
$("exportMenu").addEventListener("toggle", () => {
  if ($("exportMenu").open) reveal(document.querySelector(".menu"), "menu");
});
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog(dialog, dialog.id === "discardDialog" ? "keep" : "");
  });
const checkVersion = async () => {
  try {
    const result = await request("/api/version");
    $("updateNotice").hidden = result.version === "0.3.0";
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
  poll();
  checkVersion();
});
