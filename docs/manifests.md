# Audio manifests and review exports

Use a manifest when clips have known source timelines or aligned A/B references. File paths are resolved relative to the manifest directory. Absolute paths are also accepted locally. Nothing is imported through a network upload endpoint.

## CSV

Use UTF-8, with or without a BOM. Quoted commas, doubled quote characters (`""`)
and multiline fields are supported. CSV parser errors, such as an unterminated
quoted field, report the physical line where parsing failed. The entire file is
parsed before ingestion; a parsing error leaves the active catalog, import source
and saved review history unchanged.

Nonempty header names must be unique, including names of extra columns. Rows
must not contain more cells than the header, even if the surplus cells are empty.
Older versions silently kept the last duplicate column or discarded surplus cells;
these files now fail with a line-numbered error. Remove duplicate columns or give
extra columns distinct names before importing. Unknown named columns are allowed
and ignored. Missing optional trailing cells use the usual defaults, including
`eligible=true`; explicitly empty cells retain their existing validation rules.
This is not full header/schema validation.

```csv
id,path,label,source_id,source_start,source_end,eligible,reference_path
clip-a,audio/a.wav,First phrase,recording-01,10,12,true,audio/a-reference.wav
clip-b,audio/b.wav,Overlapping phrase,recording-01,11,13,true,
probe,audio/probe.wav,Source probe,recording-02,0,2,false,
```

The example clips are each two seconds long. The overlap in the first two rows contributes three source seconds, not four, when both qualify for the same total.

## JSON

JSON manifests use UTF-8 with or without a BOM. Each object must have unique
property names, including nested objects in extra metadata. Names are compared
after JSON escape decoding, so `"path"` and `"p\u0061th"` are the same name.
Earlier versions silently kept the last repeated property; these manifests now
fail before ingestion with an error naming the duplicate property. Remove the
ambiguity explicitly before importing. Unknown unique properties and repeated
names in separate objects remain allowed. The same duplicate-property check also
applies to CLI review restore files and HTTP JSON request bodies. It is not full
JSON/schema validation and does not add line/column locations to duplicate-property
errors.

```json
{
  "schema": "audio-review-desk/v1",
  "items": [
    {"id": "clip-a", "path": "audio/a.wav", "label": "First phrase",
     "source_id": "recording-01", "source_start": 10, "source_end": 12,
     "eligible": true, "reference_path": "audio/a-reference.wav"}
  ]
}
```

| Field | Meaning |
| --- | --- |
| `path` | Required audio file path. Missing/corrupt files remain visible as errors. |
| `id` | Stable, unique clip ID; defaults to the supplied path. Keep it stable across rescans. |
| `label` | Optional human-readable label. Changing a label does not invalidate a score. |
| `source_id` | Recording identity supplied by you. Defaults to the decoded PCM hash. |
| `source_start` | Nonnegative start on the source recording's timeline, in seconds; defaults to 0. |
| `source_end` | End on that timeline. Defaults to start + decoded duration. Interval length must match duration within one sample. |
| `eligible` | `true` / `false` (CSV also accepts `1` / `0`). Defaults to true if the column is absent. This is candidate eligibility, not a human approval. |
| `reference_path` | Optional time-aligned clip for B. Duration must differ by no more than 50 ms. No alignment is guessed. |

CLI scan/import replaces the active list unless `--append` is supplied. The graphical importer keeps other collections by default. In append mode, a known collection is refreshed as a unit; other collections stay active. Ambiguous IDs pointing to different files are rejected. Historical versions and decisions remain stored even when an item leaves the active catalog. A malformed manifest is rejected before the active catalog changes; individual audio decode errors are reported as unreadable items.

## Version binding

A review key includes clip ID, original file SHA-256, source identity and interval, eligibility, and reference file SHA-256. Container-only changes also invalidate a decision, even if the PCM remains identical. This is intentional: PCM deduplication and human review identity solve different problems.

An old audio version's score remains in history and is not silently transferred to a new file. Source hashes are checked before saving or generating/serving a preview; external edits require a rescan.

Keys are content-addressed: reimporting an exact previously reviewed version restores that version's own decision. An unseen version starts pending. Export also checks source hashes and refuses stale file references.

### Missing or unverified primary audio (A)

A primary file without an expected SHA-256 has no verified audio version. This applies to new missing/unreadable imports and legacy records. Saves, undo, batch changes, JSON/CSV exports and restoration of saved reviews are blocked even if a file later appears at that path. The app never hashes current bytes into an old unbound record to certify its decisions. One active unverified A blocks the **entire export**, including status-filtered CSV; healthy rows are not silently exported on their own.

