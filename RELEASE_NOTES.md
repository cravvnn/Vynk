# Release notes

User-facing notes for GitHub releases. `tools/publish.mjs` pulls the section for the
current version and drops it into the release description. Keep it plain-language and in
the `- **Title.** *Before:* … *After:* …` style. Technical detail lives in CHANGELOG.md.

## [0.7.3] - 2026-10-09

- **Joining a session late now catches you up.** *Before:* if a teammate had already been
  editing, someone who joined after saw none of those changes. *After:* Vynk replays the
  earlier edits automatically - once you're safely on the shared base project - so everyone
  is looking at the same thing.
- **Reconnects recover cleanly.** *Before:* a brief network drop could leave you behind.
  *After:* Vynk re-applies anything you missed when you come back, without duplicating what
  you already had.

## [0.7.2] - 2026-10-09

- **Mask edits now sync.** *Before:* moving or animating a mask didn't reach the other
  editor. *After:* mask shapes and their keyframes apply correctly.
- **More effect controls sync.** *Before:* some effect settings were ignored. *After:*
  effect parameters apply reliably, including effects whose names contain spaces.
- **Shape layers sync fully.** *Before:* the contents of a shape layer could come through
  empty. *After:* shapes are recreated on the other side.
- **Text syncing is on by default.** *Before:* text sync was off. *After:* edits to a text
  layer sync live (type, pause, and the other editor sees it).

## [0.7.0] - 2026-10-09

- **First packaged release.** *Before:* a hand-assembled beta. *After:* a one-command build
  producing versioned installer and server packages with a SHA-256 manifest.
- **Bring your own relay.** *Before:* a fixed server was baked in. *After:* enter your
  team's relay URL in the panel.