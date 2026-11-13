import type { ClientEventType, ClientTelemetryEvent } from "./ingest.ts";

/**
 * Browser-side telemetry client — dependency-light, isomorphic-safe.
 *
 * Why this is hand-rolled instead of an OTel JS SDK: the browser bundle
 * budget is tight, the wire contract (`ClientTelemetryBatch`) is a plain
 * JSON POST, and every browser API used here (`fetch`, `sendBeacon`,
 * `addEventListener`) is already universal. The module guards every
 * browser touchpoint behind `typeof window`/`typeof document` so SSR
 * (TanStack Start server render, node tests) gets a no-op instance.
 *
 * Arch-lint note: this file must stay free of `node:*`/`cloudflare:*`
 * imports and of runtime imports from `./ingest.ts` — `ingest.ts` pulls
 * in `effect/Schema`, which would drag the whole Effect runtime into the
 * client bundle. Only `import type` is used here.
 */

export interface ClientTelemetryOptions {
	/** Ingest endpoint — relative path or absolute URL. Default "/api/telemetry". */
	readonly endpoint?: string;
	/** Head-sampling ratio clamped to 0..1. Default 1 (keep everything). */
	readonly sampleRate?: number;
	/** Flush early once the queue reaches this size. Default 20. */
	readonly maxBatchSize?: number;
	/** Periodic flush cadence. Default 5000ms. */
	readonly flushIntervalMs?: number;
	/** Attached to every event as the `service.name` attribute. */
	readonly serviceName?: string;
}

export interface ClientTelemetry {
	/** Enqueue a manually-reported event (custom domain events, etc.).
	 * Invalid shapes are dropped silently — telemetry never throws. */
	readonly report: (event: ClientTelemetryEvent) => void;
	/** Flush pending events and detach all listeners/patches. */
	readonly dispose: () => void;
}

/** Minimal structural view of a TanStack Router instance — the package
 * cannot depend on `@tanstack/react-router` (apps own that dep), so we
 * duck-type `subscribe`/`state.location`. */
export interface InstrumentableRouter {
	readonly subscribe?: (
		eventType: string,
		fn: (event: { readonly type?: string }) => void,
	) => (() => void) | void;
	readonly state?: {
		readonly location?: { readonly pathname?: string };
	};
}

const GLOBAL_KEY = Symbol.for("ktb.observability.clientTelemetry");
const FETCH_PATCHED_KEY = Symbol.for("ktb.observability.fetchPatched");
const FETCH_ORIGINAL_KEY = Symbol.for("ktb.observability.fetchOriginal");

const REPORTABLE_TYPES: ReadonlySet<ClientEventType> = new Set([
	"event",
	"error",
	"navigation",
	"request",
]);

const MAX_QUEUE_LENGTH = 200;
const MAX_NAME_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4_000;
const MAX_PATH_LENGTH = 300;

const truncate = (value: string, max: number): string =>
	value.length > max ? value.slice(0, max) : value;

/** Strip query/hash — the wire schema only accepts path-like `path`s. */
const cleanPath = (path: string | undefined): string | undefined => {
	if (path === undefined) return undefined;
	const stripped = path.split("?")[0]?.split("#")[0];
	if (stripped === undefined || stripped === "") return undefined;
	return truncate(stripped, MAX_PATH_LENGTH);
};

const isBrowser = (): boolean => typeof window !== "undefined" && typeof document !== "undefined";

type GlobalCarrier = Record<symbol, unknown>;
const globalStore = (): GlobalCarrier => globalThis as GlobalCarrier;

const noopTelemetry: ClientTelemetry = {
	report: () => {},
	dispose: () => {},
};

const randomHex = (bytes: number): string => {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj !== undefined && typeof cryptoObj.getRandomValues === "function") {
		const buf = new Uint8Array(bytes);
		cryptoObj.getRandomValues(buf);
		return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
	}
	// Fallback for exotic runtimes — telemetry ids don't need CSPRNG quality.
	let out = "";
	for (let i = 0; i < bytes * 2; i++) {
		out += Math.floor(Math.random() * 16).toString(16);
	}
	return out;
};

const randomUUID = (): string => {
	const cryptoObj = globalThis.crypto;
	if (cryptoObj !== undefined && typeof cryptoObj.randomUUID === "function") {
		try {
			return cryptoObj.randomUUID();
		} catch {
			// Fall through to the manual generator.
		}
	}
	return `${randomHex(4)}-${randomHex(2)}-${randomHex(2)}-${randomHex(2)}-${randomHex(6)}`;
};

