# @ktb/observability

Provider-agnostic telemetry port for the KTB platform: structured logs,
traces, metrics, request correlation and browser-event ingest. Signal
exporters live in sibling adapters (`@ktb/observability-otlp`); this
package defines the contracts, local defaults and shared primitives.

## Architecture

```
app edge (apps/web)
  start.ts            request middleware — request id, access log, RED metrics
  lib/telemetry.ts    request-scoped context (x-request-id, traceparent)
  lib/platform.ts     run/runAs seed TelemetryContext per invocation
        │
        ▼
@ktb/app-host         driver selection (OTLP wins, console fallback),
                     instrumentation, flushTelemetry()
        │
        ▼
Telemetry (service)   ingest / scrape / flush / health — the port
        │
   ┌────┴─────────────┐
   ▼                  ▼
telemetryConsole   otlpTelemetryDriver (@ktb/observability-otlp)
Driver (always)    Driver (when OTLP endpoints configured)
JSON logs +        OTLP/HTTP logs, traces, metrics
Prometheus scrape  (Effect effect/observability exporters)
```

- **Context**: `TelemetryContext` (Effect `Context.Reference`) carries
  `requestId`, `traceparent`, `route`, `userId`, `tenantId` — merged
  ambient + per-invocation seed in `app-host`, annotated onto every log.
- **Redaction**: `consoleJsonLogger` strips credentials, tokens, cookies,
  sessions, CPF/SSN, payment data, PINs/OTPs by key before output.
- **Metrics**: bounded-cardinality `effect/Metric` instruments in
  `metrics.ts` (app invocations, CQRS dispatches, HTTP RED, client
  events). Exposed via Prometheus text (`Telemetry.scrape()`) or OTLP.
- **Client**: `@ktb/observability/client` subpath — browser fetch
  instrumentation (traceparent injection), error capture, router
  navigation timing, batched ingest to `POST /api/telemetry`.

## Configuration (env → `ObservabilityEnv`)

| Variable                                            | Meaning                                                      |
| --------------------------------------------------- | ------------------------------------------------------------ |
| `OTEL_SDK_DISABLED`                                 | `"1"`/`"true"` disables OTLP exporters (console logs remain) |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                       | Base OTLP/HTTP endpoint (enables OTLP driver)                |
| `OTEL_EXPORTER_OTLP_{LOGS,TRACES,METRICS}_ENDPOINT` | Per-signal overrides                                         |
| `OTEL_EXPORTER_OTLP_HEADERS`                        | `k=v,k2=v2` auth headers (secret)                            |
| `OTEL_EXPORTER_OTLP_COMPRESSION`                    | `"gzip"` enables gzip request compression                    |
| `OTEL_RESOURCE_ATTRIBUTES`                          | `k=v,k2=v2` extra resource attributes                        |
| `OTEL_SERVICE_NAME`                                 | Resource service name (default `ktb`)                        |
| `KTB_ENVIRONMENT`                                   | `deployment.environment` resource attr                       |
| `KTB_TELEMETRY_TRACES_SAMPLE_RATE`                  | Trace sample ratio 0..1 (default 1)                          |
| `KTB_TELEMETRY_CLIENT`                              | `"0"`/`"false"` disables client-event ingest                 |
| `KTB_TELEMETRY_CLIENT_SAMPLE_RATE`                  | Client-event sample ratio 0..1                               |
| `KTB_TELEMETRY_EXPORT_INTERVAL_MS`                  | OTLP export interval (default 10000, 100–300000)             |
| `KTB_TELEMETRY_MAX_BATCH_SIZE`                      | OTLP max batch size (default 512, 1–4096)                    |
| `KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS`                 | OTLP shutdown flush timeout (default 3000, 100–60000)        |
| `KTB_LOG_LEVEL`                                     | Minimum Effect log level                                     |
| `METRICS_SCRAPE_TOKEN`                              | Bearer token for `GET /api/metrics`                          |

## Operational endpoints (apps/web)

- `GET /api/health` — liveness.
- `GET /api/ready` — readiness (DB probe + telemetry health).
- `GET /api/metrics` — Prometheus exposition (admin session or
  `METRICS_SCRAPE_TOKEN`).
- `POST /api/telemetry` — browser event ingest (schema-validated).

Local DX: no config needed — JSON logs on stdout, metrics at
`/api/metrics`, traces via `traceparent` headers end-to-end. Set
`OTEL_EXPORTER_OTLP_ENDPOINT` to push to any OTLP collector.
