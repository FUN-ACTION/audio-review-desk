import {
  formatTime,
  filterItems,
  sortItems,
  reviewPayload,
  playbackRange,
} from "./ui.js";

const $ = (id) => document.getElementById(id);
const words = {
  zh: {
    local: "本地工作区",
    import: "导入素材",
    rescan: "重新扫描",
    export: "导出",
    exportJson: "完整记录 · JSON",
    exportCsv: "当前清单 · CSV",
    exportPass: "已通过片段 · CSV",
    collection: "素材清单",
    refresh: "刷新",
    files: "个文件",
    pending: "待审",
    pass: "通过",
    fix: "待处理",
    exclude: "排除",
    flagged: "个技术提示",
    approvedDuration: "人工通过",
    candidateDuration: "候选",
    library: "素材",
    search: "搜索文件、标题",
    all: "全部状态",
    flags: "技术提示",
    duplicates: "PCM 重复",
    byName: "名称",
    byDuration: "时长",
    byLevel: "电平",
    selectVisible: "选择当前列表",
    apply: "应用到所选",
    emptyTitle: "还没有素材",
    emptyHelp: "导入一个音频目录，或使用已有的 CSV / JSON 清单。",
    emptyFilter: "没有符合条件的文件",
    readOnly: "原文件只读",
    variantA: "A · 当前",
    variantB: "B · 参考",
    loop: "循环范围",
    speed: "速度",
    compareNote: "A/B 等 RMS 衰减试听",
    range: "建议保留范围",
    resetRange: "重置",
    trimStart: "起点 / 秒",
    trimEnd: "终点 / 秒",
    markIn: "取当前起点 [",
    markOut: "取当前终点 ]",
    rangeHelp: "只记录边界，不裁剪原音频。",
    fileInfo: "文件信息与检测",
    checksHelp: "检测只提示电平、静音和解码问题；录音身份与听感需人工判断。",
    history: "审核历史",
    decision: "审核",
    score: "评分（可选）",
    issues: "问题标签",
    notes: "备注",
    notesPlaceholder: "记录听到的问题或处理方式",
    saveNext: "保存并下一条",
    save: "保存",
    undo: "撤销上次审核",
    versionHelp: "音频或参考版本变化后，需要重新审核。",
    shortcuts: "空格 播放 · B 对照 · J/K 切换 · 1–4 状态 · Ctrl+Enter 保存",
    welcome: "从一份素材清单开始",
    welcomeHelp: "选择目录后，逐条试听、标记问题，再导出审核结果。",
    importHelp: "填写这台电脑上的目录或清单文件路径，原文件保持不变。",
    importType: "导入类型",
    folder: "音频目录",
    manifest: "CSV / JSON 清单",
    path: "本机路径",
    append: "保留工作区中其他目录的素材",
    replaceHelp: "取消勾选会替换当前列表，原文件和已保存的审核历史仍保留。",
    cancel: "取消",
    startImport: "开始导入",
    cancelImport: "停止导入",
    selected: "已选",
    duplicateGroups: "组重复",
    notReviewed: "未保存",
    saved: "已保存",
    saving: "保存中…",
    unsaved: "未保存的更改",
    discard: "放弃这条尚未保存的审核草稿？",
    discardTitle: "有未保存的更改",
    discardAction: "放弃更改",
    keepEditing: "继续编辑",
    noFlags: "无技术提示",
    quiet: "静音 / 音量很低",
    nearClip: "接近满幅",
    multichannel: "多声道",
    decodeError: "无法完整解码",
    ineligible: "不计入候选时长",
    rate: "采样率",
    channels: "声道",
    rms: "RMS",
    duration: "时长",
    peak: "采样峰值",
    edges: "首尾静音",
    noHistory: "没有审核记录",
    cut_start: "开头截断",
    cut_end: "结尾截断",
    noise: "噪声",
    reverb: "混响",
    backing_voice: "其他人声",
    instrument: "乐器残留",
    lyrics: "字词不清",
    distortion: "失真",
    identity: "身份不确定",
    other: "其他",
    loadError: "无法读取工作区，请确认本地服务仍在运行。",
    audioError: "无法播放，请核对原文件并重新扫描。",
    jobReading: "正在读取目录",
    jobSaving: "正在更新清单",
    jobCancel: "当前文件完成后停止",
    jobDone: "导入完成",
    jobCancelled: "已停止，原清单保持不变。",
    jobFailed: "导入失败",
    refreshDraft: "素材已导入。保存或放弃当前草稿后，刷新清单。",
    savedRefresh: "审核已保存，统计暂未刷新。",
    batchSaved: "条记录已更新",
    undoSaved: "已撤销，历史记录保留。",
  },
  en: {
    local: "Local workspace",
    import: "Import audio",
    rescan: "Rescan",
    export: "Export",
    exportJson: "Full review record · JSON",
    exportCsv: "File list · CSV",
    exportPass: "Approved clips · CSV",
    collection: "Collection",
    refresh: "Refresh",
    files: "files",
    pending: "Pending",
    pass: "Approved",
    fix: "Needs work",
    exclude: "Excluded",
    flagged: "technical flags",
    approvedDuration: "Approved",
    candidateDuration: "Candidate",
    library: "Files",
    search: "Search files or labels",
    all: "All statuses",
    flags: "Technical flags",
    duplicates: "PCM duplicates",
    byName: "Name",
    byDuration: "Duration",
    byLevel: "Level",
    selectVisible: "Select visible files",
    apply: "Apply to selection",
    emptyTitle: "No files yet",
    emptyHelp: "Import an audio folder or an existing CSV / JSON manifest.",
    emptyFilter: "No matching files",
    readOnly: "Source audio is read-only",
    variantA: "A · Current",
    variantB: "B · Reference",
    loop: "Loop range",
    speed: "Speed",
    compareNote: "A/B previews: RMS-matched attenuation",
    range: "Suggested keep range",
    resetRange: "Reset",
    trimStart: "Start / seconds",
    trimEnd: "End / seconds",
    markIn: "Set start [",
    markOut: "Set end ]",
    rangeHelp: "Records boundaries without cutting the source.",
    fileInfo: "File details and checks",
    checksHelp:
      "Checks cover levels, silence and decoding. Recording identity and listening quality need review.",
    history: "Review history",
    decision: "Review",
    score: "Score (optional)",
    issues: "Issue labels",
    notes: "Notes",
    notesPlaceholder: "Describe what needs attention or what to keep",
    saveNext: "Save & next",
    save: "Save",
    undo: "Undo last review",
    versionHelp: "Changed audio or reference versions need a new review.",
    shortcuts:
      "Space Play · B Compare · J/K Navigate · 1–4 Status · Ctrl+Enter Save",
    welcome: "Start with an audio collection",
    welcomeHelp:
      "Import a folder, listen to each clip, record issues, then export the results.",
    importHelp:
      "Enter a folder or manifest path on this computer. Source files remain unchanged.",
    importType: "Import type",
    folder: "Audio folder",
    manifest: "CSV / JSON manifest",
    path: "Local path",
    append: "Keep files from other folders in this workspace",
    replaceHelp:
      "Unchecking this replaces the active list. Source audio and saved history stay intact.",
    cancel: "Cancel",
    startImport: "Start import",
    cancelImport: "Stop import",
    selected: "selected",
    duplicateGroups: "duplicate groups",
    notReviewed: "Not saved",
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Unsaved changes",
    discard: "Discard this unsaved review draft?",
    discardTitle: "Unsaved changes",
    discardAction: "Discard changes",
    keepEditing: "Keep editing",
    noFlags: "No technical flags",
    quiet: "Silence / very quiet",
    nearClip: "Near full scale",
    multichannel: "Multichannel",
    decodeError: "Could not fully decode",
    ineligible: "Excluded from candidate duration",
    rate: "Sample rate",
    channels: "Channels",
    rms: "RMS",
    duration: "Duration",
    peak: "Sample peak",
    edges: "Quiet edges",
    noHistory: "No saved reviews",
    cut_start: "Start cut",
    cut_end: "End cut",
    noise: "Noise",
    reverb: "Reverb",
    backing_voice: "Other voice",
    instrument: "Instrument bleed",
    lyrics: "Unclear words",
    distortion: "Distortion",
    identity: "Identity uncertain",
    other: "Other",
    loadError:
      "Could not read the workspace. Check that the local server is running.",
    audioError: "Preview unavailable. Check the source file and rescan.",
    jobReading: "Reading folder",
    jobSaving: "Updating file list",
    jobCancel: "Stopping after the current file",
    jobDone: "Import complete",
    jobCancelled: "Import stopped. The previous file list is unchanged.",
    jobFailed: "Import failed",
    refreshDraft:
      "Import complete. Save or discard this draft, then refresh the list.",
    savedRefresh: "Review saved; counts could not refresh.",
    batchSaved: "reviews updated",
    undoSaved: "Review undone. History has been kept.",
  },
};
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

