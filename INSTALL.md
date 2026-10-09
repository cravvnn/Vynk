# Installing Vynk

## Editors (panel + native overlay)

1. Download `Vynk-<version>-panel.zip` and unblock it (right-click the zip >
   **Properties** > **Unblock** > **Apply**), then extract it.
2. Fully close After Effects.
3. Run `install.bat` (double-click) or `install.ps1` in PowerShell. Accept the admin
   prompt when it appears - the native overlay installs into After Effects' Plug-ins
   folder.
4. Start After Effects and open **Window > Extensions > Vynk**.
5. Enter your name and the room code, then click **join**.

The panel log should start with:

```
panel v<version> starting ... text=off
```

### Troubleshooting

- **Panel missing from the Extensions menu** - run `diagnose.ps1` in the extracted
  folder and send the output to the maintainer.
- **Scripts blocked** - the zip was not unblocked before extracting; unblock it and
  extract again.
- **Cursor overlay not showing** - the overlay needs the admin step in step 3 and only
  draws while After Effects is the foreground window.
- **Two panels on one machine** - op sync works, but the native cursor bridge serves one
  panel at a time; the second AE instance falls back to polling (no peer cursors).

## Relay (server)

Requires Docker and a DNS name pointing at the host.

```bash
cp deploy/.env.example .env      # set DOMAIN (and optionally ACME_EMAIL)
docker compose up -d --build
docker compose logs -f caddy     # certificate should be issued within a minute
curl https://YOUR_DOMAIN/health
```

Then set the panel's server field to `wss://YOUR_DOMAIN/ws`. See
[deploy/README.md](deploy/README.md) for the base-project endpoints and limits.

## Building from source

```bash
npm install
npm run build
npm test
```

The native companion needs the After Effects C++ SDK and CMake/MSVC:

```bash
cmake -S aegp -B aegp/build -G "Visual Studio 17 2022" -A x64 -DAE_SDK_PATH=<repo>/third_party/AfterEffectsSDK
cmake --build aegp/build --config Release
```

Then produce distributable packages (this bundles the built `vynk.aex`):

```bash
npm run package
```

Artifacts and their SHA-256 hashes land in `dist/` along with `manifest-<version>.json`.
