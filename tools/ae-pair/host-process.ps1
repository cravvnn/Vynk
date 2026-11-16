$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$rows = @(foreach ($aeProcess in @(Get-Process -Name 'AfterFX*' -ErrorAction SilentlyContinue)) {
  $executable = $null
  try { $executable = $aeProcess.Path } catch {}
  [pscustomobject]@{pid=$aeProcess.Id;executable=$executable;windowTitle=$aeProcess.MainWindowTitle}
})
ConvertTo-Json -InputObject $rows -Compress
