# Presses the default button (Continue) on After Effects' "Crash Repair Options"
# startup dialog without taking focus. Used by tools/ae-pair/run.mjs.
param([string]$ProcessName, [int]$ProcessId = 0, [string]$Executable)

Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class VynkDlg {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static IntPtr Find(uint want) {
    IntPtr f = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want || !IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "#32770") return true;
      var title = new StringBuilder(512); GetWindowText(h, title, title.Capacity);
      if (title.ToString().IndexOf("Crash Repair", StringComparison.OrdinalIgnoreCase) < 0) return true;
      f = h; return false;
    }, IntPtr.Zero);
    return f;
  }
}
"@

$p = $null
if ($ProcessId -gt 0) { $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue }
elseif ($ProcessName) {
  $processMatches = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
  if ($processMatches.Count -ne 1) { exit 0 }
  $p = $processMatches[0]
}
if (-not $p) { exit 0 }
if ($Executable) {
  try { if (-not $p.Path -or [IO.Path]::GetFullPath($p.Path) -ine [IO.Path]::GetFullPath($Executable)) { exit 1 } }
  catch { exit 1 }
}
$h = [VynkDlg]::Find([uint32]$p.Id)
if ($h -eq [IntPtr]::Zero) { exit 0 }
[void][VynkDlg]::PostMessage($h, 0x100, [IntPtr]0x0D, [IntPtr]0)
[void][VynkDlg]::PostMessage($h, 0x101, [IntPtr]0x0D, [IntPtr]0)
Write-Output "dismissed"
