"""Command-line interface. All analysis and review state stays in a workspace."""
from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from pathlib import Path

from . import __version__
from .audio import Decoder
from .workspace import Workspace, encode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="audio-review-desk", description="Local audio QC and version-bound listening review")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (("scan", "Analyze a directory without modifying its audio"),
                            ("import", "Import a JSON or CSV audio manifest"),
                            ("serve", "Open a local listening review workspace"),
                            ("export", "Export current reviews to portable JSON"),
                            ("restore", "Import reviews for matching current audio versions"),
                            ("demo", "Create synthetic demo audio and a fresh workspace")):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--workspace", type=Path, required=True)
        if name in {"scan", "import", "restore"}:
            command.add_argument("input", type=Path)
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
    args = parser.parse_args(argv)
    try:
        if hasattr(args, "timeout") and (not 0 < args.timeout <= 86400):
            raise ValueError("timeout must be between 0 and 86400 seconds")
        decoder = Decoder(getattr(args, "ffmpeg", None), getattr(args, "ffprobe", None), getattr(args, "timeout", 120))
        workspace = Workspace(args.workspace, decoder)
        if args.command == "demo":
            from .demo import create_demo
            result = create_demo(args.workspace)
            print(encode(result["stats"]))
        elif args.command == "scan":
            print(encode(workspace.scan(args.input)["stats"]))
        elif args.command == "import":
            print(encode(workspace.import_manifest(args.input)["stats"]))
        else:
            if not workspace.db.is_file():
                raise ValueError("Workspace not found; run demo, scan, or import first")
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
                # Exclusive creation also prevents accidental overwrites of source audio or manifests.
                args.output.parent.mkdir(parents=True, exist_ok=True)
                with args.output.open("x", encoding="utf-8") as stream:
                    stream.write(json.dumps(workspace.export(args.include_paths), ensure_ascii=False, indent=2, allow_nan=False))
                print(f"Exported reviews to {args.output}")
            elif args.command == "restore":
                count = workspace.import_reviews(json.loads(args.input.read_text(encoding="utf-8-sig")))
                print(f"Restored {count} matching version-bound reviews")
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
