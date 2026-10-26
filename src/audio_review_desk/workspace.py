"""Catalog, transactional review history, and portable exports."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import sqlite3
import threading
import wave
import io
from typing import Callable
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .audio import AudioError, Decoder, SUPPORTED, analyze, file_sha256, write_preview
from .errors import error_code

SCHEMA = "audio-review-desk/v1"
STATUSES = {"pending", "pass", "fix", "exclude"}
ISSUES = {"cut_start", "cut_end", "noise", "reverb", "backing_voice", "instrument",
          "lyrics", "distortion", "identity", "other"}


class Conflict(ValueError):
    """Another page updated this review, or its audio version is no longer current."""


class ImportCancelled(ValueError):
    """An import stopped before replacing the active catalog."""


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def encode(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def boolean(value: object) -> bool:
    if value is True or str(value).lower() in {"true", "1"}:
        return True
    if value is False or str(value).lower() in {"false", "0"}:
        return False
    raise ValueError("eligible must be true or false")


def merge_ranges(intervals: list[tuple[float, float]]) -> list[list[float]]:
    result: list[list[float]] = []
    for start, end in sorted(intervals):
        if result and start <= result[-1][1]:
            result[-1][1] = max(result[-1][1], end)
        else:
            result.append([start, end])
    return result


def default_review() -> dict:
    return {"status": "pending", "score": None, "issues": [], "note": "", "trim_start": None,
            "trim_end": None, "markers": [], "version": 0, "updated_utc": None, "origin": None}


def public_asset(asset: dict) -> dict:
    result = {key: value for key, value in asset.items() if key not in {"path", "reference_path", "collection_id"}}
    for key in ("quality", "reference_quality"):
        if isinstance(result.get(key), dict):
            result[key] = {k: v for k, v in result[key].items() if k != "waveform"}
    return result


class Workspace:
    def __init__(self, root: Path, decoder: Decoder | None = None):
        self.root = root.resolve()
        self.decoder = decoder or Decoder()
        self.db = self.root / "reviews.sqlite"
        self._preview_lock = threading.Lock()

    def initialize(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS assets(key TEXT PRIMARY KEY, id TEXT, metadata TEXT, active INTEGER);
                CREATE TABLE IF NOT EXISTS reviews(key TEXT PRIMARY KEY, payload TEXT);
                CREATE TABLE IF NOT EXISTS history(seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT, payload TEXT);
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, payload TEXT);
            """)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.db, timeout=20)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def assert_input_separate(self, source: Path) -> None:
        source = source.resolve()
        if self.root == source or self.root.is_relative_to(source):
            raise ValueError("Workspace must be outside the source directory; inputs are read-only")

    def scan(self, source: Path, *, append: bool = False, progress: Callable | None = None,
             cancelled: threading.Event | None = None) -> dict:
        source = source.resolve(strict=True)
        if not source.is_dir():
            raise ValueError("scan expects a directory; use import for a manifest")
        self.assert_input_separate(source)
        rows = [{"id": str(path.relative_to(source).as_posix()), "path": str(path), "label": path.name}
                for path in sorted(source.rglob("*"))
                if path.is_file() and path.suffix.lower() in SUPPORTED and not path.is_symlink()]
        if not rows:
            raise ValueError("No supported audio files found")
        return self.ingest(rows, source, kind="directory", append=append, progress=progress,
                           cancelled=cancelled, source=source)

    def import_manifest(self, manifest: Path, *, append: bool = False, progress: Callable | None = None,
                        cancelled: threading.Event | None = None) -> dict:
        manifest = manifest.resolve(strict=True)
        if manifest.suffix.lower() == ".csv":
            with manifest.open(encoding="utf-8-sig", newline="") as stream:
                rows = list(csv.DictReader(stream))
        else:
            data = json.loads(manifest.read_text(encoding="utf-8-sig"))
            if not isinstance(data, dict) or data.get("schema") != SCHEMA or not isinstance(data.get("items"), list):
                raise ValueError(f"JSON manifest needs schema={SCHEMA!r} and an items array")
            rows = data["items"]
        if not rows:
            raise ValueError("Manifest is empty")
        return self.ingest(rows, manifest.parent, kind="manifest", append=append, progress=progress,
                           cancelled=cancelled, source=manifest)

    def import_files(self, paths: list[str], *, append: bool = False, progress: Callable | None = None,
                     cancelled: threading.Event | None = None) -> dict:
        if not isinstance(paths, list) or not 1 <= len(paths) <= 500 or any(not isinstance(p, str) or not p.strip() for p in paths):
            raise ValueError("Select between 1 and 500 audio files")
        if any(Path(p).is_symlink() for p in paths):
            raise ValueError("Symbolic links are not supported")
        sources = sorted({Path(p).expanduser().resolve(strict=True) for p in paths})
        if any(not p.is_file() for p in sources):
            raise ValueError("The path does not match the selected import type")
        rows = [{"id": "file:" + hashlib.sha256(str(p).encode()).hexdigest()[:24], "path": str(p), "label": p.name} for p in sources]
        return self.ingest(rows, Path.cwd(), kind="files", append=append, progress=progress,
                           cancelled=cancelled, source=sources)

    def ingest(self, rows: list[dict], base: Path, kind: str, *, append: bool = False,
               progress: Callable | None = None, cancelled: threading.Event | None = None,
               source: Path | list[Path] | None = None) -> dict:
        # Validate all rows first; a malformed manifest cannot partially replace a catalog.
        prepared = []
        ids: set[str] = set()
        for raw in rows:
            if not isinstance(raw, dict) or not isinstance(raw.get("path"), str) or not raw["path"].strip():
                raise ValueError("Every item needs a nonempty path")
            item_id = str(raw.get("id") or raw["path"])
            if item_id in ids or len(item_id) > 512:
                raise ValueError("Each item needs a unique id of at most 512 characters")
            ids.add(item_id)
            path = (base / raw["path"]).resolve()
            # Also forbid writing the workspace inside any explicitly imported file's directory.
            self.assert_input_separate(path.parent)
            if path.suffix.lower() not in SUPPORTED:
                raise ValueError(f"Unsupported audio extension for item {item_id}")
            start = float(raw.get("source_start") or 0)
            end = raw.get("source_end")
            end = None if end in (None, "") else float(end)
            if not math.isfinite(start) or start < 0 or (end is not None and (not math.isfinite(end) or end <= start)):
                raise ValueError("Source intervals must be finite, nonnegative, and increasing")
            source_id = str(raw.get("source_id") or "")
            if len(source_id) > 512:
                raise ValueError("source_id is too long")
            reference = raw.get("reference_path")
            reference_path = (base / reference).resolve() if reference else None
            if reference_path:
                self.assert_input_separate(reference_path.parent)
                if reference_path.suffix.lower() not in SUPPORTED:
                    raise ValueError("Unsupported reference audio extension")
            prepared.append({"id": item_id, "label": str(raw.get("label") or item_id)[:512],
                             "path": str(path), "source_id": source_id, "source_start": start,
                             "source_end": end, "eligible": boolean(raw.get("eligible", True)),
                             "reference_path": str(reference_path) if reference_path else None})
        source = source if isinstance(source, list) else (source or base).resolve()
        source_value = [str(p) for p in source] if isinstance(source, list) else str(source)
        source_key = encode(source_value) if isinstance(source_value, list) else source_value
        collection_id = hashlib.sha256(f"{kind}\0{source_key}".encode()).hexdigest()[:24]
        assets = []
        def report(done, label, phase="decoding"):
            if cancelled is not None and cancelled.is_set():
                raise ImportCancelled("Import cancelled; the previous file list is unchanged")
            if progress:
                progress(done, len(prepared), label, phase)
        for index, entry in enumerate(prepared):
            report(index, entry["label"])
            asset = dict(entry)
            asset["collection_id"] = collection_id
            try:
                quality = analyze(Path(asset["path"]), self.decoder)
                if asset["source_end"] is None:
                    asset["source_end"] = asset["source_start"] + quality["duration"]
                if abs(asset["source_end"] - asset["source_start"] - quality["duration"]) > 1 / quality["sample_rate"] + 1e-8:
                    raise ValueError("Source interval length must match clip duration (within one sample)")
                asset["quality"] = quality
                asset["source_id"] = asset["source_id"] or "pcm:" + quality["pcm_sha256"]
                if asset["reference_path"]:
                    reference = analyze(Path(asset["reference_path"]), self.decoder)
                    if abs(reference["duration"] - quality["duration"]) > 0.05:
                        raise ValueError("A/B reference must be time-aligned and within 50 ms of clip duration")
                    asset["reference_quality"] = reference
                asset["error"] = None
            except (AudioError, OSError, ValueError, wave.Error) as exc:
                asset["quality"] = {"decoded": False, "flags": ["decode_error"]}
                try:
                    asset["quality"]["sha256"] = file_sha256(Path(asset["path"]))
                except OSError:
                    pass
                asset["error"] = (f"Audio file unavailable ({type(exc).__name__})" if isinstance(exc, OSError)
                                  else str(exc)[:500])
                asset["error_code"] = error_code(exc)
                asset["eligible"] = False
                asset["source_id"] = asset["source_id"] or "unreadable:" + asset["id"]
                asset["source_end"] = asset["source_start"]
            signature = {"id": asset["id"], "sha256": asset["quality"].get("sha256"),
                         "source_id": asset["source_id"], "source_start": asset["source_start"],
                         "source_end": asset["source_end"], "eligible": asset["eligible"],
                         "reference_sha256": asset.get("reference_quality", {}).get("sha256")}
            asset["key"] = hashlib.sha256(encode(signature).encode()).hexdigest()
            assets.append(asset)
            report(index + 1, entry["label"])
        report(len(prepared), "", "saving")
        self.initialize()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = self.assets(connection) if append else []
            existing_ids = {item["id"]: item for item in existing}
            for asset in assets:
                previous = existing_ids.get(asset["id"])
                if previous and previous["path"] != asset["path"]:
                    raise Conflict(f"Clip ID {asset['id']!r} already belongs to another file; use unique manifest IDs or replace the list")
            if append:
                # Refresh a collection without retaining files that disappeared from it.
                for item in existing:
                    if item.get("collection_id") == collection_id or item["id"] in ids:
                        connection.execute("UPDATE assets SET active=0 WHERE key=?", (item["key"],))
            else:
                connection.execute("UPDATE assets SET active=0")
            for asset in assets:
                connection.execute("INSERT INTO assets VALUES(?,?,?,1) ON CONFLICT(key) DO UPDATE SET metadata=excluded.metadata,active=1",
                                   (asset["key"], asset["id"], encode(asset)))
            connection.execute("INSERT OR REPLACE INTO settings VALUES('scan',?)",
                               (encode({"at": utc(), "kind": kind, "items": len(assets), "label": "" if isinstance(source, list) else source.name}),))
            connection.execute("INSERT OR REPLACE INTO settings VALUES('import_source',?)",
                               (encode({"path": source_value, "kind": kind, "append": append}),))
        return self.state()

    def import_source(self) -> dict | None:
        with self.connect() as connection:
            row = connection.execute("SELECT payload FROM settings WHERE key='import_source'").fetchone()
        return json.loads(row["payload"]) if row else None

    def assets(self, connection: sqlite3.Connection) -> list[dict]:
        return [json.loads(row["metadata"]) for row in connection.execute("SELECT metadata FROM assets WHERE active=1 ORDER BY id")]

    def asset(self, key: str) -> dict:
        with self.connect() as connection:
            row = connection.execute("SELECT metadata FROM assets WHERE key=? AND active=1", (key,)).fetchone()
            if not row:
                raise Conflict("Audio version is no longer current; refresh the catalog")
            return json.loads(row["metadata"])

    @staticmethod
    def review(connection: sqlite3.Connection, key: str) -> dict:
        row = connection.execute("SELECT payload FROM reviews WHERE key=?", (key,)).fetchone()
        return dict(default_review(), **json.loads(row["payload"])) if row else default_review()

    def state(self) -> dict:
        with self.connect() as connection:
            connection.execute("BEGIN")
            items = self.assets(connection)
            for item in items:
                item["review"] = self.review(connection, item["key"])
            scan = connection.execute("SELECT payload FROM settings WHERE key='scan'").fetchone()
        return {"schema": SCHEMA, "items": [public_asset(item) for item in items], "stats": statistics(items),
                "scan": json.loads(scan["payload"]) if scan else None}

    def verify_current(self, asset: dict) -> None:
        for path_key, quality_key in (("path", "quality"), ("reference_path", "reference_quality")):
            if asset.get(path_key):
                expected = asset.get(quality_key, {}).get("sha256")
                if expected is not None and file_sha256(Path(asset[path_key])) != expected:
                    raise Conflict("Source changed since scanning; rescan before reviewing")

    def save_review(self, key: str, payload: dict, origin: str = "human_ui") -> dict:
        asset = self.asset(key)
        clean = self.validate_review(asset, payload)
        self.verify_current(asset)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            active = connection.execute("SELECT active FROM assets WHERE key=?", (key,)).fetchone()
            if not active or not active["active"]:
                raise Conflict("Audio version changed while saving")
            current = self.review(connection, key)
            if payload["expected_version"] != current["version"]:
                raise Conflict("Another page updated this review; reload before saving")
            if "markers" not in payload:
                clean["markers"] = current.get("markers", [])
            review = self.write_review(connection, key, clean, current["version"] + 1, origin)
        return review

    @staticmethod
    def validate_review(asset: dict, payload: dict) -> dict:
        if not isinstance(payload, dict):
            raise ValueError("Review must be an object")
        status = payload.get("status")
        score = payload.get("score")
        issues = payload.get("issues", [])
        note = payload.get("note", "")
        expected = payload.get("expected_version")
        if not isinstance(status, str) or status not in STATUSES:
            raise ValueError("Unknown review status")
        if score is not None and (type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 10):
            raise ValueError("Score must be null or a finite number from 0 to 10")
        if not isinstance(issues, list) or any(not isinstance(issue, str) or issue not in ISSUES for issue in issues):
            raise ValueError("Unknown issue label")
        if not isinstance(note, str) or len(note) > 4000 or type(expected) is not int or expected < 0:
            raise ValueError("Invalid note or expected_version")
        if status == "pass" and not asset["quality"]["decoded"]:
            raise ValueError("Unreadable audio cannot be approved")
        if score is not None and not asset["quality"]["decoded"]:
            raise ValueError("Unreadable audio cannot receive a listening score")
        start, end = payload.get("trim_start"), payload.get("trim_end")
        duration = asset["quality"].get("duration", 0)
        for value in (start, end):
            if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= duration):
                raise ValueError("Trim bounds must be finite seconds within this clip")
        if (start if start is not None else 0) >= (end if end is not None else duration) and duration > 0:
            raise ValueError("Trim start must be before trim end")
        markers = payload.get("markers", [])
        if not isinstance(markers, list) or len(markers) > 100:
            raise ValueError("Use at most 100 time notes")
        clean_markers = []
        for marker in markers:
            if (not isinstance(marker, dict) or type(marker.get("time")) not in (int, float)
                    or not math.isfinite(marker["time"]) or not 0 <= marker["time"] <= duration
                    or not isinstance(marker.get("text"), str) or not 1 <= len(marker["text"].strip()) <= 240
                    or not asset["quality"]["decoded"]):
                raise ValueError("Time notes need a position within the clip and text of 1 to 240 characters")
            clean_markers.append({"time": marker["time"], "text": marker["text"].strip()})
        return {"status": status, "score": score, "issues": sorted(set(issues)), "note": note,
                "trim_start": start, "trim_end": end, "markers": sorted(clean_markers, key=lambda row: row["time"])}

    @staticmethod
    def write_review(connection, key: str, clean: dict, version: int, origin: str) -> dict:
        review = dict(clean, version=version, updated_utc=utc(), origin=origin)
        connection.execute("INSERT OR REPLACE INTO reviews VALUES(?,?)", (key, encode(review)))
        connection.execute("INSERT INTO history(key,payload) VALUES(?,?)", (key, encode(review)))
        return review

    def batch_review(self, changes: list[dict], status: str) -> int:
        if not isinstance(status, str) or status not in {"pending", "fix", "exclude"}:
            raise ValueError("Batch changes support pending, fix, and exclude; approval is per clip")
        if not isinstance(changes, list) or not 1 <= len(changes) <= 500:
            raise ValueError("Select between 1 and 500 clips")
        if any(not isinstance(row, dict) or not isinstance(row.get("key"), str)
               or type(row.get("expected_version")) is not int for row in changes):
            raise ValueError("Each batch item needs a key and an integer expected_version")
        if len({row["key"] for row in changes}) != len(changes):
            raise ValueError("Duplicate clip in batch")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            validated = []
            for change in changes:
                row = connection.execute("SELECT metadata FROM assets WHERE key=? AND active=1", (change["key"],)).fetchone()
                if row is None:
                    raise Conflict("One of the selected audio versions changed; no batch changes were saved")
                asset = json.loads(row["metadata"])
                current = self.review(connection, change["key"])
                if current["version"] != change["expected_version"]:
                    raise Conflict("One selected review was updated elsewhere; no batch changes were saved")
                self.verify_current(asset)
                clean = self.validate_review(asset, dict(current, status=status, expected_version=current["version"]))
                validated.append((change["key"], clean, current["version"] + 1))
            for key, clean, version in validated:
                self.write_review(connection, key, clean, version, "batch_ui")
        return len(validated)

    def undo_review(self, key: str, expected_version: int) -> dict:
        history = self.history(key)
        if not history:
            raise ValueError("No saved review to undo")
        previous = dict(default_review(), **history[-2]) if len(history) > 1 else default_review()
        return self.save_review(key, dict(previous, expected_version=expected_version), origin="undo")

    def export_csv(self, status: str = "all", include_paths: bool = False) -> str:
        if status != "all" and status not in STATUSES:
            raise ValueError("Unknown export status")
        exported = self.export(include_paths)
        columns = ["id", "label", "source_id", "source_start", "source_end", "sha256", "pcm_sha256",
                   "status", "score", "issues", "note", "trim_start", "trim_end", "markers"]
        if include_paths:
            columns.append("path")
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for item in exported["items"]:
            review = item["review"]
            if status != "all" and review["status"] != status:
                continue
            row = {name: item.get(name, "") for name in columns}
            row.update({name: review.get(name, "") for name in ("status", "score", "note", "trim_start", "trim_end")})
            row.update(sha256=item["quality"].get("sha256", ""), pcm_sha256=item["quality"].get("pcm_sha256", ""),
                       issues=";".join(review["issues"]), markers=encode(review.get("markers", [])))
            # Keep spreadsheet programs from evaluating user-supplied cell contents.
            for name, value in row.items():
                if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                    row[name] = "'" + value
            writer.writerow(row)
        return stream.getvalue()

    def history(self, key: str) -> list[dict]:
        with self.connect() as connection:
            return [json.loads(row["payload"]) for row in connection.execute("SELECT payload FROM history WHERE key=? ORDER BY seq", (key,))]

    def export(self, include_paths: bool = False) -> dict:
        with self.connect() as connection:
            connection.execute("BEGIN")
            items = self.assets(connection)
            rows = []
            for item in items:
                self.verify_current(item)
                row = public_asset(item)
                row["review"] = self.review(connection, item["key"])
                if include_paths:
                    row["path"] = item["path"]
                    row["reference_path"] = item["reference_path"]
                rows.append(row)
        return {"schema": SCHEMA, "exported_utc": utc(), "items": rows,
                "stats": statistics(rows), "includes_paths": include_paths}

    def import_reviews(self, document: dict) -> int:
        if not isinstance(document, dict) or document.get("schema") != SCHEMA or not isinstance(document.get("items"), list):
            raise ValueError("Invalid review export schema")
        # Validate every row before mutation; restore all changes in one transaction below.
        if any(not isinstance(row, dict) or not isinstance(row.get("review"), dict)
               or type(row["review"].get("version")) is not int or row["review"]["version"] < 0
               for row in document["items"]):
            raise ValueError("Every imported item needs a review object with an integer version")
        wanted = [row for row in document["items"] if row["review"]["version"] > 0]
        if len({row.get("key") for row in wanted}) != len(wanted):
            raise ValueError("Duplicate review keys in import")
        for row in wanted:
            asset = self.asset(row["key"])
            if row.get("quality", {}).get("sha256") != asset["quality"].get("sha256"):
                raise Conflict("Imported review does not match the current audio hash")
        # A temporary backup protects all-or-nothing behavior across validation/save conflicts.
        # BEGIN for the outer operation is implemented by a single batch connection in restore.
        return self._restore(wanted)

    def _restore(self, rows: list[dict]) -> int:
        # Reuse validation on a disposable database, then atomically copy only reviewed rows.
        import tempfile
        with tempfile.TemporaryDirectory(prefix="ard-review-validate-") as temporary:
            validation = Workspace(Path(temporary), self.decoder)
            validation.initialize()
            with self.connect() as source, validation.connect() as target:
                source.backup(target)
            for row in rows:
                with validation.connect() as connection:
                    current = validation.review(connection, row["key"])
                payload = dict(row["review"], expected_version=current["version"])
                validation.save_review(row["key"], payload, origin="imported_review")
            with self.connect() as connection, validation.connect() as validated:
                connection.execute("BEGIN IMMEDIATE")
                for row in rows:
                    key = row["key"]
                    asset = self.asset(key)
                    self.verify_current(asset)
                    checked = validation.review(validated, key)
                    expected_version = checked["version"] - 1
                    if self.review(connection, key)["version"] != expected_version:
                        raise Conflict("A review changed while importing; no reviews were imported")
                    connection.execute("INSERT OR REPLACE INTO reviews VALUES(?,?)", (key, encode(checked)))
                    connection.execute("INSERT INTO history(key,payload) VALUES(?,?)", (key, encode(checked)))
        return len(rows)

    def preview(self, key: str, variant: str) -> Path:
        with self._preview_lock:
            return self._preview(key, variant)

    def _preview(self, key: str, variant: str) -> Path:
        asset = self.asset(key)
        if variant not in {"a", "b"} or not asset["quality"]["decoded"]:
            raise ValueError("Audio preview unavailable")
        if variant == "b" and not asset.get("reference_quality"):
            raise ValueError("No A/B reference for this clip")
        self.verify_current(asset)
        current = asset["quality"]
        reference = asset.get("reference_quality")
        gains = [1.0, 1.0]
        if reference:
            rms = [current["rms"], reference["rms"]]
            # A silent reference does not mute the other signal; keep useful playback.
            if min(rms) > 1e-6:
                target = min(rms)
                gains = [target / value for value in rms]
            ceiling = max(current["peak"] * gains[0], reference["peak"] * gains[1], 1e-12)
        else:
            ceiling = max(current["peak"], 1e-12)
        headroom = min(1.0, 0.98 / ceiling)
        gain = gains[0 if variant == "a" else 1] * headroom
        path = self.root / "previews" / f"{key}-{variant}.wav"
        if not path.exists():
            audio = asset["path"] if variant == "a" else asset["reference_path"]
            quality = current if variant == "a" else reference
            assert quality is not None
            write_preview(Path(audio), path, quality["sha256"], gain, self.decoder)
        return path


