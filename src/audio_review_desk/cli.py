"""Command-line interface. All analysis and review state stays in a workspace."""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import webbrowser
from pathlib import Path

from . import __version__
from .audio import Decoder
from .json_input import loads_unique
from .workspace import Workspace, encode


def _publish_export(temporary: str, output: Path) -> None:
    """Publish a closed file without ever replacing an existing destination."""
    if os.name == "nt":
        # Unlike POSIX rename, Windows rename refuses an existing destination.
        os.rename(temporary, output)
    else:
        try:
            os.link(temporary, output)
        except FileExistsError:
            raise
        except OSError as exc:
            raise OSError(
                f"Could not confirm safe export publication to {output}: {exc}. "
                "Use a writable filesystem that supports hard links."
            ) from exc


def _write_export(output: Path, data: bytes) -> None:
    """Keep failed writes off the final path; cleanup cannot undo publication."""
    output.parent.mkdir(parents=True, exist_ok=True)
    stream = tempfile.NamedTemporaryFile(
        mode="wb", prefix=".audio-review-export-", suffix=".tmp",
        dir=output.parent, delete=False,
    )
    try:
        with stream:
            if stream.write(data) != len(data):
                raise OSError("Incomplete export write")
            stream.flush()
            os.fsync(stream.fileno())
        _publish_export(stream.name, output)
    finally:
        try:
            os.unlink(stream.name)
        except FileNotFoundError:
            pass  # Windows rename already consumed the temporary name.
        except OSError as exc:
            # Never remove output or turn a published export into a failure.
            # Also preserve the original write/publication error on failure.
            try:
                print(f"Warning: could not remove temporary export {stream.name}: {exc}", file=sys.stderr)
            except OSError:
                pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="audio-review-desk", description="Local audio QC and version-bound listening review")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("scan", "Analyze a directory without modifying its audio"),
                            ("init", "Create an empty review workspace"),
                            ("import", "Import a JSON or CSV audio manifest"),
                            ("serve", "Open a local listening review workspace"),
                            ("export", "Export current reviews to JSON or CSV"),
                            ("restore", "Import reviews for matching current audio versions"),
                            ("demo", "Create synthetic demo audio and a fresh workspace")):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--workspace", type=Path, required=True)
        if name in {"scan", "import", "restore"}:
            command.add_argument("input", type=Path)
        if name in {"scan", "import"}:
            command.add_argument("--append", action="store_true", help="Keep other collections in this workspace")
        if name in {"scan", "import", "serve"}:
            command.add_argument("--ffmpeg", help="FFmpeg executable (default: find on PATH)")
            command.add_argument("--ffprobe", help="ffprobe executable (default: find on PATH)")
            command.add_argument("--timeout", type=float, default=120, help="Per-file FFmpeg decode timeout in seconds")
        if name == "serve":
            command.add_argument("--port", type=int, default=8765)
            command.add_argument("--open", action="store_true", help="Open your default browser")
        if name == "export":
            command.add_argument("--output", type=Path, required=True)
            command.add_argument("--include-paths", action="store_true", help="Include private absolute input paths")
            command.add_argument("--format", choices=["json", "csv"], default="json")
            command.add_argument("--status", choices=["all", "pending", "pass", "fix", "exclude"], default="all")
    args = parser.parse_args(argv)
    try:
        if hasattr(args, "timeout") and (not 0 < args.timeout <= 86400):
            raise ValueError("timeout must be between 0 and 86400 seconds")
        decoder = Decoder(getattr(args, "ffmpeg", None), getattr(args, "ffprobe", None), getattr(args, "timeout", 120))
        workspace = Workspace(args.workspace, decoder)
        if args.command == "init":
            workspace.initialize()
            print(f"Workspace ready: {workspace.root}")
        elif args.command == "demo":
            from .demo import create_demo
            result = create_demo(args.workspace)
            print(encode(result["stats"]))
        elif args.command == "scan":
            print(encode(workspace.scan(args.input, append=args.append)["stats"]))
        elif args.command == "import":
            print(encode(workspace.import_manifest(args.input, append=args.append)["stats"]))
        else:
            if not workspace.db.is_file():
                raise ValueError("Workspace not found; run init, scan, import, or demo first")
            if args.command == "serve":
                from .server import make_server
                server = make_server(workspace, args.port)
                url = f"http://127.0.0.1:{server.server_port}/"
                print(f"Audio Review Desk {__version__}: {url}", flush=True)
                if args.open:
                    webbrowser.open(url)
                try:
                    server.serve_forever()
                except KeyboardInterrupt:
                    print("\nReview server stopped. Saved reviews remain in the workspace.")
                finally:
                    server.server_close()
            elif args.command == "export":
                # Validate and serialize before creating the output. A failed
                # export must not leave an empty file that blocks a fixed retry.
                if args.format == "csv":
                    content = "\ufeff" + workspace.export_csv(args.status, args.include_paths)
                else:
                    result = workspace.export(args.include_paths)
                    if args.status != "all":
                        from .workspace import statistics
                        result["items"] = [row for row in result["items"] if row["review"]["status"] == args.status]
                        result["stats"] = statistics(result["items"])
                    content = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
                data = content.encode("utf-8")
                # Binary output also preserves CSV CRLF without OS translation.
                _write_export(args.output, data)
                print(f"Exported reviews to {args.output}")
            elif args.command == "restore":
                count = workspace.import_reviews(loads_unique(args.input.read_text(encoding="utf-8-sig"),
                                                             context="Review restore JSON"))
                print(f"Restored {count} matching version-bound reviews")
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
