$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class VynkMainWindow {
  public delegate bool Callback(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder b, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder b, int n);
  public static string Title(uint want) {
    string title = "";
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want || !IsWindowVisible(h)) return true;
      var cls = new StringBuilder(256); GetClassName(h, cls, cls.Capacity);
      if (!cls.ToString().StartsWith("AE_CApplication_")) return true;
      var text = new StringBuilder(1024); GetWindowText(h, text, text.Capacity);
      title = text.ToString();
      return false;
    }, IntPtr.Zero);
    return title;
  }
}
'@
$rows = @(foreach ($aeProcess in @(Get-Process -Name 'AfterFX*' -ErrorAction SilentlyContinue)) {
  $executable = $null
  try { $executable = $aeProcess.Path } catch {}
  [pscustomobject]@{pid=$aeProcess.Id;executable=$executable;windowTitle=[VynkMainWindow]::Title([uint32]$aeProcess.Id)}
})
ConvertTo-Json -InputObject $rows -Compress
