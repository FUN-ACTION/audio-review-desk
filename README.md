# Audio Review Desk

在本机整理和审核音频素材。导入文件、文件夹或清单，逐条试听，记录评分、问题、保留区间和时间批注，再导出 CSV 或 JSON。

[English](docs/README.en.md) · [安装](docs/installation.md) · [清单格式](docs/manifests.md) · [版本记录](docs/releases/README.md)

[项目网站](https://fun-action.github.io/audio-review-desk/tour/) · [下载](https://github.com/FUN-ACTION/audio-review-desk/releases/latest)

## 开始使用

Windows：下载并解压[最新源码包](https://github.com/FUN-ACTION/audio-review-desk/releases/latest)，双击 `start-windows.cmd`。需要 Python 3.11 或更新版本。

macOS / Linux：

```sh
git clone https://github.com/FUN-ACTION/audio-review-desk.git
cd audio-review-desk
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/python -m audio_review_desk init --workspace review-workspace
.venv/bin/python -m audio_review_desk serve --workspace review-workspace --open
```

打开后选择音频文件、文件夹，或 CSV / JSON 清单。可以一次选择多个文件。普通 PCM WAV 直接可用；其他格式需要 [FFmpeg 与 ffprobe](docs/installation.md#optional-ffmpeg)。

## 听审

搜索可匹配文件名、备注和时间批注。按 Ctrl / ⌘ K 可以查找音频或执行常用操作。

| 操作 | 用法 |
| --- | --- |
| 对照试听 | 切换 A / B，比较原音频和清单中的参考版本；可以调速或循环播放 |
| 留下批注 | 按 M，在播放位置写批注；点时间跳转，点文字修改内容和时间 |
| 确定区间 | 拖动波形两端，或用 `[` / `]` 标记当前播放位置 |
| 保存决定 | 通过、待处理或排除；“保存并继续”跳到下一条待审音频 |
| 导出记录 | 导出通过项 CSV，或用 JSON 保存完整审核；两者都包含区间和批注 |

保存后可以撤销，之前的记录仍留在历史中。批量标记保留备注和分数；“通过”需要逐条决定。浏览器会记住播放位置、速度和音量，位置记忆可在帮助中关闭。

## 数据与升级

原音频只供读取，保留区间不会裁剪文件。数据库、审核历史和试听副本放在独立工作区。升级前停止旧服务，备份**整个工作区**，用应用原有虚拟环境安装新版，再指定原路径启动。各版变化和具体命令见[版本记录](docs/releases/README.md)。

音频或参考版本变化后，新版本重新进入待审。移动文件时建议使用清单中的稳定 ID。重叠区间和重复音频的统计规则见[时长与精度](docs/counting.md)。

## 开发

```sh
python -m pip install -e .
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

测试使用临时工作区和生成信号。Node.js 22+ 只用于前端测试，日常使用不需要安装。

提交问题时请附上复现步骤和可公开的小样例。见[贡献说明](CONTRIBUTING.md)、[验证记录](docs/verification.md)和[第三方许可](THIRD_PARTY_NOTICES.md)。代码使用 MIT 许可。
