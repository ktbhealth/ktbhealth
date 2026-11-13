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

## Decisions (P-066 / P-067 — applied)

- **Host**: Oracle Cloud **Always-Free** Ampere A1 (`VM.Standard.A1.Flex`,
  up to 4 OCPU / 24 GB ARM — the `otel-lgtm` image is multi-arch) or any
  small Linux VM. See "OCI provisioning" below.
- **Domain**: `luisfuturist.com` (on Cloudflare) — hostnames
  `ktb-otel.luisfuturist.com` (OTLP ingest) and `ktb-grafana.luisfuturist.com`
  (UI). `<domain>` below means this. The `ktb-` prefix is required:
  Cloudflare Universal SSL only covers ONE subdomain level, so
  `otel.ktb.luisfuturist.com` fails TLS at the edge (needs Advanced
  Certificate Manager, paid). If a dedicated zone (e.g. `ktbhealth.com`)
  is added later, `otel.`/`grafana.` first-level names work as-is.
- **Tunnel**: locally-managed `cloudflared` tunnel `ktb-lgtm`, ingress
  in `cloudflared/config.yml`.
- **App endpoint**: committed in `apps/web/alchemy.run.ts` — prod stage
  defaults `OTEL_EXPORTER_OTLP_ENDPOINT=https://ktb-otel.luisfuturist.com`
  and `KTB_ENVIRONMENT=production`; explicit env vars still win.
- **Alert receiver**: ntfy webhook contact point is provisioned
  (commented) in `provisioning/alerting/alerting.yaml`; enable by
  uncommenting + DNS route when ntfy is exposed.

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
a 10s `decision_wait`. Corollary for app config: keep
`KTB_TELEMETRY_TRACES_SAMPLE_RATE=1` (the default) — head-sampling in
the Worker throws away traces _before_ the collector can apply error/
latency policies, which defeats tail sampling. Volume control belongs
at the collector, where the full trace (status, duration, attributes)
is visible. If trace volume ever demands it, move sampling to a
dedicated collector in front of this one; the policies are
self-contained and copy over.

## Layout

| path                        | what                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `compose.yaml`              | `grafana/otel-lgtm:0.40.0` service, loopback ports, `/data` volume, resource limits               |
| `.env.example`              | Grafana admin creds, retention args — copy to `.env` (gitignored)                                 |
| `otelcol-config.yaml`       | Collector config; **replaces** the image default — superset of upstream v0.40.0 + `tail_sampling` |
| `loki-config.yaml`          | Loki config; superset of image default + 7d retention (`limits_config` + `compactor`)              |
| `tempo-config.yaml`         | Tempo config; superset of image default + 7d retention (`compactor.block_retention`)               |
| `cloudflared/config.yml`    | Example ingress for a locally-managed tunnel (`otel.` + `grafana.` hostnames)                     |
| `provisioning/datasources/` | Prometheus / Loki / Tempo datasources (uids `prometheus`, `loki`, `tempo`)                        |
| `provisioning/dashboards/`  | `ktb-platform` dashboard (uid `ktb-platform`)                                                     |
| `provisioning/alerting/`    | 5 alert rules + contact point placeholder + notification policy                                   |

## OCI provisioning (Always-Free)

Oracle Cloud Always-Free includes `VM.Standard.A1.Flex` (Ampere ARM,
up to 4 OCPU / 24 GB) — far more than this stack needs. The
`otel-lgtm` image is multi-arch, so ARM works natively.

1. OCI Console → Compute → Instances → Create instance:
   - Image: **Ubuntu 24.04 aarch64** (or Oracle Linux 9 aarch64)
   - Shape: `VM.Standard.A1.Flex` — 1 OCPU / 6 GB is plenty (2/8 for
     headroom); stays inside free tier
   - Networking: default VCN; a **public IPv4 is optional** — cloudflared
     is outbound-only and compose binds loopback, so the most locked-down
     option is no public IP + OCI Cloud Shell session for management.
     If you want SSH, assign an ephemeral public IP and restrict the
     security list to your IP on :22 only.
2. SSH in (or Cloud Shell) and run the "One-time host setup" steps
   below — Docker install for ARM:
   `curl -fsSL https://get.docker.com | sh` then
   `sudo usermod -aG docker $USER` (re-login).
3. Everything else is identical — the stack doesn't know it's on OCI.

## IaC (infra/oci, P-068)

The manual console path above remains the documented default until the
adapter is proven. For repeatability there is a Pulumi adapter behind
the infra ports:

