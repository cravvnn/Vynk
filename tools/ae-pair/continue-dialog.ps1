# Presses the default button (Continue) on After Effects' "Crash Repair Options"
# startup dialog without taking focus. Used by tools/ae-pair/run.mjs.
param([string]$ProcessName)

Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class VynkDlg {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static IntPtr Find(uint want) {
    IntPtr f = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want || !IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "#32770") return true;
      f = h; return false;
    }, IntPtr.Zero);
    return f;
  }
}
"@

$p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { exit 0 }
$h = [VynkDlg]::Find([uint32]$p.Id)
if ($h -eq [IntPtr]::Zero) { exit 0 }
[void][VynkDlg]::PostMessage($h, 0x100, [IntPtr]0x0D, [IntPtr]0)
[void][VynkDlg]::PostMessage($h, 0x101, [IntPtr]0x0D, [IntPtr]0)
Write-Output "dismissed"
