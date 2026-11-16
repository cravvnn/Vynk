# Release notes

User-facing notes for GitHub releases. `tools/publish.mjs` pulls the section for the
current version and drops it into the release description. Keep it plain-language and in
the `- **Title.** *Before:* … *After:* …` style. Technical detail lives in CHANGELOG.md.

## [0.8.1] - 2026-11-16

Build **m3.11** adds:

- **Animated Curves and compatible custom controls sync.** *Before:* only static values
  were supported. *After:* key times, values, interpolation and temporal ease travel
  together, including fractional timing, reversed layers and locally locked peers.
- **Pattern Overlay controls work from a shared base.** *Before:* layer repair could
  reject an existing pattern style. *After:* its controls and animation are preserved.
- **Layer identity works without newer scripting IDs.** *Before:* older AE versions
  lacked the layer ID exposed by newer scripting APIs. *After:* the native companion
  supplies fresh identities while keeping shared-base layers and comments intact.
- **Your playhead stays yours.** *Before and after:* editors can work at different
  timeline positions while their changes sync.

Install the current panel and native companion on every editor's machine. Focused
checks on AE 25.6 and 26.3 passed all 24 Curves, Pattern and identity cases, plus a
nine-case run with native identity enabled before Pattern. Both runs ended with
matching dumps, empty edit queues and zero apply failures.

This is a preview build. The complete 113-case run and AE2020 runtime matrix remain
pending. Some newer text and camera defaults differ between AE 25.6 and 26.3.

New Pattern Overlay artwork still needs to be included in a shared base project.
Import the styled PSD before sharing; share an updated base when adding new artwork.
Style rebuilds that would discard an existing pattern are refused. Custom-data
layouts must match; each control supports up to 600 keys / 512 KiB of encoded data.

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
- **Join a session that is already running.** *Before:* a late joiner needed the host to
  share a fresh base project first. *After:* open the original project, join, and each comp
  you open is brought up to date automatically.
- **A teammate's change is one undo step.** *Before:* a single drag could land as several
  separate changes. *After:* each gesture arrives whole.
- **Sync keeps running when you switch apps.** *Before:* incoming edits waited until After
  Effects was the active window again. *After:* they apply in the background.
- **Duplicating a layer works.** *Before:* a duplicate could be confused with its original.
  *After:* it syncs as its own layer.
- **Big comps stay responsive.** The panel reads in depth only what you are working on.

- **Layer styles and Curves sync.** Drop shadows, strokes, glows and the rest, plus Curves
  and other effects that keep their own data. (A layer style added in a comp your teammate
  does not have open appears when they open it.)
- **Every comp stays in step, not just the open one.** Comps nobody is looking at are
  compared in the background and repaired if they drift.

Not yet synced: the Pattern Overlay layer style, and Curves that are keyframed.

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