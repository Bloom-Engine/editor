# ui-smoke.ps1 - drive the REAL editor binary with injected input and assert
# it survives and saves correctly. Run after every build, and after every
# Perry upgrade.
#
# Why this exists: `main --test` exercises logic, not input paths. Two shipped
# bugs proved the difference (2026-07-16/17): the catalog-key bug rendered the
# whole world as placeholder boxes with 152 tests green, and Perry 0.5.1208
# miscompiled the ray unprojection into a crash on the FIRST viewport click -
# invisible to every test that never clicks. This script clicks.
#
# What it does:
#   1. copies the arena_01 fixture to %TEMP% (never touches repo data),
#   2. launches main.exe --project ../shooter/editor.project.json --world <copy>,
#   3. injects: asset-cell click -> 5 placement clicks -> camera drag ->
#      select + move-gizmo drag -> Ctrl+S,
#   4. asserts: process alive, no FATAL on stderr, saved file parses, entity
#      count grew by the 5 placements, and the safe-save siblings (.bak/.tmp)
#      exist.
# Exit code 0 = pass.

param(
  [string]$EditorExe = (Join-Path $PSScriptRoot "..\main.exe"),
  [string]$Project = (Join-Path $PSScriptRoot "..\..\shooter\editor.project.json"),
  [string]$Fixture = (Join-Path $PSScriptRoot "..\src\tests\fixtures\arena_01.world.json")
)

$ErrorActionPreference = "Stop"

function Fail($msg) { Write-Host "UI-SMOKE FAIL: $msg"; exit 1 }

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class UiSmoke {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out SRECT r);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)]
  public struct SRECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
[UiSmoke]::SetProcessDPIAware() | Out-Null

if (-not (Test-Path $EditorExe)) { Fail "editor exe not found: $EditorExe" }
if (-not (Test-Path $Project)) { Fail "project not found: $Project" }
if (-not (Test-Path $Fixture)) { Fail "fixture not found: $Fixture" }

# 1. Scratch world copy.
$scratch = Join-Path $env:TEMP "ui-smoke.world.json"
Remove-Item "$scratch*" -Force -ErrorAction SilentlyContinue
Copy-Item $Fixture $scratch -Force
$beforeCount = (Get-Content $scratch -Raw | ConvertFrom-Json).entities.Count

# 2. Launch.
$errLog = Join-Path $env:TEMP "ui-smoke-stderr.txt"
$proc = Start-Process -FilePath $EditorExe -ArgumentList "--project", $Project, "--world", $scratch `
  -RedirectStandardError $errLog -PassThru -WorkingDirectory (Split-Path $EditorExe)
Start-Sleep -Seconds 10
if ($proc.HasExited) { Fail "editor exited during startup (code $($proc.ExitCode)); stderr: $(Get-Content $errLog -Raw)" }

$h = $proc.MainWindowHandle
if ($h -eq 0) { Stop-Process -Id $proc.Id -Force; Fail "no main window after 10s" }
[UiSmoke]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 600
$r = New-Object UiSmoke+SRECT
[UiSmoke]::GetWindowRect($h, [ref]$r) | Out-Null
$dpi = [UiSmoke]::GetDpiForWindow($h)
if ($dpi -eq 0) { $dpi = 96 }
$s = $dpi / 96.0

function Pt($lx, $ly) { @([int]($r.Left + $lx * $s), [int]($r.Top + $ly * $s)) }
function LClick($lx, $ly) {
  $p = Pt $lx $ly
  [UiSmoke]::SetCursorPos($p[0], $p[1]) | Out-Null; Start-Sleep -Milliseconds 120
  [UiSmoke]::mouse_event(0x02,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 50
  [UiSmoke]::mouse_event(0x04,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 150
}
function Drag($btnDown, $btnUp, $x1, $y1, $x2, $y2) {
  $p = Pt $x1 $y1
  [UiSmoke]::SetCursorPos($p[0], $p[1]) | Out-Null; Start-Sleep -Milliseconds 100
  [UiSmoke]::mouse_event($btnDown,0,0,0,[UIntPtr]::Zero)
  for ($i = 1; $i -le 8; $i++) {
    $q = Pt ($x1 + ($x2-$x1)*$i/8) ($y1 + ($y2-$y1)*$i/8)
    [UiSmoke]::SetCursorPos($q[0], $q[1]) | Out-Null; Start-Sleep -Milliseconds 25
  }
  [UiSmoke]::mouse_event($btnUp,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 150
}
function Key($vk) {
  [UiSmoke]::keybd_event($vk,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40
  [UiSmoke]::keybd_event($vk,0,2,[UIntPtr]::Zero); Start-Sleep -Milliseconds 120
}
function Alive() {
  $p2 = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  return ($p2 -and -not $p2.HasExited)
}

# 3. Interact. Logical coordinates for the fixed 1280x800 window:
#    first asset cell ~ (1043, 199); viewport spans x 240..~1004, y 36..~770.
LClick 1043 199                       # pick first model -> place tool
$spots = @(@(620,460),@(420,260),@(820,600),@(520,650),@(720,350))
foreach ($sp in $spots) {
  LClick $sp[0] $sp[1]
  if (-not (Alive)) { Fail "editor died during placement at $($sp[0]),$($sp[1]); stderr: $(Get-Content $errLog -Raw | Select-Object -Last 4)" }
}
Drag 0x08 0x10 620 420 760 450        # right-drag: orbit the camera
Key 0x51                              # Q -> select tool
LClick 620 460                        # select something
Key 0x47                              # G -> move gizmo
Drag 0x02 0x04 650 435 740 435        # left-drag on/near the gizmo
if (-not (Alive)) { Fail "editor died during gizmo drag" }

# Ctrl+S save.
[UiSmoke]::keybd_event(0x11,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60
Key 0x53
[UiSmoke]::keybd_event(0x11,0,2,[UIntPtr]::Zero); Start-Sleep -Milliseconds 800
if (-not (Alive)) { Fail "editor died during save" }

Stop-Process -Id $proc.Id -Force

# 4. Assertions.
$stderr = Get-Content $errLog -Raw -ErrorAction SilentlyContinue
if ($stderr -match "FATAL") { Fail "FATAL on stderr: $stderr" }

if (-not (Test-Path $scratch)) { Fail "saved world missing" }
$saved = Get-Content $scratch -Raw | ConvertFrom-Json
$afterCount = $saved.entities.Count
if ($afterCount -lt ($beforeCount + $spots.Count)) {
  Fail "expected >= $($beforeCount + $spots.Count) entities after placing $($spots.Count), got $afterCount (placements did not land - key-identity class bug?)"
}
if (-not (Test-Path "$scratch.bak")) { Fail "safe-save .bak missing" }
if (-not (Test-Path "$scratch.tmp")) { Fail "safe-save .tmp missing" }

Write-Host "UI-SMOKE PASS: $beforeCount -> $afterCount entities, save verified, no crashes."
exit 0