- `infra/ports` (`@ktb/infra-ports`) defines `DeployHost`/`HostSpec`.
- `infra/oci` (`@ktb/infra-oci`) implements it as an Effect wrapper
  around the `pulumi` CLI; the Pulumi program lives in
  `infra/oci/pulumi/` (`Pulumi.yaml` + `index.ts`, deps
  `@pulumi/pulumi` + `@pulumi/oci` — the Terraform-bridge provider,
  which covers the full `oracle/oci` surface): VCN, IGW, route table,
  security list (SSH-only ingress), public subnet and a compute
  instance pinned to Always-Free shapes by default
  (`VM.Standard.A1.Flex`, `VM.Standard.E2.1.Micro`; `freeTierOnly`
  enforces the 4 OCPU / 24 GB A1 ceiling). The adapter writes the
  validated spec to `ktb.spec.json` (gitignored), the program reads it
  via `KTB_HOST_SPEC_FILE`.

Usage (needs `pulumi` on PATH, `bun install` once inside
`infra/oci/pulumi`, OCI credentials via env or `~/.oci/config`, and a
passphrase secrets provider on first deploy — see
`infra/oci/src/oci.ts` docstring):

```ts
import { deployHost } from "@ktb/infra-oci";

const host = await Effect.runPromise(
	deployHost({
		name: "ktb-lgtm",
		region: "sa-saopaulo-1",
		compartmentOcid: "ocid1.compartment.oc1..…",
		tenancyOcid: "ocid1.tenancy.oc1..…", // only if availabilityDomain unset
		imageName: "Canonical-Ubuntu-24.04-aarch64-…", // or imageOcid
		sshPublicKeys: ["ssh-ed25519 AAAA…"],
		assignPublicIp: true, // optional — tunnel-only needs none
	}),
);
// host.id = instance OCID, host.publicIp = ephemeral IPv4 | undefined
```

**State backend decision**: Pulumi state lives wherever `pulumi login`
points — the default local file backend (`file://~`, checkpoints under
`~/.pulumi`) is right for a single VM. When a second host or shared
state is needed, switch to Pulumi Cloud or a DIY backend (e.g.
S3-compatible OCI Object Storage via `pulumi login s3://…`) — that
choice is deliberately left to a human, not wired into the adapter.

## One-time host setup (human steps)

1. **VM**: any small Linux box (2 vCPU / 4 GiB RAM is the floor — the
   image is ~900 MB and runs five backends). Install Docker + compose
   plugin. Open no inbound ports; everything is outbound via tunnel.
2. **Checkout**: clone this repo (or copy `infra/lgtm/`) onto the VM.
3. **Env**: `cp .env.example .env`. The Grafana admin password is in
   the cuora vault (`cuora://ktb/grafana-admin-password`, prod+dev) —
   either fill `.env` manually or inject at runtime:
   `cuora run --env prod --config cuora.toml -- docker compose up -d`
   (requires the cuora CLI + `CUORA_CF_TOKEN` on the host; see
   `cuora.toml` here). `GF_SECURITY_ADMIN_USER` stays `admin`.
4. **Start**: `docker compose --env-file .env up -d` — first boot pulls
   ~900 MB and takes a couple of minutes; `docker compose ps` should
   show `healthy` once `/tmp/ready` exists.
5. **Tunnel** (pick one):
   - _Locally-managed (ingress in git)_: install `cloudflared` on the
     host, then `cloudflared tunnel login` (writes `cert.pem` — browser
     auth, human step), `cloudflared tunnel create ktb-lgtm`,
     `cloudflared tunnel route dns ktb-lgtm otel.<domain>` and
     `... grafana.<domain>`. Copy `cloudflared/config.yml`, replace
     `TUNNEL_UUID` / hostname / credentials path, then
     `cloudflared tunnel run ktb-lgtm` (or install as a service:
     `cloudflared service install`).
   - _Remotely-managed (token)_: create the tunnel in the CF dashboard,
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
   # KTB_TELEMETRY_TRACES_SAMPLE_RATE=1   # keep at 1.0 — see sampling note
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

| symptom                                 | likely cause                                                  | fix                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard empty, `absent()` alert fires | tunnel down or wrong endpoint                                 | `cloudflared tunnel info ktb-lgtm`; verify `OTEL_EXPORTER_OTLP_ENDPOINT` has no path and is `https://`                           |
| App logs warn about insecure endpoint   | `http://` non-loopback OTLP endpoint is dropped by the driver | use `https://otel.<domain>`                                                                                                      |
| `stage="export"` errors climbing        | collector unreachable / 4xx from otelcol                      | check `docker logs`, otelcol receiver logs, Access policy on `otel.` hostname                                                    |
| Disk full on VM                         | `/data` volume growth                                         | `docker system df`; retention is 7d across Loki/Tempo/Prometheus — see loki-config.yaml, tempo-config.yaml and PROMETHEUS_EXTRA_ARGS; `docker compose down` + prune old blocks |
| Traces missing but metrics/logs fine    | tail_sampling is working as designed                          | errors + >2s traces + 15% sample are kept; check Tempo for `{ status = error }`                                                  |
| Grafana login fails after recreate      | admin password only set at first boot                         | password lives in Grafana's sqlite under `/data`; reset via `GF_SECURITY_ADMIN_PASSWORD` env or `grafana cli`                    |

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
