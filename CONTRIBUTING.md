# Contributing

Start with an issue describing the audio workflow, expected behavior, and a minimal reproduction. Use generated or openly licensed examples; never attach private recordings, account data, or model weights.

## Development

Use Python 3.11+ in a dedicated virtual environment, then `python -m pip install -e .`. Run:

```sh
python -m unittest discover -s tests -v
node --test tests-js/*.test.mjs
```

FFmpeg integration tests are conditional on FFmpeg and ffprobe being available. The app itself does not require Node.js. Frontend files are served directly as packaged resources; no JavaScript build step is required.

## Invariants

- Source audio and models are never changed, moved, deleted, or trained by this tool.
- Reviews belong to an audio/reference/interval version. A changed version starts pending.
- Technical flags cannot manufacture human scores or approvals.
- Timeline totals union source intervals; they do not sum overlapping clips.
- Concurrent stale edits fail visibly. Review history is append-only.
- The server remains loopback-only and does not expose arbitrary paths or upload endpoints.
- New tests use temporary workspaces and synthetic audio, not a developer's private paths.

Before a PR, explain what changed and which checks you ran. Add a regression case when fixing counting, persistence, decoder, or version-binding bugs. Update the relevant user documentation when changing a CLI or manifest field.
