$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$panel = Join-Path $root 'panel'
$extRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$link = Join-Path $extRoot 'com.vynk.panel'

if (-not (Test-Path -LiteralPath $panel)) {
  Write-Error "Panel folder not found: $panel"
  exit 1
}

New-Item -ItemType Directory -Force -Path $extRoot | Out-Null

if (Test-Path -LiteralPath $link) {
  $item = Get-Item -LiteralPath $link -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    Remove-Item -LiteralPath $link -Force
  } else {
    Write-Error "Existing non-link path at $link - remove it manually"
    exit 1
  }
}

# Use a directory junction: symlinks need admin/Developer Mode, junctions do
# not for local paths. CEP follows junctions fine, so edits land without a copy.
New-Item -ItemType Junction -Path $link -Target $panel | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $link 'src\main.js'))) {
  Write-Error "Junction created but panel files not visible at $link"
  exit 1
}
Write-Output "Linked panel (junction): $link -> $panel"

foreach ($v in 9..12) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
}
Write-Output "PlayerDebugMode enabled for CSXS 9-12"

Write-Output ""
Write-Output "Restart After Effects, then open Window > Extensions > Vynk"
Write-Output "Run the relay with: npm run build; npm start"