Back up the entire workspace before recovery, following the procedure below. Make A readable and reimport to establish a new pending version, then review it again. Old metadata, decisions and history remain stored, but cannot be restored onto the new version. An import that would reuse an unverified A key at a different path is rejected atomically, even when the historical row is inactive. Use an explicitly chosen new manifest ID for a separate assessment. Do not edit database or export keys to bypass this guard. If you need to export unaffected items, use a separate workspace copy and replace only that copy's active catalog with the healthy subset.

Already-bound healthy and corrupt A files keep their existing keys and exact-byte restore behavior. If A was successfully analyzed before a later B or interval failure, its analyzed digest is retained, even if A subsequently becomes unreadable. Current bytes must still match that digest before any decision is saved, exported or restored. Restoring the exact bytes of an already-bound file allows operations to resume; merely supplying bytes for an unbound legacy file does not.

### Failed or unavailable A/B references

Reference byte identity is recorded separately from playable audio metadata (`reference_sha256`). A malformed or duration-mismatched B still binds the review to its bytes. Reimporting those same bytes keeps that version's review; changing B creates a pending version. B is also hashed when A fails. This does not make invalid B playable or approvable. Healthy references and A-only items retain their existing keys, and healthy legacy exports still restore normally.

A configured B that cannot be read has no trustworthy byte identity. Saves, undo, batch changes, JSON/CSV exports and review restore fail closed until the reference is readable and the item is reimported. The unavailable version cannot be certified just because a file later appears. If a previously hashed file becomes unavailable, restoring the exact scanned bytes is enough to resume operations without reimporting.

**Compatibility restriction:** older failed-reference items may have no reference hash. They remain visible, and their saved reviews and history are retained, but editing, exporting or restoring those decisions is blocked. One such active item blocks the entire JSON or CSV export, including a status-filtered CSV. The app never fills in a historical hash from today's file. After a full workspace backup, reimport the same manifest with readable B to establish a new pending version, then assess it again. Old decisions are not transferred, and old exports for those unbound versions cannot be restored onto the new key. Reimport does not delete historical assets, reviews or history. Do not edit SQLite keys or export keys to force a match.

If A was also unreadable in an older import, removing B can produce the same old key as an A-only item. The app rejects that import rather than overwrite the old reference metadata or reuse its reviews, even if the old item is inactive. Back up the whole workspace first. If you want a separate A-only assessment, explicitly choose a new ID for that item in your manifest and import it as a pending item; no old decision is moved. The app does not rename IDs for you. Ordinary A-only items and healthy legacy A/B items keep their keys. Older app versions do not enforce the separate reference digest or this collision guard; do not use them to bypass these checks or continue reviewing this workspace. Keep any pre-update backup separate and unchanged.

For recovery, stop the app and any CLI process using the workspace, then copy the **entire workspace folder** to a separate backup destination, including `reviews.sqlite` and any SQLite sidecars (`reviews.sqlite-wal`, `reviews.sqlite-shm`) present. Keep the source audio and original manifest separately too; the workspace does not embed them. To recover the complete catalog and all historical decisions, keep the current folder as a separate backup and reopen an untouched copy of the saved workspace, with the matching source files restored at their original paths. Review JSON is not a full-workspace recovery mechanism. An old unbound primary or reference remains blocked under the updated app even after full-folder recovery; the backup preserves the original evidence rather than certifying it. To export unrelated healthy items without altering the original catalog, work in a separate copy of the workspace and replace its active catalog with a manifest containing only those items with unchanged IDs, source metadata and bytes. Historical rows remain in that copy too.

## Export and restore

CLI exports are written to a temporary file in the destination directory, flushed, synced and closed before publication. An existing output is never replaced, including when another export creates it concurrently. A write failure leaves the final filename available for a corrected retry. Windows uses a non-replacing rename; POSIX systems require hard-link support on the destination filesystem and fail safely if unavailable (for example, some removable or network filesystems). There is no direct-write or overwriting fallback. Choose another supported writable destination if publication fails.

On POSIX, new exports retain the temporary file's private owner-only permissions (normally `0600`, subject to a more restrictive umask), instead of the previous normal file-creation permissions. Windows permissions follow the destination directory's ACL behavior. Cleanup errors are warnings: an already published export remains successful, while an earlier write error remains a failure. A warning or interrupted process can leave a `.audio-review-export-*.tmp` file containing review data beside the destination; remove only the named leftover after the export process has stopped. This protects against partial writes and competing output creation, not hostile directory modifications or guaranteed recovery after power loss. Browser downloads are unchanged.

