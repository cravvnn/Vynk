param(
  [string]$Log = "$env:TEMP\opencode\aegp-install.log"
)

# Installs the built AEGP companion into every After Effects Plug-ins folder.
# Needs admin (Program Files). Copies into a "Vynk" subfolder so it is
# easy to remove later.

$ErrorActionPreference = 'Stop'

function Say($msg) {
  Write-Host $msg
  try { Add-Content -LiteralPath $Log -Value $msg } catch {}
}

try { if (Test-Path $Log) { Remove-Item $Log -Force } } catch {}

$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo 'aegp\build\Release\vynk.aex'

Say ("Vynk - AEGP install  " + (Get-Date))
Say ("source: " + $src)

if (-not (Test-Path -LiteralPath $src)) {
  Say "FAILED: built plugin not found. Build first (cmake --build aegp/build --config Release)."
  exit 1
}

$aeRoots = Get-ChildItem 'C:\Program Files\Adobe' -Directory -Filter 'Adobe After Effects*' -ErrorAction SilentlyContinue
if (-not $aeRoots) { Say "FAILED: no Adobe After Effects installs found."; exit 1 }

$count = 0
foreach ($ae in $aeRoots) {
  $plugins = Join-Path $ae.FullName 'Support Files\Plug-ins'
  if (-not (Test-Path -LiteralPath $plugins)) { continue }
  # Remove the pre-rebrand folder if present.
  $legacy = Join-Path $plugins 'MultiplayerAE'
  if (Test-Path -LiteralPath $legacy) {
    try { Remove-Item -LiteralPath $legacy -Recurse -Force; Say ("removed legacy: " + $legacy) } catch {}
  }
  $destDir = Join-Path $plugins 'Vynk'
  try {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Copy-Item -LiteralPath $src -Destination (Join-Path $destDir 'vynk.aex') -Force
    Say ("ok -> " + (Join-Path $destDir 'vynk.aex'))
    $count++
  } catch {
    Say ("FAILED for " + $ae.Name + ": " + $_.Exception.Message)
  }
}

if ($count -eq 0) {
  Say "FAILED: nothing installed."
  exit 1
}

Say ("done. installed into $count After Effects install(s). Restart AE, then watch OutputDebugString for [vynk].")
exit 0
