// Each code has both languages. Server diagnostics never become untranslated UI.
export const errorMessages = {
  source_contains_workspace: [
    "这个目录包含应用自己的工作区。请选择存放音频的子文件夹。",
    "This folder contains the app's workspace. Choose the subfolder that holds your audio.",
  ],
  review_conflict: [
    "另一页刚更新了这条审核。刷新后再保存；当前编辑仍保留。",
    "This review changed in another page. Refresh before saving; your draft is still here.",
  ],
  source_changed: [
    "音频文件已有变化。重新扫描后再审核。",
    "The audio changed. Rescan it before reviewing.",
  ],
  path_required: [
    "请先选择文件，或输入完整路径。",
    "Choose files or enter a full path.",
  ],
  path_type: [
    "路径与所选来源不符。请核对文件、文件夹或清单。",
    "The path doesn't match the selected source type. Check the file, folder or manifest.",
  ],
  no_audio: [
    "这个文件夹中没有支持的音频文件。",
    "No supported audio files were found in this folder.",
  ],
  empty_manifest: [
    "这份清单没有音频条目。",
    "This manifest has no audio entries.",
  ],
  manifest_format: [
    "清单格式不正确。请检查路径列和 JSON schema。",
    "Check the manifest's path fields and JSON schema.",
  ],
  duplicate_id: [
    "片段 ID 重复。请为不同文件使用不同 ID。",
    "A clip ID is already in use. Give different files different IDs.",
  ],
  unsupported_audio: [
    "不支持这个音频格式。请选择 WAV、FLAC、MP3、M4A 或 OGG。",
    "This audio format isn't supported. Choose WAV, FLAC, MP3, M4A or OGG.",
  ],
  symlink: [
    "请选择实际文件，不要选择符号链接。",
    "Choose the original files rather than symbolic links.",
  ],
  import_busy: [
    "正在添加音频。完成或停止后，再添加下一批。",
    "An import is running. Finish or stop it before adding more audio.",
  ],
  picker_busy: [
    "选择窗口已打开。请先完成选择或取消。",
    "A selection window is already open. Choose files or cancel it first.",
  ],
  picker_unavailable: [
    "无法打开选择窗口，请输入路径。",
    "The selection window is unavailable. Enter a path instead.",
  ],
  score_range: [
    "评分请填写 0 到 10；也可以留空。",
    "Use a score from 0 to 10, or leave it blank.",
  ],
  review_invalid: [
    "请检查评分、标记和备注后再保存。",
    "Check the score, tags and notes before saving.",
  ],
  unreadable: [
    "文件无法读取，暂时不能评分或通过。",
    "This file can't be read, so it can't be scored or approved.",
  ],
  trim_invalid: [
    "起点应早于终点，且都在音频时长内。",
    "The start must precede the end, with both inside the clip.",
  ],
  marker_invalid: [
    "批注需要有效的播放位置和 1～240 字的内容。",
    "Use a position inside the clip and a note of 1–240 characters.",
  ],
  marker_limit: [
    "每段音频最多保存 100 条时间批注。",
    "Each clip can have up to 100 time notes.",
  ],
  selection_limit: [
    "一次最多选择 500 个文件。",
    "Select up to 500 files at a time.",
  ],
  undo_empty: [
    "这段音频还没有可撤销的审核。",
    "There is no saved review to undo for this clip.",
  ],
  no_reference: ["这段音频没有参考文件。", "This clip has no reference file."],
  decoder_missing: [
    "读取这个格式需要 FFmpeg 和 ffprobe。WAV 可以直接使用。",
    "This format needs FFmpeg and ffprobe. PCM WAV works without them.",
  ],
  decode_failed: [
    "音频未能完整读取。请检查文件是否损坏。",
    "The audio couldn't be fully decoded. Check whether the file is damaged.",
  ],
  reference_alignment: [
    "参考音频与当前片段的时长不匹配。",
    "The reference duration doesn't match this clip.",
  ],
  source_interval: [
    "清单中的来源区间与片段时长不匹配。",
    "The manifest's source interval doesn't match the clip duration.",
  ],
  reload_required: [
    "页面连接已更新。刷新后继续。",
    "The page connection changed. Refresh to continue.",
  ],
  source_missing: [
    "找不到文件或路径。请确认盘符和文件名。",
    "The file or path wasn't found. Check the drive and filename.",
  ],
  permission_denied: [
    "无法读取这个位置。请选择有读取权限的文件。",
    "This location isn't readable. Choose files you can access.",
  ],
  import_finishing: [
    "正在保存这批音频，稍后即可继续。",
    "This import is being saved. It will be ready shortly.",
  ],
  import_finished: [
    "这批音频已结束导入。",
    "This import has already finished.",
  ],
  network: [
    "本地服务没有响应。请确认应用仍在运行。",
    "The local server isn't responding. Check that the app is running.",
  ],
  operation_failed: [
    "操作未完成。请核对输入后重试，当前编辑仍保留。",
    "The action couldn't finish. Check your input and retry; your draft is still here.",
  ],
};
export function errorText(error, language) {
  const code = error?.code || error?.error_code || "operation_failed";
  return (errorMessages[code] || errorMessages.operation_failed)[
    language === "zh" ? 0 : 1
  ];
}
