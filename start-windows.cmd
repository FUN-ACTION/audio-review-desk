@echo off
setlocal
pushd "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 goto failure
)
".venv\Scripts\python.exe" -c "from importlib.metadata import version; assert version('audio-review-desk')=='0.12.0'" >nul 2>&1
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m pip install .
  if errorlevel 1 goto failure
)
".venv\Scripts\python.exe" -c "import json,urllib.request; data=json.load(urllib.request.urlopen('http://127.0.0.1:8765/api/state',timeout=2)); assert data.get('version')=='0.12.0'" >nul 2>&1
if not errorlevel 1 (
  echo Audio Review Desk is already running. Opening its current workspace.
  ".venv\Scripts\python.exe" -c "import webbrowser; webbrowser.open('http://127.0.0.1:8765/')"
  popd
  exit /b 0
)
if not exist "review-workspace\reviews.sqlite" (
  ".venv\Scripts\python.exe" -m audio_review_desk init --workspace review-workspace
  if errorlevel 1 goto failure
)
echo Opening Audio Review Desk. Close this window or press Ctrl+C to stop.
".venv\Scripts\python.exe" -m audio_review_desk serve --workspace review-workspace --open
if errorlevel 1 goto failure
popd
exit /b 0
:failure
echo.
echo Could not start. See README.md or docs\installation.md for help.
pause
popd
exit /b 1
