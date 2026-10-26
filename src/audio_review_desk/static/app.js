import { formatTime, filterItems, reviewPayload } from "./ui.js";

const $ = (id) => document.getElementById(id);
const words = {
  en: {
    local: "On your computer",
    refresh: "Refresh",
    export: "Export reviews ↓",
    eyebrow: "LISTEN · COMPARE · DECIDE",
    heading: "Give every clip a careful listen.",
    subtitle:
      "Technical checks organize the queue. Your ears make the final call.",
    files: "Audio files",
    unique: "Unique PCM duration",
    candidate: "Candidate timeline",
    candidateHelp: "Source overlaps counted once",
    approved: "Human-approved timeline",
    approvedHelp: "Only your explicit approvals",
    queue: "Review queue",
    search: "Search clips…",
    all: "All clips",
    pending: "Pending",
    pass: "Approved",
    fix: "Needs work",
    exclude: "Excluded",
    warnings: "Technical flags",
    duplicates: "Exact PCM duplicates",
    empty: "No clips match this filter.",
    readOnly: "Source files stay read-only",
    variantA: "A · Current",
    variantB: "B · Reference",
    audioHelp:
      "A/B previews use constant attenuation to match RMS when both signals are audible. Original audio is unchanged.",
    decision: "Your listening decision",
    notReviewed: "Not reviewed",
    score: "Listening score (optional, 0–10)",
    trimStart: "Suggested start (clip seconds)",
    trimEnd: "Suggested end (clip seconds)",
    issues: "Issues heard",
    notes: "Listening notes",
    notesPlaceholder: "What should be kept or improved?",
    versionHelp: "Decisions belong to this audio and source-interval version.",
    save: "Save review",
    history: "Review history",
    shortcuts:
      "Space: play/pause · B: compare · J/K: next/previous · Ctrl+Enter: save",
    limits:
      "Flags do not establish recording identity, transcription accuracy, ownership, or training readiness. No audio is uploaded.",
    decoded: "decoded",
    errors: "unreadable",
    groups: "duplicate groups",
    rate: "Sample rate",
    channels: "Channels",
    rms: "RMS level",
    duration: "Duration",
    checks: "No technical flags",
    saved: "Saved",
    unsaved: "Unsaved changes",
    discard: "Discard this unsaved review draft?",
    saving: "Saving…",
    noHistory: "No saved review yet.",
    noAudio:
      "Audio preview unavailable. Check the scan error and import again.",
    loadError:
      "Could not load the workspace. Make sure the local server is still running.",
    soundError:
      "Could not play this preview. The source may have changed; rescan and refresh.",
    quiet: "Silence / very quiet",
    nearClip: "Near full scale",
    multichannel: "Multichannel",
    decodeError: "Decode error",
    eligible: "Candidate",
    ineligible: "Not eligible for candidate totals",
    cut_start: "Start cut",
    cut_end: "End cut",
    noise: "Noise",
    reverb: "Reverb",
    backing_voice: "Other voice",
    instrument: "Instrument bleed",
    lyrics: "Words unclear",
    distortion: "Distortion",
    identity: "Identity uncertain",
    other: "Other",
    saveError: "Save failed. Your draft is preserved.",
    playFirst: "Choose a readable clip first.",
  },
  zh: {
    local: "仅在本机运行",
    refresh: "刷新",
    export: "导出审核记录 ↓",
    eyebrow: "聆听 · 对照 · 判断",
    heading: "认真听过，再作决定。",
    subtitle: "技术检测帮你整理队列，最终听感由你判断。",
    files: "音频文件",
    unique: "PCM 去重时长",
    candidate: "候选时间线",
    candidateHelp: "同一来源的重叠区间只计一次",
    approved: "人工通过时间线",
    approvedHelp: "仅统计你明确通过的片段",
    queue: "听审队列",
    search: "搜索片段…",
    all: "全部片段",
    pending: "待审核",
    pass: "通过",
    fix: "待改进",
    exclude: "排除",
    warnings: "技术提示",
    duplicates: "PCM 完全重复",
    empty: "当前筛选没有片段。",
    readOnly: "原始音频保持只读",
    variantA: "A · 当前音频",
    variantB: "B · 参考音频",
    audioHelp: "A/B 试听在两路均可听时用恒定衰减匹配 RMS，不修改原音频。",
    decision: "你的听审判断",
    notReviewed: "尚未审核",
    score: "听感评分（可选，0–10）",
    trimStart: "建议起点（片段内秒数）",
    trimEnd: "建议终点（片段内秒数）",
    issues: "听到的问题",
    notes: "听审备注",
    notesPlaceholder: "哪些部分值得保留，哪些需要改进？",
    versionHelp: "审核绑定当前音频及来源区间版本。",
    save: "保存审核",
    history: "审核历史",
    shortcuts:
      "空格：播放/暂停 · B：A/B 对照 · J/K：前后片段 · Ctrl+Enter：保存",
    limits:
      "技术提示不能证明录音身份、转写准确性、素材权属或训练就绪。音频不会上传。",
    decoded: "成功解码",
    errors: "无法读取",
    groups: "组重复",
    rate: "采样率",
    channels: "声道",
    rms: "RMS 电平",
    duration: "时长",
    checks: "未发现技术提示",
    saved: "已保存",
    unsaved: "尚未保存",
    discard: "放弃这条尚未保存的听审草稿？",
    saving: "正在保存…",
    noHistory: "暂无已保存的审核。",
    noAudio: "无法试听，请核对扫描错误并重新导入。",
    loadError: "无法加载工作区，请确认本地服务仍在运行。",
    soundError: "无法播放试听音频，原文件可能已变化，请重新扫描后刷新。",
    quiet: "静音或音量很低",
    nearClip: "接近满幅",
    multichannel: "多声道",
    decodeError: "解码失败",
    eligible: "候选片段",
    ineligible: "不计入候选时长",
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
    saveError: "保存失败，草稿仍在页面中。",
    playFirst: "请先选择可读取的片段。",
  },
};
let language = "en",
  state = null,
  selected = null,
  dirty = false,
  variant = "a",
  wave = { a: [], b: [] },
  loading = 0,
  saving = false;
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
const player = $("player");

