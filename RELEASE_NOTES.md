# Release notes

User-facing notes for GitHub releases. `tools/publish.mjs` pulls the section for the
current version and drops it into the release description. Keep it plain-language and in
the `- **Title.** *Before:* … *After:* …` style. Technical detail lives in CHANGELOG.md.

## [0.8.0] - 2026-11-14

Everyone in a room must update: 0.8 and 0.7 panels cannot share a session.

- **Far more of the project syncs.** *Before:* position, scale, rotation, opacity, anchor,
  effects, masks, shapes and text. *After:* every property After Effects exposes, plus
  blending modes, 3D layers, cameras, lights, label colours, time stretch, time remap,
  track mattes and markers.
- **The whole project syncs, not just the open comp.** *Before:* an edit in a comp you did
  not have open was never sent. *After:* background comps, new comps, folders, renames and
  precompose all reach your team.
- **Sessions stay in sync instead of drifting.** *Before:* one missed edit could freeze
  layer syncing for the rest of the session, and edits could bounce or get lost. *After:*
  each client tracks the shared state exactly and corrects itself; when two people change
  the same value, the later edit wins for everyone.
- **Projects that drift apart repair themselves.** *Before:* if an edit could not be
  applied on one machine, the two projects stayed different for the rest of the session.
  *After:* the panels compare notes in the background and the missing or different layers
  are sent across again.
- **A teammate's change is one undo step.** *Before:* a single drag could land as several
  separate changes. *After:* each gesture arrives whole.
- **Sync keeps running when you switch apps.** *Before:* incoming edits waited until After
  Effects was the active window again. *After:* they apply in the background.
- **Duplicating a layer works.** *Before:* a duplicate could be confused with its original.
  *After:* it syncs as its own layer.
- **Big comps stay responsive.** The panel reads in depth only what you are working on.

Not yet synced: layer styles, and effect controls that hold custom data such as Curves.

## [0.7.7] - 2026-10-29

- **Conflicts always end on a shared value.** *Before:* in a narrow case (a brand-new
  keyframe) a rejected edit could stay on your side only. *After:* every rejected edit is
  undone locally, either to the other editor's value or to the state you started from.

## [0.7.6] - 2026-10-29

- **Two people on the same control no longer fight.** *Before:* editing the same property
  at the same time made the value bounce between you. *After:* whoever is actively editing
  keeps it, and the other editor is told who is changing it instead of silently losing the
  value.

## [0.7.5] - 2026-10-29

- **You can hop back into a session after being away.** *Before:* if you missed more edits
  than the relay replays, you silently got a partial history. *After:* the panel pulls the
  missing edits and catches you up properly - and tells you when the gap is too big to
  replay safely.
- **Dragging a value no longer fights the other person.** *Before:* two people on the same
  slider made the value jump back and forth. *After:* an incoming edit waits for your drag
  to finish, then the newest value wins.
- **The panel shows its own health.** *Before:* you found out sync was struggling by
  noticing things were wrong. *After:* a live line shows poll cost, edits in/out, failed
  applies and reconnect count.
- **Edits made offline survive a restart.** *Before:* closing AE with unsynced edits lost
  them. *After:* they are kept and sent when you reconnect.

## [0.7.4] - 2026-10-29

- **The panel points at the team relay already.** *Before:* you had to paste a server
  address before joining. *After:* a fresh install just needs a name and a room code.
- **Your saved relay is respected.** *Before:* there was nothing to keep. *After:* an
  upgrade never overwrites the address you entered, so moving relays is a one-field edit.
- **Shared projects survive server updates.** *Before:* the shared project file could
  disappear whenever the relay was rebuilt. *After:* it is kept with the room data.
- **The relay deploy actually builds.** *Before:* building the server image from a clean
  checkout failed partway through. *After:* one command builds and starts it.

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