# Changelog

All notable changes to Vynk are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
