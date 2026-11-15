# Changelog

All notable changes to Vynk are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-11-14

Sync engine v2. Protocol version 2: 0.7.x panels cannot join a 0.8 room.

### Added

- **Generic property-tree sync.** A layer is its attributes plus its whole property tree,
  addressed by matchName paths, so everything After Effects exposes to scripts syncs without
  per-feature code: all transform properties (3D, separated dimensions), every effect
  parameter, masks, shape contents, text documents and animators, camera and light options,
  material and geometry options, time remap, audio levels, layer and comp markers.
- **More layer attributes.** Blending mode, 3D, label colour, stretch, track matte, quality,
  guide/adjustment flags, collapse transformations, comments, cameras and lights as layers.
- **Whole-project sync.** Edits in comps that are not open, new comps, folders, renames,
  moving items between folders and precompose all sync. Previously only the active comp did.
- **Self-repair.** Each panel publishes a fingerprint of the comp it has open. When two
  fingerprints still differ after both sides have caught up, the peer with the higher id
  asks the lowest-id peer for the layers that differ and gets whole layers back. An edit
  that cannot be applied because its layer or comp is missing triggers the same request
  immediately. A repair never deletes a layer, and requests are relayed but not logged.
- **Late joiners catch up without a shared base.** The reference in a repair is whoever has
  been in the room longest. Someone who joins mid-session on the original project file is
  sent the room's comps and folders, and every comp they open is brought to the room's state
  (new layers created, changed ones overwritten, layers deleted before they arrived removed).
- **Follow-up pass.** After any edit the open comp is walked once in small slices, so an edit
  to a layer that was deselected again before the panel looked is still found.
- **Two-instance convergence harness** (`npm run test:pair`): runs two real After Effects
  versions against a private relay, makes scripted edits in one and compares a full
  independent dump of both projects. 67 scenarios including a 100-layer stress comp.
- `tools/test-sync.mjs`: unit tests for the new diff/adopt model.

### Changed

- **Convergence model.** The panel keeps a shadow of the shared state per comp. Remote ops
  are applied and the project is re-read in the same After Effects call, and what the ops
  touched is adopted as shared state. This replaces value-matching echo suppression with a
  5 s TTL, which could both re-send remote edits and swallow local ones.
- **Conflicts are last-writer-wins in relay order.** A client skips a remote edit to a value
  it has an unacknowledged edit for. The 0.7.6 claim/reject/revert path is no longer used.
- **One gesture is one atomic batch**, applied in one undo step on the receiving side.
- **Sync no longer pauses when After Effects is not the foreground app.**
- **Read cost is independent of comp size.** Every layer's attributes are read each cycle;
  the full property tree only for selected layers, layers touched by incoming edits, and a
  small rotating slice. The native companion's change signal triggers a one-off full read
  when nothing selected explains a change.
- Looking at a 100-layer comp costs about 10 ms instead of 100: attributes a layer type does
  not have are no longer probed (a throwing read costs as much as a hundred good ones), and
  unchanged attributes are not re-sent to the panel.
- Duplicated layers get their own identity (a duplicate used to share its original's id).
- Solo, shy, lock and selection are deliberately local.

### Removed

- The v1 reader/applier in `hostscript.jsx` (it now only installs the JSON polyfill and
  reports host details), the headless v1 apply harness (`npm run verify:ae`),
  `tools/probe-op.mjs`, and the relay's per-property claims (`CLAIM_TTL_MS`,
  `tools/test-claims.mjs`) - conflicts now resolve in relay order on the clients.
- The v1 diff engine (`panel/src/diff.js`), its tests and fuzzer, per-surface polling
  (effects/text/shapes), the structure circuit breaker and the divergence hold, which
  stopped all structure sync after a single missed op.

### Fixed

- **Stale panel copies.** A panel reload re-ran the script in the same window while the
  previous copy's timers kept firing, so several sync loops drove one project. Every timer
  now checks it belongs to the newest copy.
- Keyframes created by a teammate arrived with the wrong interpolation.
- A new layer and an edit that referred to it (parenting) could arrive in the wrong order.
- New text and shape layers arrived empty.

### Known gaps

- Layer styles: After Effects gives scripts no way to add one.
- Effect parameters with custom data (for example Curves) cannot be read by scripts.
- Footage import is not announced on its own; footage layers resolve media by path or name.

## [0.7.7] - 2026-10-29

### Fixed

- **A conflicting edit always has a value to revert to.** Eviction from the relay's
  per-target map (`MAX_TRACKED_TARGETS`) now skips targets with a live claim, so a rejected
  edit can no longer arrive without the winning op.
- **New-keyframe conflicts undo cleanly.** If no winning op exists, an `addKey` rejection is
  undone locally with its exact inverse (`removeKey` at the same time) instead of leaving
  the keyframe in place. Anything still unrecoverable is counted as `desync` in the sync
  health line.

## [0.7.6] - 2026-10-29

### Added

- **Per-target edit claims.** The relay claims the exact value being edited (layer+path,
  per-keyframe time, or comp setting) for 4 s, renewed by every accepted op. A conflicting
  edit from another peer is rejected instead of logged, and the rejection carries the
  winning op, so the sender's panel reverts to the room value and reports who is editing.
  Structure ops (add/remove/reorder/effect/mask) are never claim-gated. `CLAIM_TTL_MS`
  configures the lease.

## [0.7.5] - 2026-10-29

### Added

- **Live sync health.** The panel now shows a one-line readout - poll cost, ops sent/received,
  apply failures, queue depth, reconnects and catch-up state - and exposes
  `window.vynkHealth()` for support. Slow polls and failed applies are visible instead of
  inferred from behaviour.