An interrupted or uncertain publication can leave a complete final output even if the command did not report success. The CLI never deletes that destination as rollback. Inspect it before retrying and use a new filename if another export is needed.

The JSON export includes current item metadata, current decisions, audio hashes, and aggregate statistics. Explicit `path` and `reference_path` fields are omitted unless `--include-paths` is supplied. IDs, labels, source IDs and notes are not redacted. When a manifest omits `id`, it defaults to the supplied path; an omitted label defaults to that ID. Absolute paths can therefore appear in JSON and CSV exports even without `--include-paths`. Inspect exports before sharing. For new manifests, use non-sensitive stable IDs and labels; changing an existing ID changes its review key, so do not rename IDs merely to sanitize an export. All historical versions remain in SQLite; a JSON export is not a replacement for a full workspace backup.

CLI `restore` rejects repeated property names anywhere in the JSON file, including
nested reviews, markers and otherwise ignored metadata, before changing reviews.
Earlier versions silently kept the last value; remove any ambiguity explicitly.
Duplicates produce CLI exit status 2. Normal legacy exports remain supported,
including omitted `markers`, UTF-8 BOM and unknown unique properties.

HTTP JSON requests use the same check before dispatching any operation. Duplicate
properties return status 422 with the `review_invalid` category. Existing origin,
token, content-type and 128 KiB body-size checks still run before JSON parsing.
This is not a streaming parser or a new request timeout/body-framing policy; it
does not change other JSON syntax, encoding or schema validation rules.

`restore` accepts an export with this schema. Every reviewed row must match a current key and file hash; validation and optimistic version checks protect the batch. Imported decisions receive a new local review revision and `imported_review` origin. Importing a review does not mean that you personally listened to it again.

Before applying a restore, the app validates it against a temporary copy of the entire review database in Python's configured temporary directory. That copy can include inactive assets, source paths, review history and import settings, but not the source audio files. It is normally removed when the restore operation finishes. A forced process termination can leave an `ard-review-validate-*` directory behind, possibly on a different volume from the workspace. On POSIX the temporary directory is created with owner-only access; Windows permissions depend on the temporary directory's access controls. After all relevant restore processes have stopped, inspect and remove only a directory you have positively identified as abandoned. Do not automatically delete directories based solely on their name or age, because another restore may still be using one.

Cleanup failure does not change the restore result: after a confirmed commit, the CLI still reports the restored count and exits 0, with a warning not to retry. Before a confirmed commit, the original validation or transaction error remains the failure. The cleanup warning identifies only the generated `ard-review-validate-*` directory name, not its full path or database contents; locate it under Python's configured temporary directory. Only this operation's directory is cleaned up, never other restores' copies. Diagnostic output failures do not replace the operation result. A cleanup failure can leave the same sensitive database copy described above.

A process interrupt or an error while committing or closing the database can leave the outcome uncertain; cleanup does not convert it into success or roll back an already committed change. Inspect current reviews and history before deciding whether to retry. Restore is not idempotent: deliberately restoring the same export again appends another revision. A cleanup warning after confirmed success is not a reason to restore again. Native Windows sharing behavior, forced termination and power-loss durability have not been established by the deterministic cleanup tests.

Restore applies only rows with a saved review (`review.version > 0`); rows at version 0 are skipped. For example, restoring an export made before a clip was reviewed does not clear a decision saved later in the destination workspace. A saved `pending` review with a positive version is still applied. Restore does not replace the active catalog or remove review history, so use a full workspace backup when you need to recover the entire workspace rather than apply saved decisions.

CSV exports are convenient review tables, not input manifests or full workspace backups. They contain clip IDs, labels, source intervals, hashes, status, score, issues, notes, and suggested bounds. Use `export --format csv --status pass` to export approved rows. Potential spreadsheet formulas in text cells are prefixed with an apostrophe. The explicit CSV `path` column is opt-in through the CLI; the metadata warning above still applies.

Batch status changes support `pending`, `fix`, and `exclude`, preserve existing notes/scores, and commit all selected rows or none. Undo appends a new revision containing the preceding decision; it never removes history. These operations refuse stale versions or changed source files.

## Time notes in review exports

