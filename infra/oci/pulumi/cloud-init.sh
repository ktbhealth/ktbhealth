#!/bin/bash
# cloud-init user-data for the KTB LGTM OCI VM (ARM64 — A1.Flex).
# Rendered by make-spec.sh: __PLACEHOLDERS__ are substituted with values
# pulled from cuora at spec-generation time. Runs as root on first boot.
#
# What it does:
#   1. installs docker + compose plugin + git (Ubuntu 24.04 arm64)
#   2. clones ktbhealth/product@main and brings up infra/lgtm
#      (otel-lgtm + self-hosted ntfy) with a generated .env
#   3. installs cloudflared, writes tunnel credentials + ingress config,
#      enables the systemd service
#
# NOTE: secrets embedded here are visible to anyone who can read the
# instance's metadata/user-data (tenancy members with compute read).
# That is the standard cloud-init trade-off; the tenancy is private.
set -euo pipefail
exec > /var/log/ktb-bootstrap.log 2>&1

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y docker.io docker-compose-v2 git curl
systemctl enable --now docker

git clone --depth 1 https://github.com/ktbhealth/product /opt/ktb/product
cd /opt/ktb/product/infra/lgtm

cat > .env <<'ENVEOF'
GF_SECURITY_ADMIN_USER=admin
GF_SECURITY_ADMIN_PASSWORD=__GF_ADMIN_PASSWORD__
GF_SERVER_ROOT_URL=https://ktb-grafana.luisfuturist.com
NTFY_URL=__NTFY_URL__
NTFY_PUBLIC_URL=https://ktb-ntfy.luisfuturist.com
PROMETHEUS_EXTRA_ARGS=--storage.tsdb.retention.time=7d
ENVEOF

docker compose up -d

# cloudflared — arm64 .deb (A1.Flex is aarch64).
curl -fsSL -o /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
dpkg -i /tmp/cloudflared.deb
rm -f /tmp/cloudflared.deb

mkdir -p /etc/cloudflared
cat > /etc/cloudflared/__TUNNEL_ID__.json <<'CREDSEOF'
__TUNNEL_CREDENTIALS__
CREDSEOF
chmod 600 /etc/cloudflared/__TUNNEL_ID__.json

cat > /etc/cloudflared/config.yml <<'CFGEOF'
tunnel: __TUNNEL_ID__
credentials-file: /etc/cloudflared/__TUNNEL_ID__.json

ingress:
  - hostname: ktb-otel.luisfuturist.com
    service: http://localhost:4318
  - hostname: ktb-grafana.luisfuturist.com
    service: http://localhost:3000
  - hostname: ktb-ntfy.luisfuturist.com
    service: http://localhost:8086
  - service: http_status:404
CFGEOF

cat > /etc/systemd/system/cloudflared.service <<'UNITEOF'
[Unit]
Description=Cloudflare Tunnel client
After=network-online.target docker.service
Wants=network-online.target

[Service]
ExecStart=/usr/bin/cloudflared --no-autoupdate --config /etc/cloudflared/config.yml tunnel run
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable --now cloudflared

echo "ktb-lgtm bootstrap complete $(date -Is)"
