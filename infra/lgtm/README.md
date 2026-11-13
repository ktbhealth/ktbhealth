# infra/lgtm — self-hosted LGTM observability backend

Self-hosted LGTM (Loki + Grafana + Tempo + Mimir/Prometheus) for the KTB
platform, per myco proposal **P-066** and tasks **T-101** (dashboards,
alerts, runbook) / **T-107** (otelcol tail sampling).

The KTB app (`apps/web`, TanStack Start on Cloudflare Workers) pushes
telemetry over OTLP/HTTP+JSON — logs, traces and metrics — and also
exposes a Prometheus scrape endpoint at `/api/metrics`. This stack is the
collector + storage + UI that receives it.

> **Status: infrastructure-as-code only.** Nothing here is deployed.
> Provisioning the VM, tunnel and DNS is a human step (see below).

## Architecture

```
                         Cloudflare zone
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │   apps/web (Workers)            cloudflared (host or svc)    │
 │   OTEL_EXPORTER_OTLP_ENDPOINT ──► otel.<domain> ──────────────┼──┐
 │   = https://otel.<domain>       grafana.<domain> ─────────────┼──┤
 │                                                              │  │
 └──────────────────────────────────────────────────────────────┘  │
                                                                    ▼
 ┌────────────────────────────────────────────────────────────────────┐
 │  VM (docker compose, infra/lgtm/compose.yaml)                       │
 │                                                                    │
 │   ┌──────────────────── grafana/otel-lgtm:0.40.0 ─────────────────┐ │
 │   │                                                              │ │
 │   │  OTLP receiver :4318 ──► otelcol ──┬─► Prometheus  (:9090)   │ │
 │   │  (OTLP/HTTP only; app sends       ├─► Loki         (:3100)   │ │
 │   │   protobuf-framed JSON per        ├─► Tempo        (:3200)   │ │
 │   │   OTLP/HTTP spec)                 ├─► Pyroscope    (:4040)   │ │
 │   │                                   └─► Grafana UI   (:3000)   │ │
 │   │                                                              │ │
 │   │  otelcol pipeline:                                           │ │
 │   │    traces:  otlp → tail_sampling → batch → tempo             │ │
 │   │    metrics: otlp → batch → prometheus                        │ │
 │   │    logs:    otlp → batch → loki                              │ │
 │   └──────────────────────────────────────────────────────────────┘ │
 │                                                                    │
 │  volume: lgtm-data → /data (prometheus tsdb, loki chunks,          │
 │  tempo blocks, grafana sqlite)                                     │
 └────────────────────────────────────────────────────────────────────┘
```

**Why the all-in-one image.** `grafana/otel-lgtm` bundles collector +
all four backends in one container with sane defaults and a single
`/data` volume. For a single-product, low-to-moderate traffic backend
this is the right size; a split stack (separate otelcol, Mimir, Loki,
Tempo, Grafana) is future work if retention/HA requirements grow — the
provisioning and otelcol config here port over unchanged.

**Why tail_sampling lives in this collector (T-107).** The app generates
RED metrics app-side (`effect/Metric` → OTLP metrics), not from traces,
so sampling traces cannot skew metrics. The `tail_sampling` processor
(`otelcol-config.yaml`) keeps every error trace, every trace slower than
2s, and a 15% probabilistic sample of the rest — applied per-trace after
a 10s `decision_wait`. If trace volume ever demands it, move sampling to
a dedicated collector in front of this one; the policies are
self-contained and copy over.

## Layout

| path | what |
| --- | --- |
| `compose.yaml` | `grafana/otel-lgtm:0.40.0` service, loopback ports, `/data` volume, resource limits |
| `.env.example` | Grafana admin creds, retention args — copy to `.env` (gitignored) |
| `otelcol-config.yaml` | Collector config; **replaces** the image default — superset of upstream v0.40.0 + `tail_sampling` |
| `cloudflared/config.yml` | Example ingress for a locally-managed tunnel (`otel.` + `grafana.` hostnames) |
| `provisioning/datasources/` | Prometheus / Loki / Tempo datasources (uids `prometheus`, `loki`, `tempo`) |
| `provisioning/dashboards/` | `ktb-platform` dashboard (uid `ktb-platform`) |
| `provisioning/alerting/` | 5 alert rules + contact point placeholder + notification policy |

## One-time host setup (human steps)

1. **VM**: any small Linux box (2 vCPU / 4 GiB RAM is the floor — the
   image is ~900 MB and runs five backends). Install Docker + compose
   plugin. Open no inbound ports; everything is outbound via tunnel.
2. **Checkout**: clone this repo (or copy `infra/lgtm/`) onto the VM.
3. **Env**: `cp .env.example .env` and set `GF_SECURITY_ADMIN_PASSWORD`
   to a long random value.
4. **Start**: `docker compose --env-file .env up -d` — first boot pulls
   ~900 MB and takes a couple of minutes; `docker compose ps` should
   show `healthy` once `/tmp/ready` exists.
