# Changelog

All notable changes to Vynk are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
