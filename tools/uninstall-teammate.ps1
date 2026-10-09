param(
  [switch]$RemoveDebugMode,
  [switch]$AegpOnly
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$problems = 0

function Step($text) { Write-Host ('==> ' + $text) -ForegroundColor Cyan }
function Ok($text) { Write-Host ('    ok: ' + $text) -ForegroundColor Green }
function Note($text) { Write-Host ('    ' + $text) -ForegroundColor DarkGray }
function Bad($text) { Write-Host ('    FAILED: ' + $text) -ForegroundColor Red; $script:problems++ }

# Removes the AEGP overlay folder from every After Effects Plug-ins dir.
# Requires admin (Program Files). Returns how many installs were cleaned.
function Remove-Aegp {
  $aeRoots = Get-ChildItem 'C:\Program Files\Adobe' -Directory -Filter 'Adobe After Effects*' -ErrorAction SilentlyContinue
  $count = 0
  foreach ($ae in $aeRoots) {
    $dir = Join-Path $ae.FullName 'Support Files\Plug-ins\Vynk'
    if (Test-Path -LiteralPath $dir) {
      Remove-Item -LiteralPath $dir -Recurse -Force
      $count++
    }
  }
  return $count
}

if ($AegpOnly) {
  try { $n = Remove-Aegp; Write-Host ("AEGP removed from $n After Effects install(s)."); exit 0 }
  catch { Write-Host ('AEGP removal failed: ' + $_.Exception.Message); exit 1 }
}

Write-Host ''
Write-Host 'Vynk - uninstall' -ForegroundColor White
Write-Host ''

$ae = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*AfterFX*' }
if ($ae) {
  Write-Host 'After Effects is running - close it first for a complete removal.' -ForegroundColor Yellow
  Write-Host 'Continuing anyway (panel files may stay locked until AE closes).'
  Write-Host ''
}

Step 'Removing the panel'
$panelDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.vynk.panel'
if (Test-Path -LiteralPath $panelDir) {
  try {
    Remove-Item -LiteralPath $panelDir -Recurse -Force
    Ok $panelDir
  } catch {
    Bad $_.Exception.Message
  }
} else {
  Note 'not installed'
}

Step 'Removing the native overlay (AEGP)'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  try { $n = Remove-Aegp; Ok ("removed from $n After Effects install(s)") }
  catch { Bad $_.Exception.Message }
} else {
  Write-Host '    (this step needs admin - accept the prompt)' -ForegroundColor DarkGray
  try {
    Start-Process powershell -Verb RunAs -Wait -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-AegpOnly'
    ) | Out-Null
    Ok 'overlay removed (elevated)'
  } catch {
    Bad ('overlay removal needs admin approval: ' + $_.Exception.Message)
  }
}

Step 'CEP debug mode registry keys'
if ($RemoveDebugMode) {
  foreach ($v in 9..12) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (Test-Path $key) {
      Remove-ItemProperty -Path $key -Name PlayerDebugMode -ErrorAction SilentlyContinue
    }
  }
  Ok 'PlayerDebugMode removed'
  Note 'note: this may affect OTHER unsigned CEP extensions you have installed'
} else {
  Note 'left in place (shared with other unsigned panels; use -RemoveDebugMode to clear)'
}

Write-Host ''
if ($problems -eq 0) {
  Write-Host 'Vynk removed. Restart After Effects to be fully clear.' -ForegroundColor Green
} else {
  Write-Host ('Finished with ' + $problems + ' problem(s) - usually caused by After Effects holding files.') -ForegroundColor Yellow
  Write-Host 'Close After Effects completely and run this again.'
}
Write-Host ''
