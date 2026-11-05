"""Deterministic coverage for back-to-back background imports."""
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from audio_review_desk.jobs import ImportJobs
from audio_review_desk.workspace import ImportCancelled, Workspace


class ImportJobTests(unittest.TestCase):
    def test_previous_completion_cannot_disable_next_import_cancellation(self):
        for outcome in ("succeeded", "cancelled", "failed"):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                audio = root / "audio"
                audio.mkdir()
                workspace = Workspace(root / "workspace")
                jobs = ImportJobs(workspace)
                finish_first = threading.Event()
                terminal_published = threading.Event()
                release_cleanup = threading.Event()
                second_entered = threading.Event()
                finish_second = threading.Event()
                first_worker = None
                second_worker = None

                class CompletionBarrier:
                    """Yield exactly when a terminal job first becomes observable."""
                    def __init__(self):
                        self.lock = threading.RLock()

                    def __enter__(self):
                        self.lock.acquire()
                        return self

                    def __exit__(self, *exc):
                        pause = (threading.current_thread() is first_worker
                                 and jobs.current["state"] == outcome
                                 and not terminal_published.is_set())
                        self.lock.release()
                        if pause:
                            terminal_published.set()
                            release_cleanup.wait(5)

                jobs.lock = CompletionBarrier()

                def scan(_path, *, append, progress, cancelled):
                    if threading.current_thread() is first_worker:
                        finish_first.wait(5)
                        if outcome == "cancelled":
                            raise ImportCancelled("Cancelled first import")
                        if outcome == "failed":
                            raise ValueError("Failed first import")
                        return {"stats": {"files": 0}}
                    second_entered.set()
                    finish_second.wait(5)
                    if cancelled.is_set():
                        raise ImportCancelled("Cancelled second import")
                    return {"stats": {"files": 0}}

                # Keep the first worker outside scan until its identity is known.
                enter_first = threading.Event()
                calls = 0

                def controlled_scan(*args, **kwargs):
                    nonlocal calls
                    calls += 1
                    if calls == 1:
                        enter_first.wait(5)
                    return scan(*args, **kwargs)

                with patch.object(workspace, "scan", side_effect=controlled_scan):
                    try:
                        jobs.start("directory", str(audio))
                        first_worker = jobs.thread
                        enter_first.set()
                        finish_first.set()
                        self.assertTrue(terminal_published.wait(5), "First job did not finish")
                        self.assertEqual(jobs.snapshot()["state"], outcome)

                        second = jobs.start("directory", str(audio))
                        second_worker = jobs.thread
                        self.assertTrue(second_entered.wait(5), "Second job did not start")
                        release_cleanup.set()
                        first_worker.join(5)
                        self.assertFalse(first_worker.is_alive())

                        # The completed worker must not change this job's state.
                        self.assertEqual(jobs.snapshot()["id"], second["id"])
                        self.assertEqual(jobs.snapshot()["state"], "running")
                        self.assertEqual(jobs.cancel(second["id"])["state"], "cancelling")
                        finish_second.set()
                        second_worker.join(5)
                        self.assertFalse(second_worker.is_alive())
                        self.assertEqual(jobs.snapshot()["state"], "cancelled")
                    finally:
                        enter_first.set()
                        finish_first.set()
                        release_cleanup.set()
                        finish_second.set()
                        for worker in (first_worker, second_worker):
                            if worker:
                                worker.join(5)


if __name__ == "__main__":
    unittest.main()
