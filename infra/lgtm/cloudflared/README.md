# cloudflared tunnel config

Example ingress for exposing the LGTM stack through a Cloudflare Tunnel.
Full setup steps (login, tunnel create, DNS routes, service install) are
in `../README.md` → "One-time host setup → Tunnel".

Two operating modes — pick one:

- **Locally-managed** (this file): `cloudflared tunnel login` once on the
  host, then `cloudflared tunnel run ktb-lgtm` with this config. Ingress
  rules live in git.
- **Remotely-managed**: skip this file; create the tunnel in the CF
  dashboard/`cloudflared tunnel create --token` and manage ingress there,
  or uncomment the `cloudflared` service in `../compose.yaml`.

Hostnames to replace: `otel.example.com` (OTLP ingest) and
`grafana.example.com` (Grafana UI — put Cloudflare Access in front).
