# Brings one After Effects window to the foreground, as a user working in it
# would. Used by tools/ae-pair/run.mjs for things After Effects only does while
# it is the active app (the Layer Styles menu).
param([string]$ProcessName)

Add-Type @"
using System; using System.Runtime.InteropServices;
public class VynkFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
}
"@

$p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p -or $p.MainWindowHandle -eq [IntPtr]::Zero) { Write-Output "no window"; exit 0 }
# Windows only lets the foreground app hand focus over; a synthetic Alt press
# lifts that restriction for this call.
[VynkFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[void][VynkFocus]::SetForegroundWindow($p.MainWindowHandle)
[VynkFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300
if ([VynkFocus]::GetForegroundWindow() -eq $p.MainWindowHandle) { Write-Output "focused" } else { Write-Output "not focused" }
