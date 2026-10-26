# Audio Review Desk：音频质检与听审台

这是一个本地运行的音频检查与人工听审工具。它把技术检测、人工评分、版本记录和时间线统计放在同一个工作区中，适合整理语音、歌声及其他音频数据集。

[English](../README.md) · [安装说明](installation.md) · [导入格式](manifests.md) · [时长统计规则](counting.md)

## 安装与体验

需要 Python 3.11 或更高版本。建议新建独立环境，不复用模型训练环境。

Windows PowerShell：

```powershell
git clone https://github.com/FUN-ACTION/audio-review-desk.git
cd audio-review-desk
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install .
.\.venv\Scripts\python.exe -m audio_review_desk demo --workspace .ard-demo
.\.venv\Scripts\python.exe -m audio_review_desk serve --workspace .ard-demo --open
```

macOS / Linux 将 `.\.venv\Scripts\python.exe` 换为 `.venv/bin/python`。打开命令打印的 `http://127.0.0.1:8765/`，右上角可切换简体中文。演示音频由程序生成，无需下载素材。

## 使用自己的文件

以下 `python` 指安装了工具的独立环境中的 Python。

```sh
python -m audio_review_desk scan ./audio --workspace ./review-workspace
python -m audio_review_desk serve --workspace ./review-workspace
```

工作区不能放在被扫描的目录里面。原始文件只读；数据库、检测结果和试听副本保存在工作区中。工具没有训练模型、删除素材或改写原始音频的命令。

整数 PCM WAV 无需其他运行库。FLAC、MP3、M4A、OGG、Opus、AIFF 和其他 WAV 编码需要可选的 FFmpeg 与 ffprobe。可以将其加入 PATH，或在 scan/import 和 serve 时都提供 `--ffmpeg`、`--ffprobe` 路径。

要导入已经切分的片段及来源时间，请使用 CSV／JSON 清单，避免把同一录音的重叠片段重复计算。[清单示例](manifests.md)

## 听审与保存

- 选择片段，听 A；如果提供了对齐的参考音频，可切到 B 对照。试听副本用恒定衰减匹配 RMS，原文件不变。
- 标记“通过／待改进／排除／待审核”，再填写可选评分、问题标签、建议边界与备注。零分有效。
- 点击保存。另一页面已更新同一记录时，旧页面会收到冲突提示，草稿不会静默覆盖新记录。
- 音频、参考音频、来源区间或候选资格变化后，新版本从待审核开始，旧审核历史仍保留在数据库。
- 导出 JSON 可保存当前版本记录；restore 只恢复与当前音频版本相符的记录，并追加导入历史。

界面中的建议起止时间相对于片段自身，保存后影响统计，但不会实际裁剪音频。空格播放／暂停，B 切换对照，J/K 选择前后片段，Ctrl+Enter 保存；在表单中输入时不会触发这些播放快捷键。

## 如何理解结果

“PCM 去重时长”是相同采样率、声道及共同 s32 解码精度下的音频去重总长。“候选时间线”和“人工通过时间线”按来源 ID 合并区间，二者不能混为一谈。文件夹扫描时，完全相同的 PCM 默认共用来源 ID；导入清单时，以你提供的录音身份与区间为准。工具不会猜测不同来源名称是否属于同一录音。

技术检测不能证明歌词准确、音色身份、素材权属或适合训练；接近满幅也不等于已经发生削波。第一版定位为单人在本机整理素材，不提供远程协作服务。

许可证为 MIT。仓库只包含工具、测试和合成示例生成器，不包含歌手录音、模型权重或私人审核数据库。