function notice(message, success = false) {
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
function translate() {
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-t]").forEach((element) => {
    element.textContent = t(element.dataset.t);
  });
  document.querySelectorAll("[data-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.placeholder);
  });
  $("search").setAttribute("aria-label", t("search"));
  $("filter").setAttribute("aria-label", t("queue"));
  $("issues").replaceChildren(
    ...issueNames.map((name) => {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.value = name;
      input.checked = selected?.review.issues.includes(name) || false;
      label.append(input, document.createTextNode(t(name)));
      return label;
    }),
  );
  if (state) {
    renderMetrics();
    renderQueue();
    if (selected) renderDetails();
  }
}
function renderMetrics() {
  const stats = state.stats;
  $("fileCount").textContent = stats.files;
  $("decodeCount").textContent =
    `${stats.decoded} ${t("decoded")} · ${stats.errors} ${t("errors")}`;
  $("uniqueTime").textContent = formatTime(stats.unique_pcm_seconds);
  $("duplicateCount").textContent =
    `${stats.duplicate_groups.length} ${t("groups")}`;
  $("candidateTime").textContent = formatTime(stats.candidate_seconds);
  $("approvedTime").textContent = formatTime(stats.human_approved_seconds);
  $("scanTime").textContent = state.scan
    ? new Date(state.scan.at).toLocaleString(language === "zh" ? "zh-CN" : "en")
    : "";
}
function visibleItems() {
  return filterItems(
    state.items,
    $("search").value,
    $("filter").value,
    new Set(state.stats.duplicate_groups.flat()),
  );
}
function renderQueue() {
  const list = visibleItems();
  $("queueCount").textContent = `${list.length} / ${state.items.length}`;
  $("empty").hidden = list.length > 0;
  $("items").replaceChildren(
    ...list.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "clip";
      button.classList.toggle("selected", item.key === selected?.key);
      button.setAttribute("aria-pressed", String(item.key === selected?.key));
      const inner = document.createElement("span");
      inner.className = "clip-inner";
      const name = document.createElement("span");
      name.className = "clip-name";
      name.textContent = item.label;
      const sub = document.createElement("span");
      sub.className = "clip-sub";
      const length = document.createElement("span");
      length.textContent = `${formatTime(item.quality.duration)}${item.quality.flags.length ? " · ⚑" : ""}`;
      const status = document.createElement("span");
      status.className = `status-${item.review.status}`;
      status.textContent = t(item.review.status);
      sub.append(length, status);
      inner.append(name, sub);
      button.append(inner);
      button.addEventListener("click", () => select(item));
      return button;
    }),
  );
}
function discardAllowed() {
  return !dirty || window.confirm(t("discard"));
}
async function select(item) {
  if (saving || !discardAllowed()) return;
  const sequence = ++loading;
  player.pause();
  player.onloadedmetadata = null;
  selected = item;
  dirty = false;
  variant = "a";
  wave = { a: [], b: [] };
  notice("");
  renderQueue();
  renderDetails();
  if (item.quality.decoded) {
    player.src = `/media/${item.key}/a.wav`;
    try {
      const result = await request(`/api/wave/${item.key}`);
      if (sequence === loading) {
        wave = result;
        drawWave();
      }
    } catch (error) {
      if (sequence === loading) notice(error.message);
    }
  } else {
    player.removeAttribute("src");
    player.load();
  }
  $("historyPanel").open = false;
}
function renderDetails() {
  const item = selected,
    review = item.review,
    quality = item.quality;
  $("clipId").textContent = item.id;
  $("clipTitle").textContent = item.label;
  $("statusBadge").textContent = t(review.status);
  $("saveState").textContent = review.version
    ? `${t("saved")} · v${review.version}`
    : t("notReviewed");
  $("qualityFlags").replaceChildren();
  const names = {
    silence_or_very_quiet: "quiet",
    near_full_scale: "nearClip",
    multichannel: "multichannel",
    decode_error: "decodeError",
  };
  const flags = quality.flags.length
    ? quality.flags.map((flag) => t(names[flag] || flag))
    : [t("checks")];
  if (!item.eligible) flags.push(t("ineligible"));
  if (item.error) flags.push(item.error);
  for (const text of flags) {
    const span = document.createElement("span");
    span.className = `flag${item.error ? " error" : quality.flags.length ? "" : " good"}`;
    span.textContent = text;
    $("qualityFlags").append(span);
  }
  $("audioSection").hidden = !quality.decoded;
  $("variantB").disabled = !item.reference_quality;
  $("variantA").classList.toggle("active", variant === "a");
  $("variantA").setAttribute("aria-pressed", String(variant === "a"));
  $("variantB").classList.toggle("active", variant === "b");
  $("variantB").setAttribute("aria-pressed", String(variant === "b"));
  $("technical").replaceChildren(
    ...[
      [
        "rate",
        quality.sample_rate
          ? `${quality.sample_rate.toLocaleString()} Hz`
          : "—",
      ],
      ["channels", quality.channels || "—"],
      [
        "rms",
        Number.isFinite(quality.rms_dbfs)
          ? `${quality.rms_dbfs.toFixed(1)} dBFS`
          : "—",
      ],
      [
        "duration",
        Number.isFinite(quality.duration)
          ? `${quality.duration.toFixed(3)} s`
          : "—",
      ],
    ].map(([label, value]) => {
      const div = document.createElement("div"),
        dt = document.createElement("dt"),
        dd = document.createElement("dd");
      dt.textContent = t(label);
      dd.textContent = value;
      div.append(dt, dd);
      return div;
    }),
  );
  document.querySelectorAll("input[name=decision]").forEach((input) => {
    input.checked = input.value === review.status;
    input.disabled = input.value === "pass" && !quality.decoded;
  });
  $("score").value = review.score ?? "";
  $("score").disabled = !quality.decoded;
  $("trimStart").value = review.trim_start ?? "";
  $("trimEnd").value = review.trim_end ?? "";
  $("trimEnd").placeholder = quality.duration?.toFixed(3) || "—";
  $("note").value = review.note;
  $("issues")
    .querySelectorAll("input")
    .forEach((input) => {
      input.checked = review.issues.includes(input.value);
    });
  updateTime();
  drawWave();
}
async function load() {
  if (saving || !discardAllowed()) return;
  try {
    const result = await request("/api/state"),
      oldKey = selected?.key;
    state = result;
    selected = null;
    dirty = false;
    renderMetrics();
    renderQueue();
    const item =
      state.items.find((row) => row.key === oldKey) || state.items[0];
    if (item) await select(item);
    else {
      $("reviewForm").hidden = true;
      $("clipTitle").textContent = t("empty");
    }
  } catch (error) {
    notice(`${t("loadError")} ${error.message}`);
  }
}
function updateTime() {
  $("playTime").textContent =
    `${formatTime(player.currentTime || 0)} / ${formatTime(selected?.quality.duration || 0)}`;
}
function drawWave() {
  const canvas = $("waveform"),
    width = Math.max(1, canvas.clientWidth),
    height = 120,
    ratio = window.devicePixelRatio || 1;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const data = wave[variant] || [],
    progress = (player.currentTime || 0) / (selected?.quality.duration || 1);
  context.fillStyle = "#29403b";
  context.fillRect(0, height / 2, width, 1);
  for (let i = 0; i < data.length; i++) {
    const x = (i * width) / data.length,
      bar = Math.max(1, data[i] * 100);
    context.fillStyle = i / data.length <= progress ? "#b9ebd3" : "#477b69";
    context.fillRect(
      x,
      height / 2 - bar / 2,
      Math.max(1, width / data.length - 1),
      bar,
    );
  }
  context.fillStyle = "#eef8f1";
  context.fillRect(progress * width, 8, 1, height - 16);
}
async function switchVariant(next) {
  if (
    !selected?.quality.decoded ||
    (next === "b" && !selected.reference_quality) ||
    variant === next
  )
    return;
  const position = player.currentTime,
    resume = !player.paused;
  player.pause();
  variant = next;
  $("variantA").classList.toggle("active", variant === "a");
  $("variantA").setAttribute("aria-pressed", String(variant === "a"));
  $("variantB").classList.toggle("active", variant === "b");
  $("variantB").setAttribute("aria-pressed", String(variant === "b"));
  player.src = `/media/${selected.key}/${variant}.wav`;
  player.onloadedmetadata = () => {
    player.currentTime = Math.min(position, player.duration || 0);
    if (resume) player.play().catch((error) => notice(error.message));
  };
  player.load();
  drawWave();
}
$("reviewForm").addEventListener("input", () => {
  dirty = true;
  $("saveState").textContent = t("unsaved");
});
$("reviewForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selected || saving) return;
  const payload = reviewPayload(selected, {
    status: document.querySelector("input[name=decision]:checked")?.value,
    score: $("score").value,
    trimStart: $("trimStart").value,
    trimEnd: $("trimEnd").value,
    issues: [...$("issues").querySelectorAll("input:checked")].map(
      (input) => input.value,
    ),
    note: $("note").value,
  });
  const controls = [
      ...$("reviewForm").querySelectorAll("input,textarea,button"),
    ],
    disabled = controls.map((control) => control.disabled);
  saving = true;
  controls.forEach((control) => {
    control.disabled = true;
  });
  $("saveState").textContent = t("saving");
  try {
    const result = await request("/api/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Review-Token": state.session,
      },
      body: JSON.stringify(payload),
    });
    selected.review = result.review;
    dirty = false;
    $("saveState").textContent = `${t("saved")} · v${result.review.version}`;
    const current = state.items.find((item) => item.key === selected.key);
    if (current) current.review = result.review;
    $("statusBadge").textContent = t(result.review.status);
    renderQueue();
    notice(t("saved"), true);
    try {
      state = await request("/api/state");
      renderMetrics();
      renderQueue();
    } catch {
      notice(
        language === "zh"
          ? "审核已保存，但统计刷新失败，请稍后刷新。"
          : "Review saved; counts could not refresh. Refresh when the server is available.",
        true,
      );
    }
  } catch (error) {
    notice(`${t("saveError")} ${error.message}`);
    $("saveState").textContent = t("unsaved");
  } finally {
    saving = false;
    controls.forEach((control, index) => {
      control.disabled = disabled[index];
    });
  }
});
$("historyPanel").addEventListener("toggle", async () => {
  if (!$("historyPanel").open || !selected) return;
  const key = selected.key;
  try {
    const result = await request(`/api/history/${key}`);
    if (key !== selected?.key) return;
    $("history").replaceChildren(
      ...result.history.map((review) => {
        const p = document.createElement("p");
        p.textContent = `v${review.version} · ${t(review.status)} · ${review.updated_utc}\n${review.note}`;
        return p;
      }),
    );
    if (!result.history.length) $("history").textContent = t("noHistory");
  } catch (error) {
    notice(error.message);
  }
});
$("language").addEventListener("change", () => {
  if (saving || !discardAllowed()) {
    $("language").value = language;
    return;
  }
  language = $("language").value;
  dirty = false;
  translate();
});
$("refresh").addEventListener("click", load);
$("search").addEventListener("input", renderQueue);
$("filter").addEventListener("change", renderQueue);
$("variantA").addEventListener("click", () => switchVariant("a"));
$("variantB").addEventListener("click", () => switchVariant("b"));
player.addEventListener("timeupdate", () => {
  updateTime();
  drawWave();
});
player.addEventListener("error", () => {
  if (selected?.quality.decoded) notice(t("soundError"));
});
$("waveform").addEventListener("click", (event) => {
  if (Number.isFinite(player.duration))
    player.currentTime =
      (event.offsetX / $("waveform").clientWidth) * player.duration;
});
window.addEventListener("resize", drawWave);
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    $("reviewForm").requestSubmit();
    return;
  }
  if (
    event.target.closest("input,textarea,select,button,a,summary") ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (event.code === "Space") {
    event.preventDefault();
    if (selected?.quality.decoded) {
      if (player.paused) player.play().catch((error) => notice(error.message));
      else player.pause();
    }
  }
  if (event.key.toLowerCase() === "b")
    switchVariant(variant === "a" ? "b" : "a");
  if (["j", "k"].includes(event.key.toLowerCase())) {
    const list = visibleItems(),
      index = list.findIndex((item) => item.key === selected?.key),
      next = list[index + (event.key.toLowerCase() === "j" ? 1 : -1)];
    if (next) select(next);
  }
});
translate();
load();
