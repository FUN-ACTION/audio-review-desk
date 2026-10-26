# Audio Review Desk

在本机整理和听审音频。把需要检查的文件找出来，对照参考音频试听，再保存区间、评分和处理意见。

[English](docs/README.en.md) · [安装](docs/installation.md) · [清单格式](docs/manifests.md) · [版本记录](docs/releases/README.md)

![素材库、波形和审核面板](docs/screenshot-zh-CN.png)

截图中的音频是生成的测试信号。

## 打开应用

Windows 下载并解压 [最新源码包](https://github.com/FUN-ACTION/audio-review-desk/releases/latest)，双击 `start-windows.cmd`。需要 Python 3.11 或更新版本；启动器会建立应用自己的虚拟环境。

macOS / Linux：

```sh
git clone https://github.com/FUN-ACTION/audio-review-desk.git
cd audio-review-desk
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/python -m audio_review_desk serve --workspace review-workspace --open
```

打开后选择音频文件夹，或载入 CSV / JSON 清单。也可以手动填写路径。普通 PCM WAV 直接可用；FLAC、MP3 等格式需要 [FFmpeg 与 ffprobe](docs/installation.md#optional-ffmpeg)。

## 听完一段，留下一个决定

左边筛选素材，中间试听，右边填写审核。可以按电平、重复文件或处理状态查找，也可以直接搜索文件名。

| 要做的事 | 操作 |
| --- | --- |
| 对照处理前后的音频 | 切换 A / B，播放位置保持一致 |
| 听清一个字或片段边界 | 放大波形，拖动起止边界，打开循环或降低速度 |
| 连续审核 | 保存并继续；J / K 切换文件 |
| 一起标记需要处理的文件 | 勾选后批量标记为待处理、排除或待审 |
| 改回上一次决定 | 撤销上次审核；历史仍保留 |
| 交给下一个工具处理 | 导出通过项 CSV，或用 JSON 备份完整记录 |

边界获得焦点后，方向键每次移动 10 毫秒，Shift + 方向键移动 100 毫秒。波形是峰值概览；放大便于定位，不增加原有概览的采样精度。

## 文件和记录放在哪里

原音频保持只读。数据库和试听副本写入单独的 `review-workspace`，区间只记作建议，不会切掉原文件。使用时不需要账户、API Key 或模型。

音频、参考文件或来源区间变化后，新版本回到待审，旧记录仍属于旧版本。同一录音的重叠片段合并统计，PCM 重复音频另行去重。具体规则见 [时长统计](docs/counting.md)。

## 这一版

**0.4.0** 加入本机选择窗口、波形缩放和平移、可拖动的区间边界。空素材库直接显示导入选项，界面文字、配色与过渡也重新整理了。[完整更新与升级步骤](docs/releases/0.4.0.md)。

升级前停止旧服务，备份整个工作区，再用应用原有虚拟环境安装新版。旧数据库和审核键继续可用；`.ard-demo` 用户请指定原路径启动。每版的兼容处理都写在 [版本记录](docs/releases/README.md) 中。

## 参与维护

```sh
python -m pip install -e .
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

测试使用生成信号和临时工作区。Node.js 22+ 用于前端测试，日常使用只需要 Python。发现问题时，附上复现步骤和不含私人录音的小样例即可。见 [贡献说明](CONTRIBUTING.md) 与 [验证记录](docs/verification.md)。

代码采用 MIT 许可；[随附字体](THIRD_PARTY_NOTICES.md) 使用 SIL OFL 1.1。仓库不包含真实录音、模型权重或私人审核数据库。
