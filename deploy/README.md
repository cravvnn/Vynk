# Deploying the relay

One-command deploy: a Node relay behind Caddy (automatic HTTPS + WebSocket proxying).

## On a VPS with Docker

```bash
git clone <this repo>          # or copy the folder up
cd vynk
cp deploy/.env.example .env    # set DOMAIN to a real DNS name pointing at the VPS
docker compose up -d --build
docker compose logs -f caddy   # certificate should be issued within a minute
curl https://YOUR_DOMAIN/health
```

Expected health response: `{"ok":true,"proto":1,"rooms":0,"peers":0,"totalOps":0,"uptimeSec":...,"memory":{"rss":..,"heapUsed":..}}`

## Panel configuration

In the Vynk panel, set the server field to:

```
wss://YOUR_DOMAIN/ws
```

Everyone joins with the same room code (4-8 letters/digits). Op logs persist in the
`relay-data` volume as `rooms/<CODE>.jsonl`.

## Base project sharing

The relay also hosts one **base project** per room so the team starts from identical bytes
(edit identities line up). In the panel: the host clicks **share base** (uploads its saved
`.aep`), everyone else clicks **get base** (downloads and opens it in AE).

Endpoints (all require the room's token, issued in `welcome`):

```
PUT /base?token=<t>&name=<file>&by=<name>&ae=<ver>   # upload the base .aep
GET /base?token=<t>                                   # download it
GET /base/meta?token=<t>                              # { base: BaseInfo | null }
```

Limits and knobs (env vars on the `relay` service):

| Env | Default | Meaning |
|---|---|---|
| `MAX_BASE_BYTES` | `209715200` (200 MB) | Reject uploads larger than this (`413`). |
| `MAX_CONCURRENT_UPLOADS` | `4` | Concurrent uploads before `503`. |
| `BASE_DIR` | `<data>/bases` | Where base files + tokens are stored. |
| `DATA_DIR` | `<data>/rooms` | Op logs. |

Bases and tokens older than 7 days are swept at startup and every 6 h. Uploads are streamed to
disk; downloads are streamed. Uploads are rate-limited to one per 1.5 s per room.

## Notes and current limitations

- **No authentication yet.** Anyone with the URL and a room code can join. Keep the domain
  private or front it with an auth proxy until accounts land (M4 work).
- The relay never stores media or AE project files — only the op log.
- `DATA_DIR` defaults to `/data` (the mounted volume). Set `PORT` to change the listen port.
- Caddy needs ports 80 and 443 reachable and a DNS A/AAAA record for `DOMAIN`.
- To rebuild after code changes: `docker compose up -d --build`.
- Local (no Docker) run for development: `npm install && npm run build && npm start`.
