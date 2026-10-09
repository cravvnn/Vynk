# Vynk — native AEGP companion (design + scaffold)

Status: **live in AE 25.4 Beta** (panel m4.x). The `.aex` loads, registers its hooks, and
opens a **local bridge on an ephemeral loopback port** written to
`%LOCALAPPDATA%\Vynk\bridge.port` (HELLO -> `HELLO\tvynk\t1`, PING -> `PONG`).
It now does two real jobs: the **remote-cursor overlay** (own thread + click-through topmost
window, drawn incrementally) and **native change detection** (`AEGP_GetCurrentTimestamp` ->
`CHANGED`, plus `COMP`/`SEL`/`DIRTY`). It does **not** mutate the project yet (native diff/apply
is Phase 2/3). SDK 25.6 vendored at `third_party/AfterEffectsSDK` (git-ignored; Adobe-licensed,
do not redistribute).

Verified in-host by: `tools/dev-install-aegp.ps1` (elevated) copies the `.aex` into each AE
`Support Files\Plug-ins\Vynk\`, then read `bridge.port` and confirm something is
listening on that port.

## Why this exists (research summary)

The current sync loop lives in the CEP panel and polls the active comp with
`evalScript` every 200–500 ms. That is the root of the fragility: no edit/event hooks,
JSON string marshalling, and the AE-Beta landmines (`JSON` undefined, `PropertyType`,
`numEffects`, `ADBE Effect Parade`).

Research into Adobe's SDK (docsforadobe `AEGP Suites` / `Implementation`, and the
AE-SDK community Q&A) established two facts that define this project:

1. **There is no project-change notification in AEGP.** Adobe's own guidance for
   "detect when an effect is removed" / "detect when a project is saved" is: *scan on
   the idle hook and diff.* So polling does not disappear — it moves native.
2. **`AEGP_RegisterIdleHook` runs on AE's main thread at 20–50 Hz (Windows up to 60)**
   with direct PICA-suite access to the project. That is roughly 10× our current poll
   rate, with no ExtendScript marshalling and none of the landmines.

So the companion does not add a magic event bus. It replaces the *fragile* poll/apply
path with a *native* poll/apply path, and gives us things ExtendScript cannot:
persistent item IDs (`AEGP_GetItemID`), undo grouping (`AEGP_StartUndoGroup`), and
native keyframe/property/effect access.

AEGP is strictly single-threaded: all AE work happens on the main thread (idle hook or
a hook callback). Only `AEGP_CauseIdleRoutinesToBeCalled()` is thread-safe. So the
shape is the same as the existing cursor helper: **a background network thread hands
data to the main thread; the idle hook does all AE work.**

## Architecture

```
 relay (WS)  <---->  CEP panel (UI: cursors, members, rooms)
                          |  local TCP, tab/semicolon line protocol (no JSON in C++)
                          v
                    AEGP companion  (inside AfterFX.exe)
                      - bg thread: local bridge + relay feed
                      - idle hook (main thread, 20-60 Hz):
                          native read -> diff -> emit ops
                          apply remote ops (AEGP suites)
                      - command hook:  menu item(s)
                      - death hook:    cleanup
