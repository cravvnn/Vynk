# Changelog

All notable changes to Vynk are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