Reviews may include `markers`, an array such as `[{"time": 0.65, "text": "Check the word ending"}]`. Times are clip-relative seconds. Up to 100 notes of 1–240 characters are accepted. The field belongs to the reviewed audio version, participates in undo/history, and is included as JSON text in the CSV `markers` column. A missing field in older review data is supported. Restoring an older JSON export without `markers` restores an empty time-note list, rather than keeping later annotations from the destination workspace. This also applies if the field was manually removed: the format cannot distinguish that from a legacy export. Ordinary saves from older clients that omit this field still preserve current time notes.

Individual-file selection uses stable path-derived clip IDs. To keep IDs across moved files, import a manifest with explicit IDs instead.

## Ogg ending advisories

The local candidate adds two advisory values to the existing `quality.flags` and, when a reference is available, `reference_quality.flags` arrays:

- `ogg_ending_unconfirmed`: consistent observed Ogg framing reached an end without confirming an end-of-stream (EOS) for every observed logical stream. The recording may be unfinished or incomplete, including a live capture. This is not a corruption verdict or an automatic rejection.
- `ogg_check_incomplete`: the framing check could not determine the ending status. Unsupported or inconsistent framing, partial pages and resource limits can prevent a conclusion. This is a distinct neutral state, not a statement that the recording is truncated. A filesystem read error remains an analysis error rather than being converted into this advisory.

The incremental check reads Ogg framing, including page checksums and logical-stream boundaries. It does not assemble codec packets, decode codec headers, interpret granule positions, compare expected duration, or prove the original recording's completeness. Work is bounded to 16 MiB of scanned bytes, 100,000 pages and 4,096 distinct logical-stream serials across the file. Reaching a limit before confirming the end of the check yields `ogg_check_incomplete`. At an exact byte or page cap, the conservative check may stop before testing EOF, so even a file ending exactly there can receive the neutral advisory. A `.ogg` or `.opus` file without the Ogg capture signature (`OggS`) also receives `ogg_check_incomplete`; the extension alone cannot establish framing. No advisory is **not** a completeness assurance: an earlier complete chain could remain after later recording material was lost, or an apparently closed file could still omit material from the original.

The framing pass adds processing time for each Ogg source, including B references. The initial direct-table implementation took 1.96 seconds to reach the 16 MiB cap in a synthetic cloud Linux test. The accelerated implementation preserves the same direct Ogg CRC using standard-library bit-reversal transforms. On the same generated fixtures, three-run median full framing-pass times were 0.966 → 0.0103 seconds for 8,359,168 bytes and 1.987 → 0.0234 seconds for a 16,848,948-byte file stopped at the unchanged 16 MiB cap. Both implementations returned the same advisory states; these are measured warm-cache scanner timings, not decode/import benchmarks or guaranteed latencies. Actual time depends on file structure, CPU, storage and cache state. Per-file checks still add work across large collections. Existing catalog entries receive these advisories only after reanalysis or rescan.

The detail view labels Ogg advisories with A or B, independent of the currently selected playback variant. A B-only Ogg advisory appears in the list indicator and attention filter. The warning statistic counts an item once even when A and B both have advisories or A also has another warning; primary decode errors remain in the separate error count and are not double-counted as warnings. These technical advisories do not change review keys, candidate eligibility, human decisions, permitted playback or interval calculations. Existing decode failures and version-verification protections remain separate.

JSON exports retain these values in the existing A/B quality arrays, without introducing new top-level fields. **CSV exports omit all quality flags, including both Ogg advisories**, and retain their existing columns. Use JSON or inspect the workbench when these technical details are needed. Neither export format nor a successful decode establishes completeness. When that matters, compare the expected duration or an independently supplied checksum against the original source. Source audio is not modified.