/** W3C traceparent — `00-<32 hex trace id>-<16 hex span id>-01`. */
const newTraceparent = (): string => `00-${randomHex(16)}-${randomHex(8)}-01`;

const pathnameOf = (url: string, base?: string): string | undefined => {
	try {
		return new URL(url, base).pathname;
	} catch {
		// Relative URL without a usable base — best-effort strip of query.
		const noQuery = url.split("?")[0]?.split("#")[0];
		return noQuery === "" ? undefined : noQuery;
	}
};

/** `Request`-like inputs (real `Request` or cross-realm/test doubles)
 * carry `url`/`method`/`headers`; plain strings/`URL`s do not. */
const isRequestLike = (
	input: unknown,
): input is { url: string; method?: string; headers?: HeadersInit } =>
	typeof input === "object" &&
	input !== null &&
	"url" in input &&
	typeof (input as { url: unknown }).url === "string";

/** Merge caller-supplied headers with the telemetry headers we inject.
 * `new Headers(init)` accepts every `HeadersInit` shape (Headers,
 * string[][], record) and normalizes casing, so existing headers are
 * preserved while `traceparent`/`x-request-id` are set authoritatively. */
const mergeHeaders = (
	existing: HeadersInit | undefined,
	extra: Record<string, string>,
): Headers => {
	const headers = new Headers(existing);
	for (const [key, value] of Object.entries(extra)) {
		headers.set(key, value);
	}
	return headers;
};

const safeStringify = (value: unknown): string => {
	if (value instanceof Error) return value.message || "Error";
	try {
		if (typeof value === "string") return value;
		const json = JSON.stringify(value);
		if (json !== undefined) return json;
	} catch {
		// Fall through to String().
	}
	try {
		return String(value);
	} catch {
		return "Unknown error";
	}
};

/**
 * Initialize the browser telemetry client. SSR-safe: returns a shared
 * no-op when `window`/`document` are absent, and idempotent — a second
 * call returns the existing instance (stored on `globalThis` so it
 * survives HMR double-mounts).
 */
