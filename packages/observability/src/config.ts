/**
 * Observability configuration — resolved once at the composition root from
 * platform bindings and handed to the telemetry drivers. Ports never read
 * env themselves; `telemetryConfigFromEnv` is the single parser, kept pure
 * so every runtime (workerd, bun, node, tests) shares one code path.
 *
 * Env vars follow the OpenTelemetry SDK convention (`OTEL_*`) so a deploy
 * can point at any OTLP collector (Grafana LGTM, Jaeger, Honeycomb,
 * vendor endpoints) without code changes — cloud-agnostic by contract.
 */

/** Env slice the observability drivers inspect (a subset of AppEnv). */
export interface ObservabilityEnv {
	readonly OTEL_SDK_DISABLED?: string;
	readonly OTEL_SERVICE_NAME?: string;
	readonly OTEL_RESOURCE_ATTRIBUTES?: string;
	readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string;
	readonly OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?: string;
	readonly OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
	readonly OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?: string;
	readonly OTEL_EXPORTER_OTLP_HEADERS?: string;
	readonly OTEL_EXPORTER_OTLP_COMPRESSION?: string;
	readonly KTB_ENVIRONMENT?: string;
	readonly KTB_TELEMETRY_TRACES_SAMPLE_RATE?: string;
	readonly KTB_TELEMETRY_EXPORT_INTERVAL_MS?: string;
	readonly KTB_TELEMETRY_MAX_BATCH_SIZE?: string;
	readonly KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS?: string;
	readonly KTB_TELEMETRY_CLIENT?: string;
	readonly KTB_TELEMETRY_CLIENT_SAMPLE_RATE?: string;
	/** Minimum log level — "Debug"|"Info"|"Warning"|"Error"|"Trace"|"All"|"None".
	 * Unset keeps Effect's default (Info). */
	readonly KTB_LOG_LEVEL?: string;
}

export interface OtlpSignalEndpoints {
	readonly logs?: string;
	readonly traces?: string;
	readonly metrics?: string;
}

export interface TelemetryConfig {
	/** OTEL_SDK_DISABLED — kills every exporter; logs still go to console. */
	readonly disabled: boolean;
	readonly serviceName: string;
	readonly serviceVersion?: string;
	/** deployment.environment.resource attribute or KTB_ENVIRONMENT. */
	readonly environment: string;
	/** Parsed OTEL_RESOURCE_ATTRIBUTES (service.name/version excluded —
	 * they have dedicated fields). */
	readonly resourceAttributes: Record<string, string>;
	readonly otlp: {
		/** Resolved per-signal export URLs (base endpoint already expanded
		 * to `/v1/<signal>` when only the base was configured). Undefined
		 * means that signal is not exported over OTLP. */
		readonly endpoints: OtlpSignalEndpoints;
		readonly headers?: Record<string, string>;
		readonly compression: "gzip" | "none";
		readonly exportIntervalMs: number;
		readonly maxBatchSize: number;
		readonly shutdownTimeoutMs: number;
	};
	/** Head-sampling ratio for spans (0–1). 1 = export everything;
	 * parent-sampled spans are always kept (parent-based precedence). */
	readonly tracesSampleRate: number;
	/** Client (browser) telemetry ingest toggle + sample rate — enforced
	 * server-side at /api/telemetry so a misconfigured client can't flood. */
	readonly clientTelemetry: {
		readonly enabled: boolean;
		readonly sampleRate: number;
	};
	/** KTB_LOG_LEVEL — minimum severity for emitted logs. */
	readonly logLevel?: string;
	/** Non-fatal resolution problems (e.g. an insecure remote `http://`
	 * OTLP endpoint that was dropped). Drivers surface these via
	 * `Effect.logWarning` at layer build; values never contain header
	 * secrets or full URLs. Optional for backward compatibility with
	 * hand-built configs. */
	readonly warnings?: ReadonlyArray<string>;
}

const truthy = (value: string | undefined): boolean =>
	value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());

const falsy = (value: string | undefined): boolean =>
	value !== undefined && /^(0|false|no|off)$/i.test(value.trim());

/** Parse `key=value,key2=value2` — OTEL_RESOURCE_ATTRIBUTES and
 * OTEL_EXPORTER_OTLP_HEADERS share this shape; values are
 * percent-decoded per the OTLP spec (malformed pairs are skipped). */
