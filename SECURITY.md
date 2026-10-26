# Security

This early release is intended for one user on their own computer. The HTTP server binds to `127.0.0.1`, checks the Host header, requires a same-origin request and per-process session token for writes, and serves only packaged files and active catalog audio. It is not designed to be reverse-proxied or exposed to a network.

Inputs stay read-only. The importer can read local paths entered by the user; it has no file-upload, delete, training, or source-edit endpoint. All import/batch/undo writes use the same origin/session checks as individual reviews. Only one import runs per server. Cancellation is accepted before the commit phase.

Manifests and decoder executable paths are local-user configuration; load manifests only from sources you trust. FFmpeg is an optional external decoder: keep your chosen installation updated when opening untrusted media. CSV text cells that resemble spreadsheet formulas are escaped.

Review exports omit explicit file paths by default, but labels, IDs, and notes may contain information supplied by you. A workspace database contains absolute local paths and full review history. Do not publish it.

For a security issue, use GitHub's private vulnerability reporting for this repository. Do not post exploit details or private recordings in public issues. If private reporting is unavailable, open an issue asking for a private contact channel without disclosing the vulnerability itself.
