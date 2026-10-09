param(
  [string]$Ae,
  [string]$Jsx,
  [string]$Sentinel,
  [int]$TimeoutSec = 300,
  [switch]$ShowUi,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $Jsx) { $Jsx = Join-Path $PSScriptRoot "verify.jsx" }
if (-not $Sentinel) { $Sentinel = Join-Path $env:TEMP "ae-verify-result.json" }
$tmp = "$Sentinel.tmp"

if (-not $Ae) {
  $hit = Get-ChildItem -Path "C:\Program Files\Adobe\Adobe After Effects*\Support Files\AfterFX*.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch "render" } | Select-Object -First 1
  if ($hit) { $Ae = $hit.FullName }
}

foreach ($p in @($Sentinel, $tmp)) { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force } }

Write-Output "AE:   $Ae"
Write-Output "JSX:  $Jsx"
Write-Output "OUT:  $Sentinel"
if (-not $Ae -or -not (Test-Path -LiteralPath $Ae)) { Write-Output "AE executable not found"; exit 2 }
if (-not (Test-Path -LiteralPath $Jsx)) { Write-Output "JSX not found"; exit 2 }

$running = @(Get-Process | Where-Object { $_.ProcessName -like "AfterFX*" })
if ($running.Count -gt 0 -and -not $Force) {
  Write-Output "After Effects is already running (pid(s): $($running.Id -join ',')) - refusing to inject a script/quit it."
  Write-Output "Close AE first, or pass -Force only if you accept it will quit that instance."
  exit 4
}

$pre = @(Get-Process | Where-Object { $_.ProcessName -like "AfterFX*" } | Select-Object -ExpandProperty Id)
$args = @()
if (-not $ShowUi) { $args += "-noui" }
$args += @("-r", $Jsx)

Write-Output "launching: $Ae $($args -join ' ')"
$proc = Start-Process -FilePath $Ae -ArgumentList $args -PassThru

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$done = $false
while ((Get-Date) -lt $deadline) {
  if (Test-Path -LiteralPath $Sentinel) { Start-Sleep -Milliseconds 750; $done = $true; break }
  Start-Sleep -Milliseconds 500
}

if ($done) {
  Write-Output "---RESULT---"
  Get-Content -LiteralPath $Sentinel -Raw
} else {
  Write-Output "TIMEOUT after $TimeoutSec s waiting for $Sentinel"
}

$ours = @(Get-Process | Where-Object { $_.ProcessName -like "AfterFX*" -and $pre -notcontains $_.Id })
if ($ours.Count -gt 0) {
  Write-Output "cleaning up AE pid(s): $($ours.Id -join ',')"
  $ours | Stop-Process -Force -ErrorAction SilentlyContinue
}

if (-not $done) { exit 3 }
