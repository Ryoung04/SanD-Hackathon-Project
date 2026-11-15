#!/usr/bin/env bash
# Build locally, ship the built app, restart. Usage: scripts/deploy/vultr-deploy.sh <ip>
# Ships ONLY the env vars the public app needs (no Bright Data / Vultr / admin tokens).
set -euo pipefail
IP="${1:?server ip}"
KEY="${SSH_KEY:-$HOME/.ssh/accesspath_vultr}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new root@$IP"
cd "$(dirname "$0")/../.."

npm run build >/dev/null
tar czf /tmp/accesspath-release.tgz --exclude=.next/cache .next package.json package-lock.json next.config.mjs \
  $( [ -d public ] && echo public ) $( [ -f data/notices.json ] && echo data/notices.json ) $( [ -f data/imagery_checks.json ] && echo data/imagery_checks.json )
scp -i "$KEY" -q /tmp/accesspath-release.tgz root@"$IP":/tmp/release.tgz
rm -f /tmp/accesspath-release.tgz

# Public-app env subset, read from local .env without echoing values.
grep -E '^(GEMINI_API_KEY|ELEVENLABS_API_KEY|DATABASE_URL)=' .env | $SSH 'cat > /etc/accesspath.env && chmod 600 /etc/accesspath.env'

$SSH 'set -e; cd /opt/accesspath/app && find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + \
  && tar xzf /tmp/release.tgz && rm /tmp/release.tgz && mkdir -p data && chown -R app:app /opt/accesspath \
  && sudo -u app npm ci --omit=dev --no-audit --no-fund --ignore-scripts >/dev/null \
  && systemctl restart accesspath && sleep 3 && systemctl is-active accesspath'