- **Hop back in after a long absence.** The relay serves its persisted op log through
  `GET /ops?token&after&before&limit`, and `welcome` now carries `baseSeq` plus
  `truncated`/`fromSeq`. When the welcome replay is partial the panel fetches exactly the
  missing post-base ops and applies them in order (up to 2,000; beyond that it asks for a
  fresh base instead of silently under-syncing).
- **No rubber-banding during a drag.** Remote edits to a property you are actively editing
  wait for your gesture to settle (700 ms) and then apply the newest value per target, so
  two people on the same slider see a clean last-writer-wins instead of a fight.
- **The offline queue survives a restart.** Edits made while disconnected are persisted to
  `localStorage` per server+room and removed as they are sent, so reloading the panel or
  restarting AE no longer discards up to 500 pending ops.
- **CI on GitHub Actions.** Every push builds, runs the syntax/ES3 gates, unit tests, relay
  endpoint tests, a 30 s soak and smoke against a live relay; a Linux job packages the
  server zip and asserts it unpacks with forward-slash paths.

### Changed

- `MAX_OPS_IN_WELCOME` is configurable (default 3000) for tests and small hosts.
- `soak-system` scales its reconnect interval to the run length and stops reconnect
  attempts just before shutdown, so short runs cover reconnects without false failures.

## [0.7.4] - 2026-10-29

### Changed

- **The panel now defaults to the self-hosted relay** (`wss://vynk.allevilmc.com/ws`),
  so a fresh install joins without editing the server field. A saved server value still
  wins.

### Fixed

- **Relay image build from a clean checkout.** A copied `tsconfig.tsbuildinfo` made
  `tsc -b` skip emitting `@vynk/protocol` while `.dockerignore` strips `dist/`, so the
  Docker build failed with `TS2307: Cannot find module '@vynk/protocol'`. The build now
  ignores `**/*.tsbuildinfo` and forces a full emit.
- **Shared base projects survive container rebuilds.** `BASE_DIR` did not follow
  `DATA_DIR`, so uploaded `.aep` files were written into the container layer and lost on
  every redeploy. Compose now pins `DATA_DIR=/data/rooms` and `BASE_DIR=/data/bases` on
  the `relay-data` volume.
- **Caddy starts without `ACME_EMAIL`.** An empty email produced
  `wrong argument count ... after 'email'` and the container refused to start; compose
  and the Caddyfile now default it.

- **Release archives are portable.** `.zip` entry names were written with Windows
  backslashes, so the server package extracted on Linux as a flat pile of files called
  `deploy\Caddyfile`. Packaging now writes spec-compliant forward-slash names and CI
  unpacks the server zip on Linux on every push.

## [0.7.3] - 2026-10-09

### Added

- **Safe late-join catch-up.** A client joining after edits have started now applies the
  room's buffered ops automatically - but only when it is provably on the shared base
  project (it opened the base, or its project matches the base name) and there is no
  structural divergence. Otherwise catch-up is held with a clear log line. The relay
  filters `welcome.ops` to everything after the base upload, so the base is never
  double-applied, and already-seen ops (by `opId`) are skipped, which also makes
  reconnect catch-up work.

## [0.7.2] - 2026-10-09

Apply-path fixes found by the new headless After Effects harness (44 checks, all green).

### Fixed

- **Mask paths.** Setting a mask path now builds a real `Shape` object; plain objects
  were rejected by AE ("Object is not of the correct type").
- **Effect parameters.** Parameter paths whose matchName contains spaces
  (e.g. `ADBE Glow 2-0001`) now resolve, so effect-parameter changes apply.
- **Shape layers.** Vector items are added under a group's Contents
  (`ADBE Vectors Group`); adds to the group itself silently did nothing.
- **Mask feather/opacity/expansion.** A scalar now expands across the property's
  dimensions instead of being rejected as a mismatch.
- **Clearer apply errors.** Layer `frameBlending`, `frameBlendingType`, `isTrackMatte`
  and `trackMatteType` report AE's readOnly/enum messages instead of a generic failure.

### Added

- `npm run verify:ae` headless apply harness (`tools/ae-headless/verify.jsx`) covering
  transforms, scalars, keyframes (interp/ease/spatial), expressions, add/remove/reorder,
  parenting, motion blur, comp settings, effects, masks, shape trees, text, and negative
  targeting.

## [0.7.1] - 2026-10-09

### Changed

- **Text sync is now on by default.** The installer enables `VYNK_TEXT_SYNC` (pass
  `-TextSync:$false` to turn it off); the panel startup log now reads `text=on`. Text is
  debounced, focus-gated and echo-suppressed, and syncs only the selected text layer.

## [0.7.0] - 2026-10-09

First packaged release of Vynk (formerly "Multiplayer AE").

### Added

- Real-time co-editing of layers, properties, keyframes, masks, effects and shape
  layers across editors.
- Native After Effects companion (`vynk.aex`): remote-cursor overlay and native change
  detection.
- Hosted relay with a persisted per-room op log and replay for late joiners.
- Shared base project: upload/download the saved `.aep` so everyone starts from
  identical bytes, with divergence detection.
- Cursor, selection and presence sync. Playheads intentionally never sync.
- One-command relay deploy (Docker + Caddy) and a one-click editor installer.
- Reproducible `npm run package`: versioned panel/server zips, a generated installer
  bundle and a SHA-256 manifest.

### Changed

- The installer no longer preconfigures a relay server; editors enter their team's
  relay URL in the panel.

### Notes

- Windows only; After Effects 2020+.
- Media is never transferred by the relay.