function notice(message = "", success = false) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
  $("notice").classList.toggle("success", success);
}
async function request(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
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
    $("discardDialog").showModal();
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
  $("search").setAttribute("aria-label", t("search"));
  $("filter").setAttribute("aria-label", t("all"));
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
  $("version").textContent = state.version || "0.2.0";
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
function updateTime() {
  $("playTime").textContent =
    `${precise(player.currentTime || 0)} / ${precise(selected?.quality.duration || 0)}`;
}
function drawWave() {
  const canvas = $("waveform"),
    width = Math.max(1, canvas.clientWidth),
    height = canvas.clientHeight || 160,
    ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const data = wave[variant] || [],
    duration = selected?.quality.duration || 1,
    progress = (player.currentTime || 0) / duration,
    [start, end] = range();
  context.fillStyle = "#1d2637";
  context.fillRect(
    (start / duration) * width,
    0,
    ((end - start) / duration) * width,
    height,
  );
  context.fillStyle = "#3c485d";
  context.fillRect(0, height / 2, width, 1);
  for (let i = 0; i < data.length; i++) {
    const x = (i * width) / data.length,
      bar = Math.max(1, data[i] * (height - 24));
    context.fillStyle = i / data.length <= progress ? "#b7c7fa" : "#61779f";
    if (i / data.length < start / duration || i / data.length > end / duration)
      context.fillStyle = "#3a4353";
    context.fillRect(
      x,
      height / 2 - bar / 2,
      Math.max(1, width / data.length - 1),
      bar,
    );
  }
  context.fillStyle = "#e9edf9";
  context.fillRect(progress * width, 8, 1, height - 16);
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
  $("audioSection").hidden = !q.decoded;
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
      ? `${t("saved")} · v${review.version}`
      : t("notReviewed");
  const list = visibleItems(),
    index = list.findIndex((row) => row.key === item.key);
  $("previous").disabled = busy || index <= 0;
  $("next").disabled = busy || index < 0 || index >= list.length - 1;
  updateTime();
  drawWave();
}
async function select(item) {
  if (busy || !(await discardAllowed())) return;
  const turn = ++generation;
  player.pause();
  player.onloadedmetadata = null;
  selected = item;
  dirty = false;
  variant = "a";
  wave = { a: [], b: [] };
  notice();
  renderQueue();
  renderDetails();
  $("historyPanel").open = false;
  if (item.quality.decoded) {
    player.src = `/media/${item.key}/a.wav`;
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
    const item =
      state.items.find((row) => row.key === previous) ||
      visibleItems()[0] ||
      state.items[0];
    if (item) await select(item);
    else {
      $("detailPanel").hidden = true;
      $("emptyDetail").hidden = false;
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
}
async function openImport() {
  if (busy || importing() || !(await discardAllowed())) return;
  $("importError").hidden = true;
  $("importDialog").showModal();
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
    $("importDialog").close();
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
  $(id).addEventListener("click", () => $("importDialog").close());
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
  translate();
  if ($("historyPanel").open) loadHistory();
});
$("refresh").addEventListener("click", () => refresh());
$("keepEditing").addEventListener("click", () => $("discardDialog").close("keep"));
$("discardChanges").addEventListener("click", () => $("discardDialog").close("discard"));
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
  if ($("loop").checked && (player.currentTime < start || player.currentTime >= end))
    player.currentTime = start;
});
player.addEventListener("timeupdate", () => {
  const [start, end] = range();
  if ($("loop").checked && !player.paused && player.currentTime >= end - 0.01)
    player.currentTime = start;
  updateTime();
  drawWave();
});
player.addEventListener("ended", () => {
  if ($("loop").checked && selected?.quality.decoded) {
    player.currentTime = range()[0];
    player.play().catch((error) => notice(error.message));
  }
});
player.addEventListener("error", () => {
  if (selected?.quality.decoded) notice(t("audioError"));
});
$("waveform").addEventListener("click", (event) => {
  if (Number.isFinite(player.duration))
    player.currentTime =
      (event.offsetX / $("waveform").clientWidth) * player.duration;
});
$("historyPanel").addEventListener("toggle", loadHistory);
window.addEventListener("resize", drawWave);
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
  if ($("importDialog").open || $("discardDialog").open) return;
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
translate();
refresh(true).then(poll);
