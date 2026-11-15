# Brings one After Effects window to the foreground, as a user working in it
# would. Used by tools/ae-pair/run.mjs for things After Effects only does while
# it is the active app (the Layer Styles menu).
param([string]$ProcessName)

Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class VynkFocus {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
  public static IntPtr Find(uint want) {
    IntPtr best = IntPtr.Zero; long score = 0;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want || !IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, cls.Capacity);
      var title = new StringBuilder(512); GetWindowText(h, title, title.Capacity);
      bool aeClass = cls.ToString().Contains("AE_CApplication");
      if (!aeClass && !title.ToString().StartsWith("Adobe After Effects")) return true;
      Rect r; if (!GetWindowRect(h, out r)) return true;
      long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
      long candidate = area + (aeClass ? (1L << 44) : 0);
      if (area > 0 && candidate > score) { best = h; score = candidate; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
"@

$p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { Write-Output "no process"; exit 1 }
$aeWindow = [VynkFocus]::Find([uint32]$p.Id)
if ($aeWindow -eq [IntPtr]::Zero) { Write-Output "no AE window"; exit 1 }
if ([VynkFocus]::IsIconic($aeWindow)) { [void][VynkFocus]::ShowWindow($aeWindow, 9) }
# Windows only lets the foreground app hand focus over; a synthetic Alt press
# lifts that restriction for this call.
[uint32]$foregroundProcess = 0
for ($attempt = 0; $attempt -lt 3; $attempt++) {
  [VynkFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [void][VynkFocus]::SetForegroundWindow($aeWindow)
  [VynkFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 200
  [void][VynkFocus]::GetWindowThreadProcessId([VynkFocus]::GetForegroundWindow(), [ref]$foregroundProcess)
  if ($foregroundProcess -eq [uint32]$p.Id) { Write-Output "focused"; exit 0 }
}
Write-Output "not focused (expected $($p.Id), foreground $foregroundProcess)"
exit 1
