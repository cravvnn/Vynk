# Vynk

Real-time collaboration for Adobe After Effects. Vynk (Visual Link) gives a team one
shared project session: layers, properties, keyframes, masks, effects and shape layers
stay in sync, peer cursors are drawn over the composition, and a shared base project
guarantees everyone starts from identical bytes.

**Media never leaves your machine.** The relay only carries edit operations and the
optional base `.aep`; footage is resolved from your own storage.

## What syncs

- **Layers** - add, duplicate, remove, reorder, rename, parenting, in/out points, time
  stretch, blending modes, 3D, track mattes, labels and switches; solids, nulls, text,
  shapes, cameras, lights, footage and precomps.
- **Every property After Effects exposes** - transforms, effect parameters, masks, shape
  contents, text and text animators, camera and light options, time remap - with their
  keyframes, interpolation, eases, spatial tangents and expressions.
- **The whole project** - comps that are not open, new comps, folders, renames, precompose,
  composition settings and markers.
- **Cursors, selection and presence.**

- **Layer styles** and **Curves** (and other effects that keep their own data; needs the
  native plug-in).

Not synced yet: the Pattern Overlay layer style, and keyframed Curves.
Solo, shy, lock and your selection stay local.

Playheads are deliberately **not** synced - editors work at different points of the
timeline on purpose.

## Requirements

- Windows 10 or 11
- Adobe After Effects 2020 or newer (2022+ recommended)
- For the relay: Docker, or Node 22+

## Install (editors)

1. Download `Vynk-<version>-panel.zip` from the releases page.
2. Unblock the zip (right-click > Properties > Unblock), then extract it.
3. Fully close After Effects and run `install.bat` - accept the admin prompt for the
   native overlay.
4. Start After Effects and open **Window > Extensions > Vynk**.
5. Enter your name and the room code, then click join. The relay is preconfigured;
   change the server field only if you run your own.

See [INSTALL.md](INSTALL.md) for details and troubleshooting.

To give late joiners the same project, use **save & share** once sync settles.
Vynk saves the current project and uploads a private snapshot; edits made while
it uploads stay in the room history. **get base** opens that snapshot after your
confirmation and catches up with the room. Use the current panel and relay for
this workflow; older shared bases need to be shared again.

An ordinary reconnect keeps the current project and recovers missed edits even
when someone shared a newer base while it was offline. Reloading the panel needs
the shared base and complete history; save local work before replacing a project.

## Run the relay

Domain + HTTPS:

```bash
cp deploy/.env.example .env      # set DOMAIN to a DNS name pointing at the host
docker compose up -d --build
curl https://YOUR_DOMAIN/health
```

IP only, for quick solo testing:

```bash
docker compose -f docker-compose.yml -f deploy/compose-ip.yml up -d relay
curl http://VPS_IP:8787/health
```

Then point the panel's server field at `wss://YOUR_DOMAIN/ws` (or
`ws://VPS_IP:8787/ws`). See [deploy/README.md](deploy/README.md) for setup,
limits, endpoints and updates.

## Development

```bash
npm install
npm run build      # TypeScript (protocol + server)
npm test           # sync-model, JSON-polyfill and panel recovery/HTTP tests
npm run check:tla  # bounded state models and guard mutants (dev-only checker)
npm run test:panel-runtime  # panel HTTP/file helpers; also run on Node 8.6 in CI
npm run test:delivery  # private relay: dropped edits/echoes, restart, base checkpoints and disk failure
npm start          # relay on :8787
npm run smoke      # relay integration checks (relay must be running)
npm run package    # build distributable zips + SHA-256 manifest into dist/
```

The After Effects side is plain browser JS (CEP) plus an ES3 ExtendScript hostscript;
the native companion (`aegp/`) is C++17 built with CMake and the After Effects SDK.

## Repository layout

| Path | What |
|---|---|
| `panel/` | CEP panel: UI, WebSocket client, diff engine |
| `panel/jsx/` | ExtendScript hostscript (state snapshots + apply) |
| `aegp/` | Native companion: cursor overlay + change detection |
| `server/` | Hosted relay (rooms, op log, base project) |
| `shared/protocol/` | Message + op schema shared by panel and server |
| `deploy/` | Docker Compose + Caddy deploy |
| `tools/` | Development, test and packaging scripts |

## License

MIT - see [LICENSE](LICENSE).
