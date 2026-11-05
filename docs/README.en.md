# Audio Review Desk

Review audio collections on your computer. Import files, folders or a manifest, listen to each clip, and save scores, issues, keep ranges and timestamped notes. Export the results as CSV or JSON.

[中文](../README.md) · [Install](installation.md) · [Manifest format](manifests.md) · [Release notes](releases/README.md)

[Project website](https://fun-action.github.io/audio-review-desk/tour/) · [Download](https://github.com/FUN-ACTION/audio-review-desk/releases/latest)

## How it runs

- **Local workspace:** start the service on your computer and review in a browser. Supports Windows, macOS and Linux with Python 3.11 or newer.
- **Project website:** try A/B switching, range looping and timed notes with synthesized audio. Example notes clear on reload; real review records belong in the local workspace.
- **Download:** releases provide a source archive and Python wheel. Both require a Python environment; there is no standalone desktop installer.

## Start

On Windows, unzip the [latest source release](https://github.com/FUN-ACTION/audio-review-desk/releases/latest) and run `start-windows.cmd`. Python 3.11 or newer is required.

On macOS or Linux:

```sh
git clone https://github.com/FUN-ACTION/audio-review-desk.git
cd audio-review-desk
python3 -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/python -m audio_review_desk init --workspace review-workspace
.venv/bin/python -m audio_review_desk serve --workspace review-workspace --open
```

Choose audio files, a folder, or a CSV / JSON manifest. You can select several files at once. Integer PCM WAV works directly; other formats need [FFmpeg and ffprobe](installation.md#optional-ffmpeg).

Quick file, folder and manifest actions append to the library. Their manual recovery keeps that scope and any selected path; if no new path was selected, enter one before retrying. Explicit replacement choices inside the manual dialog remain available. Import writes are never retried automatically.

An import can be cancelled before its saving phase. Once cancellation completes, the previous catalog and saved reviews remain unchanged.

Import status and its completion catalog refresh retry temporary connection errors. New edits, selection or saving stop an older catalog retry so it cannot replace current work.

To learn the workflow without supplying recordings, create generated examples in a **new, empty workspace**. These commands are for macOS / Linux; on Windows, replace `.venv/bin/python` with `.venv\Scripts\python.exe`:

```sh
.venv/bin/python -m audio_review_desk demo --workspace demo-workspace
.venv/bin/python -m audio_review_desk serve --workspace demo-workspace --open
```

Listen to a clip, save a decision, then export the results. The examples include duplicates, silence and an undecodable item to demonstrate different review states.

## Review

The workspace has a library, a listening area and a review panel. Search matches filenames, review notes and time notes. Saved annotation matches show a bounded original-text excerpt and, for time notes, their timestamp, helping distinguish identical filenames. Default and filename-only results stay compact. Excerpts appear only in the existing local review interface, exclude unsaved edits and never seek or play automatically. Ctrl / Cmd K opens clips and common actions. If the library changes while the palette is open, activating a result uses its current record. Removed results show a notice without changing the current draft.

| Task | Controls |
| --- | --- |
| Compare | Switch A / B between the original and the reference in a manifest; change speed or loop a phrase |
| View spectrum | Switch between waveform and a spectrogram of the actual preview PCM |
| Check boundaries | Audition either edge with context, or play the complete selection |
| Trim quiet edges | Suggest a range from detected edge silence, then listen before saving |
| Mark an issue | Add a noise, cut or distortion note at the playhead |
| Annotate | Press M to focus the note input; submitting adds it at the then-current playhead. Click its time to seek, or its text to edit the note and timestamp |
| Set a range | Drag the waveform edges, or press `[` / `]` to mark the playhead position |
| Decide | Approve, mark for work, or exclude; Save & continue opens the next pending clip in the current search and filter results |
| Export | Export approved reviews as CSV, or the full review as JSON; both include ranges and time notes |

Undo restores the previous review while keeping its history.

History lists the latest versions first, including decisions, scores, issue labels, kept ranges and notes. Load a past version as an unsaved draft, review it, then choose Save. Existing unsaved edits require discard confirmation; loading never directly replaces a saved review.

Unsaved edits keep one reload copy in **this tab’s session**. A compact “Tab copy” disclosure beside the review state shows its scope, time and Clear action. The full panel appears only when recovery needs a decision or encounters a problem. After reloading, explicitly choose Restore. The result is still a draft: only Save writes review history. Unfinished new or inline time-note edits are preserved without silently committing them.

Restoration checks the audio version, original review version and complete saved baseline. Changed or incompatible records remain available to view, copy or clear, and never overwrite newer reviews automatically. Clearing a copy leaves live edits intact; a later edit can create another copy.

The reload copy contains no audio files or write token and is outside workspace backups and exports. It supports the same tab and address, not guaranteed recovery after closing a tab, clearing browser data or changing the address. Unavailable storage or incomplete numeric input that the browser cannot expose reports protection as unavailable. Complete valid input and Save; this copy is not a backup.

Batch changes preserve notes and scores; approval is per clip. This browser remembers listening position, speed and volume. Position memory can be turned off in Help.

Save & continue looks for other pending clips only within the current search and filter results. If none remain there but the catalog has pending clips elsewhere, it stays on the current clip. The completion screen appears only after a successful post-save catalog refresh confirms that no pending clips remain in the full catalog.

Next pending in the sidebar and command palette ignores the current search and filter, follows the full catalog order, skips reviewed clips and wraps after the last item.

Batch selections remain checked across searches and filters. The action area shows the total and how many selected clips are outside the current results. Select visible affects only those results; Clear selection removes every check without changing your review draft or filter. A batch supports up to 500 clips, with an explanation when the limit is exceeded.

A/B switching preserves the current position and play/pause intent, including pause commands while loading. With a shorter reference, looping uses the playable overlap. If the reference has none of the selected range, playback pauses with a message; switch back, adjust the range or turn off looping.

A/B comparison requires a reference in a [manifest](manifests.md). The spectrogram analyzes at most the first 2 minutes; previews larger than 32 MiB use the waveform view. Automatic checks offer hints and never assign human scores or approve clips.

## Files and updates

Source audio is read-only. Keep ranges do not crop files. A separate workspace stores the database, review history and listening copies.

Before upgrading, stop the old server and back up the **entire workspace**. Install the update in the app's existing virtual environment, then reopen the original workspace path. [Each release](releases/README.md) includes its changes and upgrade commands.

Changed audio or references start a new pending version. Use stable manifest IDs when moving files. See [counting and precision](counting.md) for source overlap and PCM comparison rules.

Inspect exports before sharing. Only explicit file-path fields are omitted by default; IDs, labels and notes are not redacted. A manifest without an ID uses its supplied path as the ID, and an omitted label uses that ID, so exports may still contain absolute paths. See [export and restore](manifests.md#export-and-restore).

## Website artwork

The website renders an original acoustic sculpture from code. Three examples let you compare a synthesized phrase, loop a range and add temporary time notes. You can also choose local music for the main visual. See [artwork](artwork.md) and [media notes](showcase-media.md).

## Development

```sh
python -m pip install -e .
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

Tests use temporary workspaces and generated signals. Node.js 22+ is only needed for frontend tests.

For bug reports, include reproduction steps and a small sample you can share. See [contributing](../CONTRIBUTING.md), [0.13.0 release verification](verification.md), [unreleased maintenance verification](verification-2026-11-maintenance.md) and [third-party licences](../THIRD_PARTY_NOTICES.md). The application code is MIT-licensed.

Missing or unreadable primary audio without an expected file hash cannot receive or restore review decisions, even if a file later appears. One active unverified item blocks the whole JSON/CSV export, including status-filtered CSV. Back up the entire workspace, make A readable, then reimport and review the new version. Historical records remain intact. Use a separate workspace copy to export an unaffected subset. See [version binding and recovery](manifests.md#missing-or-unverified-primary-audio-a).

### Ogg ending advisories (local candidate)

A successful decode does not establish that the original recording is complete. “Ogg ending not confirmed” means the ending was not confirmed: the file may be unfinished or incomplete, including a live capture. “Ogg check incomplete” is a separate neutral state where the check could not determine the ending status. Details identify A or B explicitly. A B-only advisory enters the attention list, and each item is counted once. Absence of an advisory is not a completeness guarantee.

These advisories do not change version keys, candidate eligibility, human approval or playback. JSON retains A/B quality flags; CSV does not export quality flags. The check has byte/page/stream limits and does not interpret codecs or timestamps. See [Ogg check scope](manifests.md#ogg-ending-advisories). Compare expected duration or an independently supplied checksum with the original source when completeness matters.

New scans also provide a nonblocking MP3 frame-count advisory for supported files
with a positive Xing/Info count. A differing count may mean incomplete audio or
stale metadata; an incomplete check does not mean corruption. Missing/zero counts
and unsupported initial layouts do not add attention flags. No flag establishes
completeness. Existing records need a rescan. See [MP3 scope](manifests.md#mp3-frame-count-advisories).

New scans can show nonblocking MP4/M4A container-extent advisories for supported
files. A declared extent beyond available bytes may indicate an incomplete file
or inconsistent metadata; an incomplete check is neutral. No advisory proves
completeness, and growing files may be unfinished by design. Existing records
need rescan; CSV omits quality flags. See [scope](manifests.md#mp4-container-extent-advisories).
