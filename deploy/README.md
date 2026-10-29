# Deploying the relay

A Node relay behind Caddy (automatic HTTPS + WebSocket proxying). Two modes:

| Mode | Needs | Panel server field | Use for |
|---|---|---|---|
| **IP only** | nothing | `ws://VPS_IP:8787/ws` | solo testing, first smoke test |
| **Domain** | DNS A/AAAA record | `wss://YOUR_DOMAIN/ws` | teammates, anything real |

Both run the same container image; the domain mode just puts Caddy in front so the
connection is encrypted and port 8787 stays private.

## 1. Prepare the VPS (once)

```bash
scp deploy/bootstrap.sh root@VPS_IP:/tmp/
ssh root@VPS_IP 'sh /tmp/bootstrap.sh'
```

Installs Docker + the compose plugin and opens the ports. Also open them in your
provider's firewall panel (Hetzner/OVH/DigitalOcean call it a firewall or security
group) - the host firewall cannot help if the cloud one is closed.

## 2a. IP-only (fastest for testing)

```bash
git clone https://github.com/cravvnn/Vynk.git /opt/vynk   # or scp + unzip the server package
cd /opt/vynk
docker compose -f docker-compose.yml -f deploy/compose-ip.yml up -d relay
curl http://VPS_IP:8787/health
```

Set the panel's server field to `ws://VPS_IP:8787/ws` and join a room. This is
unencrypted - fine for your own testing, not for other people's work.

## 2b. Domain + HTTPS

Point an A (and AAAA if you have IPv6) record at the VPS, then:

```bash
cd /opt/vynk
cp deploy/.env.example .env       # set DOMAIN (and ACME_EMAIL)
docker compose up -d --build
docker compose logs -f caddy      # certificate should be issued within a minute
curl https://YOUR_DOMAIN/health
```

Caddy needs ports 80 and 443 reachable. DNS must resolve *before* the first start or
the certificate request fails (Caddy retries every few minutes, so it recovers on its
own once DNS propagates). If the name is on Cloudflare, keep the record **DNS only**
(grey cloud) - an orange-cloud proxy hides the origin and the ACME challenge fails.

Verify a deployed relay end to end (ops, cursors, locks, base upload/download):

```bash
URL=wss://YOUR_DOMAIN/ws HEALTH_URL=https://YOUR_DOMAIN/health npm run smoke
BASE=https://YOUR_DOMAIN npm run deploy:probe
```

Expected health response: `{"ok":true,"proto":1,"rooms":0,"peers":0,"totalOps":0,"uptimeSec":...,"memory":{"rss":..,"heapUsed":..}}`

## Hosts where 80/443 are already taken

If another Caddy or nginx already owns the web ports (for example a box that also
serves `maps.example.com`), do not start Vynk's caddy - publish the relay instead and
add one site block to the existing server:

```caddyfile
vynk.example.com {
    reverse_proxy <docker-gateway>:8787
}
```

`<docker-gateway>` is the host address on the existing container's network:

```bash
docker inspect <caddy-container> --format '{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}'
```

Reload that Caddy, then check `https://vynk.example.com/health`. To stop a plain
`docker compose up -d` from ever fighting over the ports, park Vynk's caddy behind a
profile and publish the relay in a host-local `docker-compose.override.yml`:

```yaml
services:
  relay:
    ports: ["8787:8787"]
  caddy:
    profiles: ["domain"]
```

## Panel configuration

In the Vynk panel, set the server field to the matching URL from the table above.
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
GET /ops?token=<t>&after=<seq>&before=<seq>&limit=<n> # paged op history (NDJSON)
```

Limits and knobs (env vars on the `relay` service):

| Env | Default | Meaning |
|---|---|---|
| `MAX_BASE_BYTES` | `209715200` (200 MB) | Reject uploads larger than this (`413`). |
| `MAX_CONCURRENT_UPLOADS` | `4` | Concurrent uploads before `503`. |
| `BASE_DIR` | `<data>/bases` | Where base files + tokens are stored. |
| `DATA_DIR` | `<data>/rooms` | Op logs. |
| `MAX_OPS_IN_WELCOME` | `3000` | Max ops replayed to a late joiner. Beyond this the relay sets `welcome.truncated` so the panel can refuse an incomplete catch-up. |
| `CLAIM_TTL_MS` | `4000` | How long an edit claim on a property lasts after the last accepted op. |

The bundled compose file sets `DATA_DIR=/data/rooms` and `BASE_DIR=/data/bases`, both inside
the `relay-data` volume, so rebuilding or recreating the container keeps rooms and shared bases.

Bases and tokens older than 7 days are swept at startup and every 6 h. Uploads are streamed to
disk; downloads are streamed. Uploads are rate-limited to one per 1.5 s per room.

## Updating a running relay

```bash
cd /opt/vynk && git pull
docker compose up -d --build          # domain mode
docker compose -f docker-compose.yml -f deploy/compose-ip.yml up -d --build relay   # IP mode
```

The `relay-data` volume survives rebuilds, so rooms, op logs and shared bases are kept.
`docker compose down -v` **deletes** them.

## Notes and current limitations

- **No authentication yet.** Anyone with the URL and a room code can join. Keep the domain
  private or front it with an auth proxy until accounts land (M4 work).
- The relay never stores media.
- `DATA_DIR` defaults to `/data` (the mounted volume). Set `PORT` to change the listen port.
- Local (no Docker) run for development: `npm install && npm run build && npm start`.
