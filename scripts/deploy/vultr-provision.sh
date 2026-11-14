#!/usr/bin/env bash
# One-time server setup on a fresh Vultr Ubuntu 24.04 instance (run as root via ssh).
# Usage: ssh root@IP 'bash -s' < scripts/deploy/vultr-provision.sh <hostname>
set -euo pipefail
HOST="${1:?hostname (e.g. 1-2-3-4.sslip.io)}"
export DEBIAN_FRONTEND=noninteractive

# 1 GB box: add swap so npm install doesn't OOM.
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg ufw debian-keyring debian-archive-keyring apt-transport-https >/dev/null
# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
apt-get install -y -qq nodejs >/dev/null
# Caddy (automatic HTTPS)
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq && apt-get install -y -qq caddy >/dev/null

id app >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/accesspath --shell /usr/sbin/nologin app
install -d -o app -g app /opt/accesspath/app
touch /etc/accesspath.env && chmod 600 /etc/accesspath.env

cat > /etc/systemd/system/accesspath.service <<UNIT
[Unit]
Description=AccessPath SD (Next.js)
After=network-online.target
[Service]
User=app
WorkingDirectory=/opt/accesspath/app
EnvironmentFile=/etc/accesspath.env
Environment=NODE_ENV=production PORT=3000 HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=on-failure
MemoryMax=700M
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
${HOST} {
  encode gzip
  reverse_proxy 127.0.0.1:3000
  log {
    output discard
  }
}
CADDY

ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
systemctl daemon-reload
systemctl enable accesspath >/dev/null 2>&1
systemctl restart caddy
echo "provisioned: node $(node -v), caddy $(caddy version | cut -d' ' -f1)"