export const initClientTelemetry = (options: ClientTelemetryOptions = {}): ClientTelemetry => {
	if (!isBrowser()) return noopTelemetry;
	const store = globalStore();
	const existing = store[GLOBAL_KEY];
	if (existing !== undefined) return existing as ClientTelemetry;

	const endpoint = options.endpoint ?? "/api/telemetry";
	const sampleRate =
		typeof options.sampleRate === "number" && Number.isFinite(options.sampleRate)
			? Math.min(1, Math.max(0, options.sampleRate))
			: 1;
	const maxBatchSize =
		typeof options.maxBatchSize === "number" && options.maxBatchSize > 0
			? Math.floor(options.maxBatchSize)
			: 20;
	const flushIntervalMs =
		typeof options.flushIntervalMs === "number" && options.flushIntervalMs > 0
			? options.flushIntervalMs
			: 5_000;
	const serviceName = options.serviceName;
	const endpointPath = pathnameOf(endpoint, window.location?.origin) ?? endpoint;

	const queue: ClientTelemetryEvent[] = [];
	const cleanups: Array<() => void> = [];
	let disposed = false;

	const sampled = (): boolean => sampleRate >= 1 || Math.random() < sampleRate;

	const flush = (): void => {
		if (queue.length === 0) return;
		// splice, not slice — events arriving mid-send stay queued for the
		// next flush instead of being duplicated.
		const events = queue.splice(0, queue.length);
		const body = JSON.stringify({ events });
		try {
			const nav = window.navigator;
			if (
				nav !== undefined &&
				typeof nav.sendBeacon === "function" &&
				nav.sendBeacon(endpoint, body)
			) {
				return;
			}
		} catch {
			// sendBeacon threw — fall back to fetch below.
		}
		// fetch fallback: keepalive lets the request outlive pagehide.
		// Errors are swallowed on purpose — telemetry must never surface
		// as an app error.
		try {
			const send = window.fetch;
			if (typeof send === "function") {
				void Promise.resolve(
					send.call(window, endpoint, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body,
						keepalive: true,
					}),
				).catch(() => {});
			}
		} catch {
			// Best-effort delivery only.
		}
	};

	const enqueue = (event: ClientTelemetryEvent): void => {
		if (disposed || !sampled()) return;
		const attributes =
			serviceName === undefined
				? event.attributes
				: { "service.name": serviceName, ...event.attributes };
		queue.push({
			...event,
			name: truncate(event.name, MAX_NAME_LENGTH),
			message:
				event.message === undefined ? undefined : truncate(event.message, MAX_MESSAGE_LENGTH),
			stack: event.stack === undefined ? undefined : truncate(event.stack, MAX_STACK_LENGTH),
			path: cleanPath(event.path),
			durationMs: event.durationMs === undefined ? undefined : Math.max(0, event.durationMs),
			timestamp: event.timestamp ?? Date.now(),
			attributes,
		});
		// Cap the queue — under sustained failure we drop the oldest
		// events rather than grow memory without bound.
		if (queue.length > MAX_QUEUE_LENGTH) {
			queue.splice(0, queue.length - MAX_QUEUE_LENGTH);
		}
		if (queue.length >= maxBatchSize) flush();
	};

	const report: ClientTelemetry["report"] = (event) => {
		try {
			if (
				typeof event !== "object" ||
				event === null ||
				!REPORTABLE_TYPES.has(event.type) ||
				typeof event.name !== "string" ||
				event.name === ""
			) {
				return;
			}
			enqueue(event);
		} catch {
			// Public API must never throw into app code.
		}
	};

	// --- Error capture -------------------------------------------------

	const onError = (event: Event): void => {
		try {
			const errorEvent = event as ErrorEvent;
			enqueue({
				type: "error",
				name: "client.error",
				message: truncate(errorEvent.message || "Unknown error", MAX_MESSAGE_LENGTH),
				stack:
					errorEvent.error instanceof Error
						? truncate(errorEvent.error.stack ?? "", MAX_STACK_LENGTH) || undefined
						: undefined,
				path: cleanPath(window.location?.pathname),
			});
		} catch {
			// Listener must never throw.
		}
	};

	const onUnhandledRejection = (event: Event): void => {
		try {
			const reason = (event as PromiseRejectionEvent).reason;
			const message = truncate(safeStringify(reason), MAX_MESSAGE_LENGTH);
			enqueue({
				type: "error",
				name: "client.error",
				message,
				stack:
					reason instanceof Error && reason.stack !== undefined
						? truncate(reason.stack, MAX_STACK_LENGTH)
						: undefined,
				path: cleanPath(window.location?.pathname),
			});
		} catch {
			// Listener must never throw.
		}
	};

	// --- Flush triggers --------------------------------------------------

	const onPageHide = (): void => flush();
	const onVisibilityChange = (): void => {
		try {
			if (document.visibilityState === "hidden") flush();
		} catch {
			// Listener must never throw.
		}
	};

	// --- fetch instrumentation -------------------------------------------
	// Patched once per page via a globalThis flag so HMR remounts and any
	// accidental second init can't stack wrappers. Telemetry ingest calls
	// themselves are excluded — otherwise every flush would generate a new
	// "web.request" event and the queue would never drain.

	const patchFetch = (): void => {
		const store = globalStore();
		if (store[FETCH_PATCHED_KEY] === true) return;
		const originalFetch = window.fetch;
		if (typeof originalFetch !== "function") return;
		store[FETCH_PATCHED_KEY] = true;
		store[FETCH_ORIGINAL_KEY] = originalFetch;

		const patchedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			let url = "";
			let method = "GET";
			let baseHeaders: HeadersInit | undefined;
			try {
				if (isRequestLike(input)) {
					// `fetch(request, init)` lets `init.headers` *replace* the
					// request's headers, so pre-merge request + init headers
					// here; telemetry headers are merged on top below.
					url = input.url;
					method = init?.method ?? input.method ?? "GET";
					const headers = new Headers(input.headers);
					new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
					baseHeaders = headers;
				} else {
					url = String(input);
					method = init?.method ?? "GET";
					baseHeaders = init?.headers;
				}
			} catch {
				// Header/url inspection failed — call through unmodified.
				return originalFetch.call(window, input, init);
			}

			const path = pathnameOf(url, window.location?.origin);
			// Skip self-instrumentation of the ingest endpoint — otherwise
			// every flush would enqueue another "web.request" and the queue
			// could never drain while sendBeacon is unavailable.
			if (path === undefined || path === endpointPath || url === endpoint) {
				return originalFetch.call(window, input, init);
			}

			const traceparent = newTraceparent();
			const requestId = randomUUID();
			const merged = mergeHeaders(baseHeaders, {
				traceparent,
				"x-request-id": requestId,
			});
			const startedAt = Date.now();
			const record = (status: number | string): void => {
				enqueue({
					type: "request",
					name: "web.request",
					path,
					status,
					durationMs: Date.now() - startedAt,
					traceparent,
					requestId,
					attributes: { method },
				});
			};

			try {
				// Same call shape for both input kinds: `init.headers` fully
				// determines outgoing headers, and for Request inputs the
				// method/body/credentials still come from the request itself.
				return originalFetch.call(window, input, { ...init, headers: merged }).then(
					(response) => {
						record(response.status);
						return response;
					},
					(error: unknown) => {
						record(0);
						throw error;
					},
				);
			} catch (error) {
				// Synchronous throw from fetch — record and rethrow so call
				// semantics are preserved exactly.
				record(0);
				throw error;
			}
		};
		window.fetch = patchedFetch;
	};

	// --- wiring ----------------------------------------------------------

	window.addEventListener("error", onError);
	cleanups.push(() => window.removeEventListener("error", onError));
	window.addEventListener("unhandledrejection", onUnhandledRejection);
	cleanups.push(() => window.removeEventListener("unhandledrejection", onUnhandledRejection));
	window.addEventListener("pagehide", onPageHide);
	cleanups.push(() => window.removeEventListener("pagehide", onPageHide));
	document.addEventListener("visibilitychange", onVisibilityChange);
	cleanups.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));
	const timer = setInterval(() => flush(), flushIntervalMs);
	patchFetch();

	const telemetry: ClientTelemetry = {
		report,
		dispose: () => {
			if (disposed) return;
			clearInterval(timer);
			for (const cleanup of cleanups) {
				try {
					cleanup();
				} catch {
					// Best-effort teardown.
				}
			}
			// Flush while still "live" so pending events aren't dropped, then
			// mark disposed and restore the original fetch so a later
			// initClientTelemetry (HMR remount, tests) starts clean.
			flush();
			disposed = true;
			const store = globalStore();
			const originalFetch = store[FETCH_ORIGINAL_KEY];
			if (store[FETCH_PATCHED_KEY] === true && typeof originalFetch === "function") {
				window.fetch = originalFetch as typeof window.fetch;
			}
			store[FETCH_PATCHED_KEY] = false;
			delete store[FETCH_ORIGINAL_KEY];
			delete store[GLOBAL_KEY];
		},
	};
	store[GLOBAL_KEY] = telemetry;
	return telemetry;
};