def statistics(items: list[dict]) -> dict:
    counts = {status: 0 for status in sorted(STATUSES)}
    unique: dict[str, float] = {}
    candidates: dict[str, list] = {}
    approved: dict[str, list] = {}
    groups: dict[str, list[str]] = {}
    raw = decoded = warnings = 0
    for item in items:
        review = item.get("review", default_review())
        counts[review["status"]] += 1
        quality = item["quality"]
        if not quality["decoded"]:
            continue
        decoded += 1
        raw += quality["duration"]
        pcm = quality["pcm_sha256"]
        unique[pcm] = quality["duration"]
        groups.setdefault(pcm, []).append(item["id"])
        warnings += bool(quality["flags"])
        if item["eligible"] and review["status"] not in {"fix", "exclude"}:
            start = item["source_start"] + (review["trim_start"] or 0)
            end = item["source_start"] + (review["trim_end"] if review["trim_end"] is not None else quality["duration"])
            candidates.setdefault(item["source_id"], []).append((start, end))
            if review["status"] == "pass":
                approved.setdefault(item["source_id"], []).append((start, end))
    seconds = lambda mapping: sum(end - start for ranges in mapping.values() for start, end in merge_ranges(ranges))
    return {"files": len(items), "decoded": decoded, "errors": len(items) - decoded, "warnings": warnings,
            "raw_seconds": raw, "unique_pcm_seconds": sum(unique.values()),
            "candidate_seconds": seconds(candidates), "human_approved_seconds": seconds(approved),
            "review_counts": counts, "duplicate_groups": [group for group in groups.values() if len(group) > 1]}