export const parseKeyValueList = (raw: string | undefined): Record<string, string> => {
	const out: Record<string, string> = {};
	if (raw === undefined) return out;
	for (const pair of raw.split(",")) {
		const eq = pair.indexOf("=");
		if (eq <= 0) continue;
		const key = pair.slice(0, eq).trim();
		if (key === "") continue;
		const rawValue = pair.slice(eq + 1).trim();
		let value = rawValue;
		try {
			value = decodeURIComponent(rawValue);
		} catch {
			// Keep the raw value when it isn't valid percent-encoding.
		}
		out[key] = value;
	}
	return out;
};

const parseFloatClamped = (
	raw: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number => {
	if (raw === undefined) return fallback;
	const parsed = Number.parseFloat(raw);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
};

const parseIntClamped = (
	raw: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number => {
	if (raw === undefined) return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isNaN(parsed)) return Math.min(max, Math.max(min, parsed));
	return fallback;
};

/** Resolve the OTLP export URL for one signal: the per-signal endpoint
 * wins verbatim; otherwise the base endpoint gets the signal's
 * `/v1/<signal>` path appended (OTLP/HTTP convention). */
const signalEndpoint = (
	signal: "logs" | "traces" | "metrics",
	perSignal: string | undefined,
	base: string | undefined,
): string | undefined => {
	if (perSignal !== undefined && perSignal.trim() !== "") return perSignal.trim();
	if (base === undefined || base.trim() === "") return undefined;
	const trimmed = base.trim().replace(/\/+$/, "");
	return `${trimmed}/v1/${signal}`;
};

/** Env var that won resolution for each signal — named in warnings so
 * the operator fixes the right knob. */
const SIGNAL_ENDPOINT_VARS = {
	logs: "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
	traces: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
	metrics: "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
} as const satisfies Record<keyof OtlpSignalEndpoints, keyof ObservabilityEnv>;

/**
 * True when an OTLP hostname is local/dev-only, where plain HTTP is
 * acceptable (otelcol, jaeger, docker-compose collectors). Covers
 * localhost names, loopback, unspecified and RFC1918/link-local IPv4 —
 * private ranges stay allowed because compose networks hand out
 * 172.x/192.168.x addresses that never leave the LAN. IPv6 is limited
 * to ::/::1; unique-local (fc00::/7) is intentionally not matched.
 */
const isLocalHostname = (hostname: string): boolean => {
	const host = hostname
		.toLowerCase()
		.replace(/\.$/, "")
		.replace(/^\[|\]$/g, "");
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host === "0.0.0.0" ||
		host === "::" ||
		host === "::1"
	) {
		return true;
	}
	const parts = host.split(".");
	if (parts.length !== 4) return false;
	const octets = parts.map((part) => Number(part));
	if (!octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return false;
	const [a, b] = octets;
	return (
		a === 10 ||
		a === 127 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254)
	);
};

/**
 * Transport guard for OTLP endpoints: telemetry can carry sensitive
 * operational data, so plain HTTP is only allowed to local collectors.
 * Returns the offending `host[:port]` when `raw` is a parseable
 * `http://` URL with a non-local host; undefined otherwise — https,
 * non-http schemes and unparseable URLs pass through unchanged
 * (exporters surface those errors as before).
 */
const insecureRemoteHost = (raw: string): string | undefined => {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:") return undefined;
	return isLocalHostname(url.hostname) ? undefined : url.host;
};

/**
 * Drop insecure remote `http://` endpoints, recording one warning per
 * affected signal. An insecure per-signal override rejects that signal
 * outright — it does NOT fall back to the base endpoint, since the
 * operator explicitly aimed that signal elsewhere. Warnings carry only
 * scheme + host (never the full URL, which could embed userinfo
 * credentials, and never OTEL_EXPORTER_OTLP_HEADERS values).
 */