/**
 * Instrument TanStack Router navigation timing. Subscribes to
 * `onBeforeNavigate`/`onResolved` via `router.subscribe` (the real API in
 * @tanstack/router-core ≥1.121) and reports a `web.navigation` event per
 * completed navigation. Fully guarded: routers without `subscribe`,
 * partial event payloads, or missing `state.location` degrade to a
 * no-op rather than breaking the app.
 *
 * `sink` defaults to the singleton telemetry instance's `report`, so the
 * usual call site is `instrumentRouter(router)` after
 * `initClientTelemetry()`.
 *
 * Returns an unsubscribe function, or `undefined` when the router
 * doesn't expose the subscribe API.
 */
export const instrumentRouter = (
	router: InstrumentableRouter,
	sink?: (event: ClientTelemetryEvent) => void,
): (() => void) | undefined => {
	try {
		if (router === null || typeof router !== "object" || typeof router.subscribe !== "function") {
			return undefined;
		}
		const reportNavigation =
			sink ??
			((event: ClientTelemetryEvent) => {
				const telemetry = globalStore()[GLOBAL_KEY] as ClientTelemetry | undefined;
				telemetry?.report(event);
			});
		let navStartedAt: number | undefined;

		const unsubscribers: Array<() => void> = [];
		const subscribe = (
			eventType: "onBeforeNavigate" | "onResolved",
			fn: (event: { readonly type?: string }) => void,
		): void => {
			try {
				const unsub = router.subscribe?.(eventType, fn);
				if (typeof unsub === "function") unsubscribers.push(unsub);
			} catch {
				// Subscription is best-effort.
			}
		};

		subscribe("onBeforeNavigate", () => {
			navStartedAt = Date.now();
		});
		subscribe("onResolved", () => {
			try {
				if (navStartedAt === undefined) return;
				const durationMs = Math.max(0, Date.now() - navStartedAt);
				navStartedAt = undefined;
				const path =
					cleanPath(router.state?.location?.pathname) ??
					(isBrowser() ? cleanPath(window.location?.pathname) : undefined);
				reportNavigation({
					type: "navigation",
					name: "web.navigation",
					durationMs,
					path,
				});
			} catch {
				// Listener must never throw.
			}
		});

		return () => {
			for (const unsub of unsubscribers) {
				try {
					unsub();
				} catch {
					// Best-effort teardown.
				}
			}
		};
	} catch {
		return undefined;
	}
};
