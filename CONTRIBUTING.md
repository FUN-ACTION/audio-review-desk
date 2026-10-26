# Contributing

Start with an issue describing the audio workflow, expected behavior, and a minimal reproduction. Use generated or openly licensed examples; never attach private recordings, account data, or model weights.

## Development

Use Python 3.11+ in a dedicated virtual environment, then `python -m pip install -e .`. Run:

```sh
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

FFmpeg integration tests are conditional on FFmpeg and ffprobe being available. The app itself does not require Node.js. Frontend files are served directly as packaged resources; no JavaScript build step is required.

Frontend modules separate copy, motion, waveform drawing and media controls. See [design notes](docs/design.md) for the type and motion system. Bundled fonts are ready to use. To rebuild them, install `fonttools[woff]` in a separate build environment and run `python scripts/build_fonts.py`; source revisions and hashes are pinned in that script. The font build cache is ignored by Git.

## Invariants

- Source audio and models are never changed, moved, deleted, or trained by this tool.
- Reviews belong to an audio/reference/interval version. A changed version starts pending.
- Technical flags cannot manufacture human scores or approvals.
- Timeline totals union source intervals; they do not sum overlapping clips.
- Concurrent stale edits fail visibly. Review history is append-only.
- Imports switch the active catalog only after a complete scan. Cancellation must preserve the previous catalog.
- Batch changes commit together and retain notes/scores. Human approval remains a per-clip decision.
- The server remains loopback-only and does not expose arbitrary paths or upload endpoints.
- New tests use temporary workspaces and synthetic audio, not a developer's private paths.

Before a PR, explain what changed and which checks you ran. Add a regression case when fixing counting, persistence, decoder, or version-binding bugs. Update the relevant user documentation when changing a CLI or manifest field.

## Release files

After tests pass and changes are committed, build from the committed tree:

```sh
python scripts/build_release.py --output ../release/0.4.0
```

Use a new output directory for each release. The script archives the commit, builds its wheel in a clean temporary directory, and writes SHA256 checksums. This avoids packaging stale frontend files from a previous local build. Install that wheel in a separate environment before publishing, and check the CI result for the exact release commit.

Before changing the version, copy [the release template](releases/TEMPLATE.md) to `docs/releases/VERSION.md`. Fill in the changes, stop/backup/install/reopen steps, compatibility details and actual verification. The build script checks the required sections. Use this same document as the GitHub Release body; resolve its relative links to the matching tag when publishing.
