param(
  [string]$Server = 'wss://multiplayerae.allevilmc.com/ws',
  [switch]$Force,
  [switch]$AegpOnly
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$failures = 0

$verSrc = Join-Path $here 'panel\src\version.js'
$pkgVersion = 'unknown'
if (Test-Path -LiteralPath $verSrc) {
  $vm = Select-String -Path $verSrc -Pattern "VYNK_VERSION\s*=\s*'([^']+)'" | Select-Object -First 1
  if ($vm) { $pkgVersion = $vm.Matches[0].Groups[1].Value }
}

function Step($text) { Write-Host ('==> ' + $text) -ForegroundColor Cyan }
function Ok($text) { Write-Host ('    ok: ' + $text) -ForegroundColor Green }
function Bad($text) { Write-Host ('    FAILED: ' + $text) -ForegroundColor Red; $script:failures++ }

# Copies vynk.aex into every After Effects Plug-ins folder. Requires
# admin (these live under Program Files). Returns how many installs were updated.
function Install-Aegp {
  $src = Join-Path $here 'vynk.aex'
  if (-not (Test-Path -LiteralPath $src)) { throw 'vynk.aex is missing from this package' }
  $aeRoots = Get-ChildItem 'C:\Program Files\Adobe' -Directory -Filter 'Adobe After Effects*' -ErrorAction SilentlyContinue
  if (-not $aeRoots) { throw 'no Adobe After Effects install found' }
  $count = 0
  foreach ($ae in $aeRoots) {
    $plugins = Join-Path $ae.FullName 'Support Files\Plug-ins'
    if (-not (Test-Path -LiteralPath $plugins)) { continue }
    $destDir = Join-Path $plugins 'Vynk'
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Copy-Item -LiteralPath $src -Destination (Join-Path $destDir 'vynk.aex') -Force
    $count++
  }
  return $count
}

# Elevated child invocation: only install the AEGP, then exit.
if ($AegpOnly) {
  try {
    $n = Install-Aegp
    Write-Host ("AEGP installed into $n After Effects install(s).")
    exit 0
  } catch {
    Write-Host ('AEGP install failed: ' + $_.Exception.Message)
    exit 1
  }
}

Write-Host ''
Write-Host 'Vynk - installer' -ForegroundColor White
Write-Host ('source: ' + $here)
Write-Host ('user:   ' + $env:USERNAME)
Write-Host ''

Step 'Unblocking downloaded files'
try {
  Get-ChildItem -LiteralPath $here -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  Ok 'unblocked'
} catch {
  Ok 'nothing to unblock'
}

Step 'Checking After Effects is closed'
$ae = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*AfterFX*' }
if ($ae -and -not $Force) {
  Bad ('After Effects is running (' + (($ae | ForEach-Object { $_.ProcessName }) -join ', ') + '). Close it fully and run this again.')
  Write-Host ''
  Write-Host 'Stopped. Close After Effects and re-run install.bat / install.ps1.' -ForegroundColor Yellow
  exit 1
}
Ok 'no After Effects process found'

Step 'Installing the panel'
$extRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$panelDir = Join-Path $extRoot 'com.vynk.panel'
try {
  New-Item -ItemType Directory -Force -Path $extRoot | Out-Null
  if (Test-Path -LiteralPath $panelDir) {
    Remove-Item -LiteralPath $panelDir -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $panelDir | Out-Null
  Copy-Item -Path (Join-Path $here 'panel\*') -Destination $panelDir -Recurse -Force
  Ok $panelDir
} catch {
  Bad ('could not copy panel: ' + $_.Exception.Message)
}

Step 'Writing panel settings'
try {
  $configPath = Join-Path $panelDir 'src\config.js'
  Set-Content -LiteralPath $configPath -Value ("window.VYNK_DEFAULT_SERVER = '" + $Server + "';`r`nwindow.VYNK_TEXT_SYNC = false;") -Encoding UTF8
  Ok ('server = ' + $Server + ', text sync off')
} catch {
  Bad ('could not write config: ' + $_.Exception.Message)
}

Step 'Enabling CEP debug mode (current user only)'
try {
  foreach ($v in 9..12) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
  }
  Ok 'CSXS 9-12 PlayerDebugMode = 1'
} catch {
  Bad ('registry write failed: ' + $_.Exception.Message)
}

Step 'Installing the native cursor overlay (AEGP)'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  try { $n = Install-Aegp; Ok ("installed into $n After Effects install(s)") }
  catch { Bad $_.Exception.Message }
} else {
  Write-Host '    (this step needs admin - accept the prompt)' -ForegroundColor DarkGray
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-AegpOnly'
    ) | Out-Null
    Ok 'AEGP installed (elevated)'
  } catch {
    Bad ('AEGP install needs admin approval: ' + $_.Exception.Message)
  }
}

Step 'Verifying the install'
$mainJs = Join-Path $panelDir 'src\main.js'
$verJs = Join-Path $panelDir 'src\version.js'
if ((Test-Path -LiteralPath $mainJs) -and (Test-Path -LiteralPath $verJs)) {
  $vm = Select-String -Path $verJs -Pattern "VYNK_VERSION\s*=\s*'([^']+)'" | Select-Object -First 1
  if ($vm) { Ok ('panel build: v' + $vm.Matches[0].Groups[1].Value) } else { Bad 'panel version marker missing' }
} else {
  Bad 'panel files missing after copy'
}
$mp = 'HKCU:\Software\Adobe\CSXS.11'
if (Test-Path $mp) {
  $val = (Get-ItemProperty -Path $mp -Name PlayerDebugMode -ErrorAction SilentlyContinue).PlayerDebugMode
  if ($val -eq '1') { Ok 'PlayerDebugMode readable' } else { Bad 'PlayerDebugMode not set' }
}

Write-Host ''
if ($failures -eq 0) {
  Write-Host 'Install complete.' -ForegroundColor Green
  Write-Host '  1. Start After Effects (if it was open, restart it fully).'
  Write-Host '  2. Window > Extensions > Vynk.'
  Write-Host '  3. Enter your name + the room code, click join.'
  Write-Host ('  4. The panel log should start with: panel v' + $pkgVersion + ' starting ... text=off')
} else {
  Write-Host ("Install finished with $failures problem(s) - send this window to Andrew.") -ForegroundColor Red
}
Write-Host ''
Write-Host 'Need to check things later? Run diagnose.ps1 in this folder.' -ForegroundColor DarkGray