5. **Tunnel** (pick one):
   - *Locally-managed (ingress in git)*: install `cloudflared` on the
     host, then `cloudflared tunnel login` (writes `cert.pem` — browser
     auth, human step), `cloudflared tunnel create ktb-lgtm`,
     `cloudflared tunnel route dns ktb-lgtm otel.<domain>` and
     `... grafana.<domain>`. Copy `cloudflared/config.yml`, replace
     `TUNNEL_UUID` / hostname / credentials path, then
     `cloudflared tunnel run ktb-lgtm` (or install as a service:
     `cloudflared service install`).
   - *Remotely-managed (token)*: create the tunnel in the CF dashboard,
     copy its token to `.env` as `CLOUDFLARED_TUNNEL_TOKEN` and
     uncomment the `cloudflared` service in `compose.yaml`. Ingress
     rules then live in the dashboard/API, not git.
6. **DNS**: the `tunnel route dns` commands above create the CNAMEs.
7. **Cloudflare Access** (recommended): put an Access application in
   front of `grafana.<domain>` (e.g. email OTP / SSO). Grafana's own
   admin login stays as the second factor. The `otel.` hostname can stay
   public — OTLP payloads are telemetry, not secrets — but you can
   optionally gate it too; the app supports `OTEL_EXPORTER_OTLP_HEADERS`
   for a bearer token if you do.
8. **Point the app at it** (Cloudflare Worker env / `wrangler`/Alchemy
   secrets):
   ```
   OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.<domain>
   OTEL_SERVICE_NAME=ktb
   KTB_ENVIRONMENT=production        # becomes deployment.environment
   OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production
   # optional:
   # OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer <token>
   ```
   `packages/observability/src/config.ts` appends `/v1/<signal>` per
   signal, so the base URL must have **no path**. Insecure `http://`
   endpoints are dropped by the OTLP driver unless the host is
   loopback — always use `https://` here.
9. **Alerts**: edit `provisioning/alerting/alerting.yaml` — set a real
   `oncall@example.com` (requires `GF_SMTP_*` env) or swap the contact
   point for a webhook. Grafana picks it up within `updateIntervalSeconds`.

## Operations / runbook

### Is telemetry flowing?

- `curl https://<app>/api/ready` — app is up (separate from telemetry).
- `docker compose ps` — `ktb-lgtm` should be `healthy` (`/tmp/ready`).
- `docker compose logs lgtm | grep otelcol` — look for export errors to
  `127.0.0.1:9090/3100/4418`.
- `curl -s http://localhost:9090/api/v1/query?query=ktb_http_requests_total`
  on the VM (SSH tunnel if needed) — empty result = nothing arriving.
- Grafana → Explore → Prometheus: `sum(rate(ktb_http_requests_total[5m]))`.
  Loki: `{service_name="ktb"}`. Tempo: `{ resource.service.name = "ktb" }`.

### Common failures

| symptom | likely cause | fix |
| --- | --- | --- |
| Dashboard empty, `absent()` alert fires | tunnel down or wrong endpoint | `cloudflared tunnel info ktb-lgtm`; verify `OTEL_EXPORTER_OTLP_ENDPOINT` has no path and is `https://` |
| App logs warn about insecure endpoint | `http://` non-loopback OTLP endpoint is dropped by the driver | use `https://otel.<domain>` |
| `stage="export"` errors climbing | collector unreachable / 4xx from otelcol | check `docker logs`, otelcol receiver logs, Access policy on `otel.` hostname |
| Disk full on VM | `/data` volume growth | `docker system df`; tune `PROMETHEUS_EXTRA_ARGS`/`LOKI_EXTRA_ARGS` retention in `.env`; `docker compose down` + prune old blocks |
| Traces missing but metrics/logs fine | tail_sampling is working as designed | errors + >2s traces + 15% sample are kept; check Tempo for `{ status = error }` |
| Grafana login fails after recreate | admin password only set at first boot | password lives in Grafana's sqlite under `/data`; reset via `GF_SECURITY_ADMIN_PASSWORD` env or `grafana cli` |

### Backup

Everything durable is in the `lgtm-data` named volume: Prometheus TSDB,
Loki chunks, Tempo blocks, Grafana dashboards/users (sqlite). For real
backups, stop the stack and tar the volume
(`docker run --rm -v ktb-lgtm_lgtm-data:/data -v $PWD:/backup alpine tar czf /backup/lgtm-data.tgz /data`),
or accept the loss — telemetry is reproducible, config is in git.

### Upgrades

1. Bump `image:` tag in `compose.yaml` (check
   [docker-otel-lgtm releases](https://github.com/grafana/docker-otel-lgtm/releases)).
2. **Diff `otelcol-config.yaml` against the new upstream
   `docker/otelcol-config.yaml`** — our file replaces the default, so
   upstream receiver/exporter changes must be merged manually, then
   re-apply the `tail_sampling` block.
3. `docker compose up -d`, verify `/tmp/ready` + dashboards load.

## Cost estimate

A single small VM (e.g. Hetzner CX22 / equivalent, ~€4–5/mo, or a
free-tier Oracle/AWS micro instance) covers this comfortably at KTB
traffic levels. Cloudflare Tunnel + Access are free at this scale.
Bandwidth is negligible (telemetry payloads are small JSON batches).

## Future work

- Split LGTM stack (dedicated otelcol → Mimir/Loki/Tempo/Grafana) when
  retention, HA or multi-tenant needs grow.
- OTLP/gRPC receiver (`:4317`) if a future exporter needs it.
- SLO burn-rate alerts once traffic baselines exist (T-101 follow-up).
- Remote-write the Prometheus `/api/metrics` scrape into this same
  Prometheus if pull-based scraping is preferred over OTLP push for
  metrics.
