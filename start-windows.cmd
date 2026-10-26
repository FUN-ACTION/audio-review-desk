@echo off
setlocal
pushd "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 goto failure
)
".venv\Scripts\python.exe" -c "import audio_review_desk" >nul 2>&1
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m pip install .
  if errorlevel 1 goto failure
)
if not exist ".ard-demo\reviews.sqlite" (
  ".venv\Scripts\python.exe" -m audio_review_desk demo --workspace .ard-demo
  if errorlevel 1 goto failure
)
echo Opening the synthetic demo. Close this window or press Ctrl+C to stop.
".venv\Scripts\python.exe" -m audio_review_desk serve --workspace .ard-demo --open
if errorlevel 1 goto failure
popd
exit /b 0
:failure
echo.
echo Could not start. See README.md or docs\installation.md for help.
pause
popd
exit /b 1
