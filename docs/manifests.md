# Audio manifests and review exports

Use a manifest when clips have known source timelines or aligned A/B references. File paths are resolved relative to the manifest directory. Absolute paths are also accepted locally. Nothing is imported through a network upload endpoint.

## CSV

```csv
id,path,label,source_id,source_start,source_end,eligible,reference_path
clip-a,audio/a.wav,First phrase,recording-01,10,12,true,audio/a-reference.wav
clip-b,audio/b.wav,Overlapping phrase,recording-01,11,13,true,
probe,audio/probe.wav,Source probe,recording-02,0,2,false,
```

The example clips are each two seconds long. The overlap in the first two rows contributes three source seconds, not four, when both qualify for the same total.

## JSON

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

Each scan/import replaces the active catalog for **one workspace**. Use separate workspaces for separate collections. Historical versions and decisions remain stored, even when an item leaves the active catalog. A malformed manifest is rejected before the active catalog changes; individual audio decode errors are reported as unreadable items.

## Version binding

A review key includes clip ID, original file SHA-256, source identity and interval, eligibility, and reference file SHA-256. Container-only changes also invalidate a decision, even if the PCM remains identical. This is intentional: PCM deduplication and human review identity solve different problems.

An old audio version's score remains in history and is not silently transferred to a new file. Source hashes are checked before saving or generating/serving a preview; external edits require a rescan.

Keys are content-addressed: reimporting an exact previously reviewed version restores that version's own decision. An unseen version starts pending. Export also checks source hashes and refuses stale file references.

## Export and restore

The JSON export includes current item metadata, current decisions, audio hashes, and aggregate statistics. Explicit absolute path fields are omitted unless `--include-paths` is supplied. User-written notes, IDs, and labels are not redacted; inspect those before sharing an export. All historical versions remain in SQLite; a JSON export is not a replacement for a full workspace backup.

`restore` accepts an export with this schema. Every reviewed row must match a current key and file hash; validation and optimistic version checks protect the batch. Imported decisions receive a new local review revision and `imported_review` origin. Importing a review does not mean that you personally listened to it again.
