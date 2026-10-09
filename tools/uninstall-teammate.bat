@echo off
setlocal
title Vynk uninstaller

echo.
echo Vynk - uninstall
echo.

tasklist /fi "imagename eq AfterFX.exe" 2>nul | find /i "AfterFX.exe" >nul
if not errorlevel 1 (
  echo NOTE: After Effects is running. Close it for a complete removal.
  echo.
)

echo [1/2] Removing the panel...
set "PANEL=%APPDATA%\Adobe\CEP\extensions\com.vynk.panel"
if exist "%PANEL%" (
  rmdir /s /q "%PANEL%"
  if exist "%PANEL%" (echo      FAILED - close After Effects and run again) else (echo      ok)
) else (
  echo      not installed
)

echo [2/2] Removing the native cursor overlay (admin approval needed)...
if exist "%~dp0uninstall.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'powershell' -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0uninstall.ps1','-AegpOnly'"
  if errorlevel 1 (echo      FAILED: admin step was cancelled or blocked) else (echo      ok)
) else (
  echo      (uninstall.ps1 not found - remove the Vynk folder by hand from)
  echo      C:\Program Files\Adobe\Adobe After Effects*\Support Files\Plug-ins\
)

echo.
echo Done. Restart After Effects to be fully clear.
echo The CEP debug-mode registry key was left alone - it is shared with other
echo unsigned panels. Remove it manually only if you know you do not need it:
echo   reg delete "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /f
echo.
pause
