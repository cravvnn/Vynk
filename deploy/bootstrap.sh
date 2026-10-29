#!/usr/bin/env sh
# One-time setup for a fresh Debian/Ubuntu VPS: Docker + compose plugin.
#   scp deploy/bootstrap.sh root@VPS:/tmp/ && ssh root@VPS 'sh /tmp/bootstrap.sh'
# Safe to re-run: it skips anything already installed.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo sh deploy/bootstrap.sh" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable --now docker

# Open the web ports only if ufw is already active; never enable it for the
# user (that has locked people out of SSH before).
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 8787/tcp
fi

echo
docker --version
docker compose version
echo
echo "Next, from the repo (or the unzipped server package):"
echo "  cp deploy/.env.example .env      # set DOMAIN + ACME_EMAIL (or skip for IP mode)"
echo "  docker compose up -d --build     # domain + HTTPS"
echo "  docker compose -f docker-compose.yml -f deploy/compose-ip.yml up -d relay   # IP only"
