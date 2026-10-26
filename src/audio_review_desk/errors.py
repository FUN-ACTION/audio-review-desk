"""Stable UI error codes; command-line diagnostics retain their original text."""
from __future__ import annotations

RULES = (
    ("Workspace must be outside", "source_contains_workspace"),
    ("Another page updated", "review_conflict"), ("updated elsewhere", "review_conflict"),
    ("Source changed", "source_changed"), ("Audio version", "source_changed"),
    ("audio versions changed", "source_changed"),
    ("Choose a folder", "path_required"), ("does not match the selected import type", "path_type"),
    ("No supported audio", "no_audio"), ("Manifest is empty", "empty_manifest"),
    ("JSON manifest needs", "manifest_format"), ("Every item needs", "manifest_format"),
    ("Each item needs", "duplicate_id"), ("already belongs to another file", "duplicate_id"),
    ("Unsupported", "unsupported_audio"), ("Symbolic links", "symlink"),
    ("Import is already running", "import_busy"), ("An import is already running", "import_busy"),
    ("already open", "picker_busy"), ("chooser is unavailable", "picker_unavailable"),
    ("Score must", "score_range"), ("Unknown issue", "review_invalid"),
    ("Invalid note", "review_invalid"), ("Unknown review", "review_invalid"),
    ("Unreadable audio", "unreadable"), ("Trim", "trim_invalid"),
    ("Time notes need", "marker_invalid"), ("at most 100 time notes", "marker_limit"),
    ("between 1 and 500", "selection_limit"),
    ("No saved review", "undo_empty"), ("No A/B reference", "no_reference"),
    ("Install FFmpeg", "decoder_missing"), ("Cannot probe", "decode_failed"),
    ("Truncated", "decode_failed"), ("Empty audio", "decode_failed"),
    ("Audio decode", "decode_failed"), ("Invalid integer", "decode_failed"),
    ("reference must be time-aligned", "reference_alignment"),
    ("Source interval", "source_interval"),
    ("Reload this local page", "reload_required"),
    ("Source is unavailable", "source_missing"), ("Audio file unavailable", "source_missing"),
    ("Import is finishing", "import_finishing"), ("no longer running", "import_finished"),
    ("could not completely decode", "decode_failed"),
)


def error_code(error: Exception | str) -> str:
    if isinstance(error, (FileNotFoundError, NotADirectoryError)):
        return "source_missing"
    if isinstance(error, PermissionError):
        return "permission_denied"
    text = str(error).lower()
    return next((code for phrase, code in RULES if phrase.lower() in text), "operation_failed")
