"""One background import per local server, with progress and pre-commit cancellation."""
from __future__ import annotations

import threading
import uuid
from pathlib import Path

from .workspace import Conflict, ImportCancelled, Workspace
from .errors import error_code


class ImportJobs:
    def __init__(self, workspace: Workspace):
        self.workspace = workspace
        self.lock = threading.RLock()
        self.cancelled = threading.Event()
        self.current = {"id": None, "state": "idle", "done": 0, "total": 0, "label": "", "error": None}
        self.thread: threading.Thread | None = None
        self.cancellable = False

    def snapshot(self) -> dict:
        with self.lock:
            return dict(self.current)

    def start(self, kind: str, source: str | list[str], append: bool = True) -> dict:
        if not isinstance(kind, str) or kind not in {"directory", "manifest", "files"}:
            raise ValueError("Choose a folder or manifest path")
        if type(append) is not bool:
            raise ValueError("append must be a boolean")
        if kind == "files":
            if not isinstance(source, list) or not 1 <= len(source) <= 500 or any(not isinstance(p, str) or not p.strip() for p in source):
                raise ValueError("Select between 1 and 500 audio files")
            for value in source:
                candidate=Path(value).expanduser()
                if candidate.is_symlink():
                    raise ValueError("Symbolic links are not supported")
                resolved=candidate.resolve(strict=True)
                if not resolved.is_file():
                    raise ValueError("The path does not match the selected import type")
                self.workspace.assert_input_separate(resolved.parent)
            path = source
        else:
            if not isinstance(source, str) or not source.strip():
                raise ValueError("Choose a folder or manifest path")
            path = Path(source).expanduser().resolve(strict=True)
            if (kind == "directory" and not path.is_dir()) or (kind == "manifest" and not path.is_file()):
                raise ValueError("The path does not match the selected import type")
        if kind == "directory":
            self.workspace.assert_input_separate(path)
        with self.lock:
            if self.current["state"] in {"running", "cancelling"}:
                raise Conflict("An import is already running")
            self.cancelled = threading.Event()
            self.cancellable = True
            self.current = {"id": uuid.uuid4().hex, "state": "running", "done": 0, "total": 0,
                            "label": "" if isinstance(path, list) else path.name, "error": None, "error_code": None, "phase": "reading"}
            self.thread = threading.Thread(target=self._run, args=(kind, path, append), daemon=True)
            self.thread.start()
            return dict(self.current)

    def progress(self, done: int, total: int, label: str, phase: str) -> None:
        with self.lock:
            if self.cancelled.is_set():
                raise ImportCancelled("Import cancelled; the previous file list is unchanged")
            if phase == "saving":
                self.cancellable = False
            self.current.update(done=done, total=total, label=label, phase=phase)

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            if job_id != self.current["id"] or self.current["state"] not in {"running", "cancelling"}:
                raise Conflict("This import is no longer running")
            if not self.cancellable:
                raise Conflict("Import is finishing; refresh the file list in a moment")
            self.cancelled.set()
            self.current["state"] = "cancelling"
            return dict(self.current)

    def _run(self, kind: str, path: Path, append: bool) -> None:
        try:
            method = {"directory": self.workspace.scan, "manifest": self.workspace.import_manifest, "files": self.workspace.import_files}[kind]
            result = method(path, append=append, progress=self.progress, cancelled=self.cancelled)
            with self.lock:
                self.current.update(state="succeeded", stats=result["stats"], phase="done", label="" if isinstance(path, list) else path.name)
        except ImportCancelled:
            with self.lock:
                self.current.update(state="cancelled", phase="done", error=None)
        except Exception as exc:
            with self.lock:
                self.current.update(state="failed", phase="done", error=str(exc)[:600], error_code=error_code(exc))
        finally:
            with self.lock:
                self.cancellable = False
