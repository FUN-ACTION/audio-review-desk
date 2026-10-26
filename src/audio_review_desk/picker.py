"""A user-triggered native chooser in a separate process; no audio is copied."""
from __future__ import annotations

import json
import subprocess
import sys
import threading
from pathlib import Path

_lock = threading.Lock()


def choose(kind: str, language: str = "en") -> str | list[str] | None:
    if not isinstance(kind, str) or kind not in {"directory", "manifest", "files"}:
        raise ValueError("Choose a folder or manifest")
    if not _lock.acquire(blocking=False):
        raise ValueError("A selection window is already open")
    try:
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
        # On Windows the venv redirector spawns a second process. Run this
        # stdlib-only helper with its base interpreter so timeout kills the GUI too.
        executable = getattr(sys, "_base_executable", sys.executable) if sys.platform == "win32" else sys.executable
        result = subprocess.run([executable, str(Path(__file__).resolve()), kind, "zh" if language == "zh" else "en"],
                                capture_output=True, text=True, encoding="utf-8", timeout=300, **options)
        if result.returncode:
            raise ValueError("The file chooser is unavailable. Enter a path instead.")
        value = json.loads(result.stdout)
        valid = (isinstance(value, list) and 1 <= len(value) <= 500 and all(isinstance(p, str) and p for p in value)) if kind == "files" else isinstance(value, str) and bool(value)
        if value is not None and not valid:
            raise ValueError("Invalid selection")
        return value
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        raise ValueError("The file chooser is unavailable. Enter a path instead.") from exc
    finally:
        _lock.release()


def main() -> int:
    if len(sys.argv) not in {2, 3} or sys.argv[1] not in {"directory", "manifest", "files"}:
        return 2
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.update()
        zh = len(sys.argv) == 3 and sys.argv[2] == "zh"
        try:
            if sys.argv[1] == "directory":
                selected = filedialog.askdirectory(parent=root, title="选择音频文件夹" if zh else "Choose an audio folder", mustexist=True)
            elif sys.argv[1] == "files":
                selected = list(filedialog.askopenfilenames(parent=root, title="选择音频文件" if zh else "Choose audio files",
                    filetypes=[("音频文件" if zh else "Audio files", "*.wav *.flac *.mp3 *.m4a *.ogg *.opus *.aif *.aiff")]))
            else:
                selected = filedialog.askopenfilename(parent=root, title="选择清单" if zh else "Choose a manifest",
                    filetypes=[("清单" if zh else "Manifest", "*.csv *.json"), ("CSV", "*.csv"), ("JSON", "*.json")])
        finally:
            root.destroy()
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(selected or None, ensure_ascii=False))
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