```

The panel keeps the WebSocket to the relay and all UI. The AEGP takes over the
**AE read/diff/apply**. Discovery and diff stay ours; only the AE access layer changes.

## Interop protocol (draft, line text — no C++ JSON parser)

Mirrors the helper↔panel style: tab-separated fields, one message per line.
`AEGP -> panel` and `panel -> AEGP` on a localhost TCP socket.

```
HELLO\tvynk\t1            AEGP announces itself
PING\t<ts>                     liveness
COMP\t<compKey>\t<numLayers>   active comp identity (native)
DIRTY\t<compKey>               project dirty flag transition (native)
SEL\t<compKey>\t<sid,sid,...>  selection changed (native)
OP\t<kind>\t<compKey>\t<sid>\t<path>\t<value...>   remote op to apply (panel->AEGP)
ACK\t<opId>\t<ok|err:...>      apply result (AEGP->panel)
```

Full op coverage (transforms, keyframes, masks, effects, shapes) will need field
extensions per phase — see the plan. Keeping it line-text avoids a JSON parser in C++,
matching the helper's deliberate choice.

## Phased plan

- **Phase 0 (this scaffold):** buildable AEGP that loads, registers idle/command/death
  hooks, opens the local bridge, and logs. No project mutation yet.
- **Phase 1:** native read of active comp identity + selection + dirty flag on the idle
  hook; send `COMP`/`SEL`/`DIRTY` to the panel. Panel cross-checks against its
  ExtendScript poll to validate the native path.
- **Phase 2:** native diff of transforms + scalar layer props; emit ops to the panel;
  panel relays as today. Panel stops polling those fields.
- **Phase 3:** native apply of remote ops; retire `collab.applyOp` for covered ops.
- **Phase 4:** native identity (`AEGP_GetItemID`) + undo groups; retire comment-stamp
  SIDs; expand to keyframes/masks/effects/shapes.

Each phase is independently shippable and can be feature-gated so the panel falls back
to ExtendScript if the AEGP is absent.

## Prerequisites

1. **After Effects C++ SDK 25.6** — vendored at `third_party/AfterEffectsSDK`
   (extracted from `AfterEffectsSDK_25.6_61_win`). Git-ignored; Adobe-licensed.
2. **Visual Studio 2022** with the C++ desktop workload (present).
3. **CMake** (present).

## Build (verified)

```powershell
$env:Path = "C:\Program Files\CMake\bin;" + $env:Path
cmake -S aegp -B aegp/build -G "Visual Studio 17 2022" -A x64 -DAE_SDK_PATH="<repo>\third_party\AfterEffectsSDK"
cmake --build aegp/build --config Release
# -> aegp/build/Release/vynk.aex  (exports EntryPointFunc)
```

Notes learned the hard way:
- **Entry point signature**: use the 5-arg `AEGP_PluginInitFuncPrototype`
  (`pica_basicP, major, minor, aegp_plugin_id, global_refconP`). Some SDK samples
  (Commando, Projector) still show a stale 7-arg form with `file_pathZ/res_pathZ`; if you
  copy it, AE passes `aegp_plugin_id` in the wrong slot and refuses to load with
  `internal verification failure {Plugin ID is invalid} (5027::47)`. Trust
  `AE_GeneralPlug.h`, not the samples.
- PiPL must be preprocessed with `/EP` (**not** `/P`) — PiPLtool rejects the `#line`
  directives `/P` emits. The build writes a small `.cmd` so the stdout redirect works.
- The PiPL is compiled by the SDK's `PiPLtool.exe` into an RC fragment that
  `res/vynk.rc` includes from the build dir.

## Install into After Effects (manual, needs admin)

1. Copy `aegp/build/Release/vynk.aex` into an AE **Plug-ins** subfolder, e.g.
   `C:\Program Files\Adobe\Adobe After Effects 2023\Support Files\Plug-ins\` (admin).
2. Fully restart After Effects.
3. Expect `[vynk] entry point complete` / `bridge listening` / `idle heartbeat ...`
   on OutputDebugString (DebugView). The companion listens on the port in
`%LOCALAPPDATA%\Vynk\bridge.port`.

## AE version compatibility

AEGP API versions are versioned per-suite; acquire the **minimum suite version** that
provides the functions used, and branch on `AEGP_GetPluginID`/version when behavior
differs. Target AE 2020+ to match the product constraint.

## Risks / notes

- **Crashing AE.** AEGP misuse crashes the host. Phase 0–1 must be conservative and
  guarded; no threading shortcuts; never call suites off the main thread.
- **Suite signatures in this scaffold are best-effort** and marked `VERIFY:` — validate
  against the installed SDK headers (`AE_GeneralPlug.h`, `AEGP_*` suite headers) before
  trusting them. Resource/PiPL files must be checked against an SDK sample.
- **Two AE instances:** AEGP handles are duplicated per instance; keep the companion
  instance-aware if multi-instance support is ever promised.
- **Not a replacement for the CEP panel.** The panel stays for UI + relay. The AEGP is
  an accelerator and de-risker for AE access.
