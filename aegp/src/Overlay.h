#pragma once

class Bridge;

// Native remote-cursor overlay, hosted inside AfterFX.exe by the AEGP (no
// separate helper process). Owns a background thread with its own message loop
// so cursor capture + GDI drawing never run on AE's main thread.
//
// Protocol over the shared Bridge:
//   panel -> AEGP: PEERS <id\tname\tcolor\tx\ty\thasCursor ; ...>
//   AEGP -> panel: CURSOR <x\ty>, FOCUS <0|1>, HELLO/PONG
void Overlay_start(Bridge* bridge);
void Overlay_stop();