const guardOtlpEndpoints = (
	endpoints: OtlpSignalEndpoints,
	env: ObservabilityEnv,
	warnings: string[],
): OtlpSignalEndpoints => {
	const guard = (signal: keyof OtlpSignalEndpoints): string | undefined => {
		const url = endpoints[signal];
		if (url === undefined) return undefined;
		const host = insecureRemoteHost(url);
		if (host === undefined) return url;
		const perSignalVar = SIGNAL_ENDPOINT_VARS[signal];
		const source =
			(env[perSignalVar]?.trim() ?? "") === "" ? "OTEL_EXPORTER_OTLP_ENDPOINT" : perSignalVar;
		warnings.push(
			`${source} resolved an insecure http:// endpoint for signal "${signal}" ` +
				`(host "${host}") — endpoint ignored to avoid leaking telemetry in cleartext; ` +
				`use https:// or a local collector`,
		);
		return undefined;
	};
	return { logs: guard("logs"), traces: guard("traces"), metrics: guard("metrics") };
};

/**
 * Resolve telemetry configuration from platform bindings. Pure — no env
 * reads, no I/O — so tests and every runtime share the exact semantics.
 * Defaults are DX-first: no OTLP endpoint → console JSON logs only,
 * everything else off until configured.
 */
export const telemetryConfigFromEnv = (env: ObservabilityEnv): TelemetryConfig => {
	const disabled = truthy(env.OTEL_SDK_DISABLED);
	const resourceAttributes = parseKeyValueList(env.OTEL_RESOURCE_ATTRIBUTES);
	const serviceName = env.OTEL_SERVICE_NAME?.trim() || resourceAttributes["service.name"] || "ktb";
	const serviceVersion = resourceAttributes["service.version"];
	const environment =
		env.KTB_ENVIRONMENT?.trim() || resourceAttributes["deployment.environment"] || "development";
	const headersRaw = parseKeyValueList(env.OTEL_EXPORTER_OTLP_HEADERS);
	const resolvedEndpoints: OtlpSignalEndpoints = {
		logs: signalEndpoint(
			"logs",
			env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
			env.OTEL_EXPORTER_OTLP_ENDPOINT,
		),
		traces: signalEndpoint(
			"traces",
			env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
			env.OTEL_EXPORTER_OTLP_ENDPOINT,
		),
		metrics: signalEndpoint(
			"metrics",
			env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
			env.OTEL_EXPORTER_OTLP_ENDPOINT,
		),
	};
	// TLS enforcement: remote http:// endpoints are dropped with a
	// warning. Skipped entirely when the SDK is disabled — nothing
	// exports, so the resolved config stays verbatim.
	const warnings: string[] = [];
	const endpoints = disabled
		? resolvedEndpoints
		: guardOtlpEndpoints(resolvedEndpoints, env, warnings);
	const compression =
		env.OTEL_EXPORTER_OTLP_COMPRESSION?.trim().toLowerCase() === "gzip" ? "gzip" : "none";
	return {
		disabled,
		serviceName,
		serviceVersion,
		environment,
		resourceAttributes,
		otlp: {
			endpoints,
			headers: Object.keys(headersRaw).length > 0 ? headersRaw : undefined,
			compression,
			exportIntervalMs: parseIntClamped(env.KTB_TELEMETRY_EXPORT_INTERVAL_MS, 10_000, 100, 300_000),
			maxBatchSize: parseIntClamped(env.KTB_TELEMETRY_MAX_BATCH_SIZE, 512, 1, 4096),
			shutdownTimeoutMs: parseIntClamped(env.KTB_TELEMETRY_SHUTDOWN_TIMEOUT_MS, 3_000, 100, 60_000),
		},
		tracesSampleRate: parseFloatClamped(env.KTB_TELEMETRY_TRACES_SAMPLE_RATE, 1, 0, 1),
		clientTelemetry: {
			enabled: !falsy(env.KTB_TELEMETRY_CLIENT),
			sampleRate: parseFloatClamped(env.KTB_TELEMETRY_CLIENT_SAMPLE_RATE, 1, 0, 1),
		},
		logLevel: parseLogLevel(env.KTB_LOG_LEVEL),
		warnings,
	};
};

const LOG_LEVELS = new Set(["All", "Trace", "Debug", "Info", "Warning", "Error", "Fatal", "None"]);

/** KTB_LOG_LEVEL → effect LogLevel, or undefined when unset/invalid. */
export const parseLogLevel = (raw: string | undefined): string | undefined => {
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	const lower = trimmed.toLowerCase();
	const aliases: Record<string, string> = { warn: "Warning", err: "Error", dbg: "Debug" };
	const canonical = aliases[lower] ?? lower.charAt(0).toUpperCase() + lower.slice(1);
	return LOG_LEVELS.has(canonical) ? canonical : undefined;
};
