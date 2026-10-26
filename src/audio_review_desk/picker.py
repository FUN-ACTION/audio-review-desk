"""A user-triggered native chooser in a separate process; no audio is copied."""
from __future__ import annotations

import json
import subprocess
import sys
import threading
from pathlib import Path

_lock = threading.Lock()


def choose(kind: str) -> str | None:
    if not isinstance(kind, str) or kind not in {"directory", "manifest"}:
        raise ValueError("Choose a folder or manifest")
    if not _lock.acquire(blocking=False):
        raise ValueError("A selection window is already open")
    try:
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
        # On Windows the venv redirector spawns a second process. Run this
        # stdlib-only helper with its base interpreter so timeout kills the GUI too.
        executable = getattr(sys, "_base_executable", sys.executable) if sys.platform == "win32" else sys.executable
        result = subprocess.run([executable, str(Path(__file__).resolve()), kind],
                                capture_output=True, text=True, encoding="utf-8", timeout=300, **options)
        if result.returncode:
            raise ValueError("The file chooser is unavailable. Enter a path instead.")
        value = json.loads(result.stdout)
        if value is not None and (not isinstance(value, str) or not value):
            raise ValueError("Invalid selection")
        return value
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        raise ValueError("The file chooser is unavailable. Enter a path instead.") from exc
    finally:
        _lock.release()


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {"directory", "manifest"}:
        return 2
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.update()
        try:
            if sys.argv[1] == "directory":
                selected = filedialog.askdirectory(parent=root, title="Audio Review Desk · Select audio folder", mustexist=True)
            else:
                selected = filedialog.askopenfilename(parent=root, title="Audio Review Desk · Select manifest",
                    filetypes=[("Audio manifest", "*.csv *.json"), ("CSV", "*.csv"), ("JSON", "*.json")])
        finally:
            root.destroy()
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(selected or None, ensure_ascii=False))
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
