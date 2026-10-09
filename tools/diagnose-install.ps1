Write-Host ''
Write-Host 'Vynk - install diagnostics (read-only, no changes)' -ForegroundColor White
Write-Host ''

function Section($text) { Write-Host ('--- ' + $text) -ForegroundColor Cyan }

Section 'who / where'
Write-Host ('user:        ' + $env:USERNAME)
Write-Host ('computer:    ' + $env:COMPUTERNAME)
Write-Host ('APPDATA:     ' + $env:APPDATA)
Write-Host ('LOCALAPPDATA:' + $env:LOCALAPPDATA)

Section 'After Effects processes'
$ae = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*AfterFX*' }
if ($ae) {
  foreach ($p in $ae) { Write-Host ('  ' + $p.ProcessName + '  pid=' + $p.Id + '  ' + $p.Path) }
} else {
  Write-Host '  (none running)'
}

Section 'AE versions installed'
$adobe = 'C:\Program Files\Adobe'
if (Test-Path $adobe) {
  Get-ChildItem $adobe -Directory | Where-Object { $_.Name -like '*After Effects*' } | ForEach-Object {
    $exe = Join-Path $_.FullName 'Support Files\AfterFX.exe'
    $exe2 = Join-Path $_.FullName 'Support Files\AfterFX (Beta).exe'
    $found = (Test-Path $exe) -or (Test-Path $exe2)
    Write-Host ('  ' + $_.Name + '  exe=' + $found)
  }
} else {
  Write-Host '  (Adobe folder not found)'
}

Section 'Installed panel'
$panelDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.vynk.panel'
if (Test-Path -LiteralPath $panelDir) {
  Write-Host ('  path: ' + $panelDir)
  $mainJs = Join-Path $panelDir 'src\main.js'
  if (Test-Path -LiteralPath $mainJs) {
    $m = Select-String -Path $mainJs -Pattern "panel m\d+\.\d" | Select-Object -First 1
    if ($m) { Write-Host ('  build: ' + ($m.Line.Trim())) } else { Write-Host '  build: marker not found' }
  } else {
    Write-Host '  main.js MISSING - panel copy is incomplete'
  }
  $cfg = Join-Path $panelDir 'src\config.js'
  if (Test-Path -LiteralPath $cfg) { Write-Host ('  config: ' + ((Get-Content -LiteralPath $cfg) -join ' ')) }
  $jsx = Join-Path $panelDir 'jsx\hostscript.jsx'
  Write-Host ('  hostscript: ' + (Test-Path -LiteralPath $jsx))
} else {
  Write-Host '  NOT INSTALLED (panel folder missing)'
}

Section 'CEP debug mode (needs 1)'
foreach ($v in 9..12) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (Test-Path $key) {
    $val = (Get-ItemProperty -Path $key -Name PlayerDebugMode -ErrorAction SilentlyContinue).PlayerDebugMode
    Write-Host ("  CSXS.$v PlayerDebugMode = " + $val)
  } else {
    Write-Host ("  CSXS.$v key missing")
  }
}

Section 'Native overlay (AEGP)'
$adobeRoot = 'C:\Program Files\Adobe'
if (Test-Path $adobeRoot) {
  Get-ChildItem $adobeRoot -Directory | Where-Object { $_.Name -like '*After Effects*' } | ForEach-Object {
    $aex = Join-Path $_.FullName 'Support Files\Plug-ins\Vynk\vynk.aex'
    Write-Host ('  ' + $_.Name + '  overlay=' + (Test-Path -LiteralPath $aex))
  }
}
$portFile = Join-Path $env:LOCALAPPDATA 'Vynk\bridge.port'
if (Test-Path -LiteralPath $portFile) {
  $bp = (Get-Content -LiteralPath $portFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($bp) { $bp = $bp.Trim() }
  Write-Host ('  bridge.port file: ' + $bp)
  if ($bp -match '^\d+$') {
    $listen = Get-NetTCPConnection -LocalPort ([int]$bp) -State Listen -ErrorAction SilentlyContinue
    if ($listen) { Write-Host ('  bridge listening on ' + $bp + ' (AEGP loaded, AE running)') }
    else { Write-Host '  bridge.port present but nothing listening (AE closed?)' }
  }
} else {
  Write-Host '  no bridge.port (AE not running or AEGP not loaded)'
}

Section 'Execution policy'
Write-Host ('  ' + (Get-ExecutionPolicy -List | Out-String).Trim())

Section 'Blocked (downloaded) files in this folder'
$thisDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$blocked = Get-ChildItem -LiteralPath $thisDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
  Get-Item -LiteralPath $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue
}
if ($blocked) {
  $blocked | ForEach-Object { Write-Host ('  BLOCKED: ' + $_.FullName) }
  Write-Host '  -> run: Get-ChildItem -Recurse -File | Unblock-File'
} else {
  Write-Host '  none'
}

Section 'Configured relay (optional)'
$cfg = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.vynk.panel\src\config.js'
$server = $null
if (Test-Path -LiteralPath $cfg) {
  $m = Select-String -Path $cfg -Pattern "VYNK_DEFAULT_SERVER\s*=\s*'([^']*)'" | Select-Object -First 1
  if ($m) { $server = $m.Matches[0].Groups[1].Value }
}
if ([string]::IsNullOrWhiteSpace($server)) {
  Write-Host '  no relay configured - enter your team''s relay url in the panel'
} else {
  Write-Host ('  panel default server: ' + $server)
  $health = $server -replace '^ws', 'http' -replace '/ws$', '/health'
  try {
    $r = Invoke-RestMethod $health -TimeoutSec 8
    Write-Host ('  health ok: ' + ($r | ConvertTo-Json -Compress))
  } catch {
    Write-Host ('  NOT reachable: ' + $_.Exception.Message)
  }
}

Write-Host ''
Write-Host 'Send this whole window to Andrew.' -ForegroundColor Yellow
Write-Host ''