Framing references: [RFC 3533](https://www.rfc-editor.org/rfc/rfc3533), [RFC 7845](https://www.rfc-editor.org/rfc/rfc7845) and [Xiph Ogg framing](https://xiph.org/ogg/doc/framing.html).

### MP3 frame-count advisories

New scans compare a positive Xing/Info frame count against a bounded sequential
walk of a single Layer III stream. The producer convention used is LAME/FFmpeg:
the count excludes the metadata frame. `mp3_frame_count_differs` means the counts
differ: the file may be incomplete **or the metadata may be stale**. It does not
prove corruption. `mp3_check_incomplete` means a recognized positive count could
not be compared reliably. Both are nonblocking and attributed separately to A/B.

Supported framing is MPEG-1, MPEG-2 and MPEG-2.5 Layer III with indexed bitrates,
standard sample rates (8–48 kHz), stable version/rate and mono/two-channel layout.
Joint stereo, stereo and dual-channel may vary within the two-channel layout.
The reader allows one leading ID3v2.3 or v2.4 tag with a bounded synchsafe size;
the size excludes the 10-byte header and, for v2.4, its optional verified 10-byte
footer. It does not decode tag payloads. Initially CRC-protected framing, free-format,
unsupported initial framing, missing/zero counts and VBRI-only metadata are not
checked and receive no MP3 flag. No flag is therefore **not proof of completeness**.

After a positive count is recognized, partial frames, framing/layout changes,
subsequent CRC-protected frames or Xing/Info/VBRI headers, trailing tags or other bytes, and limits produce
only check-incomplete. There is no sync search or duration comparison. Reads stop
at 16 MiB or 100,000 frames; memory holds at most a small frame. Cancellation and
source-mutation guards remain in effect. This is not a CRC, bit-reservoir or audio
payload validator. Headerless concatenations with identical framing may remain
indistinguishable. Matching metadata cannot establish original completeness.

Existing records need a rescan. Flags do not change keys, eligibility, human
reviews, approval, or playback. JSON includes A/B flags; CSV does not export quality flags (including MP3 flags),
and its columns stay unchanged.
Check against independent source lengths/checksums when completeness matters.

Convention references: [LAME VbrTag.c](https://github.com/lameproject/lame/blob/master/libmp3lame/VbrTag.c),
[FFmpeg mp3dec.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/mp3dec.c),
[ID3v2.3](https://id3.org/id3v2.3.0),
[ID3v2.4 structure](https://id3.org/id3v2.4.0-structure).

## MP4 container-extent advisories

New scans can report two nonblocking MP4/M4A flags:

- `mp4_extent_exceeds_file`: a fully read top-level box header explicitly declares
  an extent beyond the available file. The file may be incomplete **or metadata
  inconsistent**. A captured live/growing file may be incomplete by design.
- `mp4_check_incomplete`: the narrow extent walk could not finish, for example
  because of a partial header, an undersized header, or the box-count limit.
  This is neutral, not a corruption or missing-audio verdict.

Recognition requires a complete, explicitly sized `ftyp` at byte zero, at most
4,096 bytes, with a major brand `isom`, `iso2`, `mp41`, `mp42`, `M4A ` or `M4B `
(the last two include a space), an eight-byte major-brand/minor-version prefix,
and a compatible-brand list whose length is a multiple of four bytes. Unknown
compatible brands are not rejected. An unknown major brand, leading boxes,
missing/malformed/partial/oversized `ftyp`, or a filename extension alone leaves
the file silently unassessed. These are detection limits, not invalidity claims.

The checker walks at most 4,096 top-level boxes including `ftyp`. It supports
32-bit and unsigned 64-bit sizes, accounts for the extra 16-byte `uuid` user type,
and skips all payloads by seeking. Reads are bounded by the small `ftyp` plus at
most 32 header bytes per box; media payload size does not increase this walk's
read volume. An exact EOF at the box cap needs no extra check. Size zero consumes
the rest of the file and makes no promise of future bytes. Unknown box types are
skipped using their declared sizes. A complete unknown-type header can therefore
also produce an extent advisory; it does not identify what data is absent.

No nested boxes, sample tables, edit lists, durations, track references, or packet
counts are validated. Fragmented and hybrid files use the same top-level extent
walk; no MSE-only ordering, fragment, or sample rules are imposed. Consistent
extents, size-zero `mdat`, or loss of whole final boxes can all yield no advisory
without establishing the original recording's completeness. Successful decoding
also does not establish that completeness. Source hashing and cancellation
remain authoritative: mutation or an I/O failure is not converted into a flag.

A/B labels identify the side with the advisory, and either side can place the
item in Needs attention once. Flags never change decoding, eligibility, review
keys, human approvals, or playback. Existing records require a rescan; JSON
exports preserve A/B quality flags, while the existing CSV omits quality flags.

Framing references: [Apple's Atoms documentation](https://developer.apple.com/documentation/quicktime-file-format/atoms)
(official indexed excerpts verified for zero/extended sizes; the full page could
not be retrieved by the research tool), [W3C ISO BMFF byte-stream note](https://www.w3.org/TR/mse-byte-stream-format-isobmff/)
(which applies to MSE, not every MP4 file), and the
[official FFmpeg MOV reader](https://ffmpeg.org/doxygen/trunk/mov_8c_source.html)
(`mov_read_default`, secondary implementation evidence).
