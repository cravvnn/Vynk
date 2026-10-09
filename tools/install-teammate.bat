@echo off
setlocal enabledelayedexpansion
title Vynk installer

echo.
echo Vynk - installer
echo.

tasklist /fi "imagename eq AfterFX.exe" 2>nul | find /i "AfterFX.exe" >nul
if not errorlevel 1 (
  echo ERROR: After Effects is running. Close it completely and run this again.
  echo.
  pause
  exit /b 1
)
tasklist /fi "imagename eq AfterFX (Beta).exe" 2>nul | find /i "AfterFX" >nul
if not errorlevel 1 (
  echo ERROR: After Effects is running. Close it completely and run this again.
  echo.
  pause
  exit /b 1
)

set "EXTS=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%EXTS%\com.vynk.panel"

set "VYNBUILD=?"
for /f "tokens=2 delims='" %%v in ('findstr /r /c:"VYNK_VERSION" "%~dp0panel\src\version.js" 2^>nul') do set "VYNBUILD=%%v"

echo [1/3] Installing the panel...
if not exist "%EXTS%" mkdir "%EXTS%"
if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy /e /i /y "%~dp0panel" "%DEST%" >nul
if not exist "%DEST%\index.html" (
  echo      FAILED: could not copy the panel folder.
  echo      Make sure this .bat is next to the "panel" folder ^(keep them together^).
  echo.
  pause
  exit /b 1
)
echo      ok: %DEST%

echo [2/3] Enabling CEP debug mode (current user only)...
reg import "%~dp0enable-cep-debug-mode.reg" >nul 2>&1
if errorlevel 1 (
  echo      FAILED: registry import was blocked.
  echo      Ask Andrew for the registry lines to enable manually.
) else (
  echo      ok
)

echo [3/3] Installing the native cursor overlay (admin approval needed)...
if not exist "%~dp0vynk.aex" (
  echo      FAILED: vynk.aex is missing from this folder.
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'powershell' -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0install.ps1','-AegpOnly'"
  if errorlevel 1 (
    echo      FAILED: admin step was cancelled or blocked.
  ) else (
    echo      ok: overlay installed
  )
)

echo.
echo Install finished.
echo   1. Start After Effects ^(if it was open, restart it fully^).
echo   2. Window ^> Extensions ^> Vynk.
echo   3. Enter your team's relay url, your name + the room code, then join.
echo   4. The panel log should start with: panel v%VYNBUILD% starting ... text=off
echo.
echo If the panel does not appear: send Andrew a screenshot of this window.
echo.
pause
