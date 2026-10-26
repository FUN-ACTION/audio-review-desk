"""Catalog, transactional review history, and portable exports."""
from __future__ import annotations

import csv
import hashlib
import json
import math
import sqlite3
import threading
import wave
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .audio import AudioError, Decoder, SUPPORTED, analyze, file_sha256, write_preview

SCHEMA = "audio-review-desk/v1"
STATUSES = {"pending", "pass", "fix", "exclude"}
ISSUES = {"cut_start", "cut_end", "noise", "reverb", "backing_voice", "instrument",
          "lyrics", "distortion", "identity", "other"}


class Conflict(ValueError):
    """Another page updated this review, or its audio version is no longer current."""


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
            "trim_end": None, "version": 0, "updated_utc": None, "origin": None}


def public_asset(asset: dict) -> dict:
    result = {key: value for key, value in asset.items() if key not in {"path", "reference_path"}}
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

    def scan(self, source: Path) -> dict:
        source = source.resolve(strict=True)
        if not source.is_dir():
            raise ValueError("scan expects a directory; use import for a manifest")
        self.assert_input_separate(source)
        rows = [{"id": str(path.relative_to(source).as_posix()), "path": str(path), "label": path.name}
                for path in sorted(source.rglob("*"))
                if path.is_file() and path.suffix.lower() in SUPPORTED and not path.is_symlink()]
        if not rows:
            raise ValueError("No supported audio files found")
        return self.ingest(rows, source, kind="directory")

    def import_manifest(self, manifest: Path) -> dict:
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
        return self.ingest(rows, manifest.parent, kind="manifest")

    def ingest(self, rows: list[dict], base: Path, kind: str) -> dict:
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
        assets = []
        for entry in prepared:
            asset = dict(entry)
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
                asset["eligible"] = False
                asset["source_id"] = asset["source_id"] or "unreadable:" + asset["id"]
                asset["source_end"] = asset["source_start"]
            signature = {"id": asset["id"], "sha256": asset["quality"].get("sha256"),
                         "source_id": asset["source_id"], "source_start": asset["source_start"],
                         "source_end": asset["source_end"], "eligible": asset["eligible"],
                         "reference_sha256": asset.get("reference_quality", {}).get("sha256")}
            asset["key"] = hashlib.sha256(encode(signature).encode()).hexdigest()
            assets.append(asset)
        self.initialize()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("UPDATE assets SET active=0")
            for asset in assets:
                connection.execute("INSERT INTO assets VALUES(?,?,?,1) ON CONFLICT(key) DO UPDATE SET metadata=excluded.metadata,active=1",
                                   (asset["key"], asset["id"], encode(asset)))
            connection.execute("INSERT OR REPLACE INTO settings VALUES('scan',?)",
                               (encode({"at": utc(), "kind": kind, "items": len(assets)}),))
        return self.state()

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
        return json.loads(row["payload"]) if row else default_review()

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
        self.verify_current(asset)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            active = connection.execute("SELECT active FROM assets WHERE key=?", (key,)).fetchone()
            if not active or not active["active"]:
                raise Conflict("Audio version changed while saving")
            current = self.review(connection, key)
            if expected != current["version"]:
                raise Conflict("Another page updated this review; reload before saving")
            review = {"status": status, "score": score, "issues": sorted(set(issues)), "note": note,
                      "trim_start": start, "trim_end": end, "version": current["version"] + 1,
                      "updated_utc": utc(), "origin": origin}
            connection.execute("INSERT OR REPLACE INTO reviews VALUES(?,?)", (key, encode(review)))
            connection.execute("INSERT INTO history(key,payload) VALUES(?,?)", (key, encode(review)))
        return review

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
