import type * as Effect from "effect/Effect";
import type { ExportFormat, RecordExporter } from "@ktb/interop";
import type { TenantSelector } from "@ktb/tenant/selector";

/** The slice of R2 needed to drop objects — the real R2Bucket satisfies this. */
export interface AudioDeleter {
	delete(keys: string[]): Promise<void>;
}

/** Stored object slice the audio routes stream back (R2ObjectBody-compatible). */
export interface AudioObject {
	readonly body: ReadableStream;
	readonly size: number;
	readonly httpMetadata?: { readonly contentType?: string } | null;
}

/**
 * The slice of R2Bucket the consultation audio routes need: store on
 * upload, stream on download, delete on purge. The real R2Bucket
 * satisfies this; `audio` carries it so plugin routes never touch the
 * binding directly.
 */
export interface AudioStore extends AudioDeleter {
	get(key: string): Promise<AudioObject | null>;
	put(
		key: string,
		value: ArrayBuffer | Uint8Array | ReadableStream,
		options?: { readonly httpMetadata?: { readonly contentType?: string } },
	): Promise<unknown>;
}

/** Message enqueued for async transcription (P-016). `tenantId` is the
 * owning tenant (`groups.id`) or null/absent for personal scope — the
 * consumer re-binds tenant scope from it (P-053 phase D); messages
 * enqueued before tenancy carry no field and stay personal. */
export interface AudioJobMessage {
	readonly consultationId: number;
	readonly audioKey: string;
	readonly userId: string;
	readonly tenantId?: number | null;
}

/** The slice of the workerd Queue producer the upload route needs. */
export interface AudioQueueSender {
	send(message: AudioJobMessage): Promise<unknown>;
}

/**
 * Row-count snapshot of the transcription queue, grouped by delivery
 * status. Only available when the bound queue exposes stats — the
 * dev:node SQLite queue does; the workerd Queue binding does not
 * (production queues are managed in the Cloudflare dashboard, so the
 * ops console reports them as externally managed instead).
 */
export interface QueueDepth {
	readonly pending: number;
	readonly processing: number;
	readonly done: number;
	readonly failed: number;
}

/**
 * Aggregate object stats for the audio bucket. `truncated` means the
 * listing hit the page cap — counts are a lower bound, not exact.
 */
export interface AudioStorageStats {
	readonly objects: number;
	readonly bytes: number;
	readonly truncated: boolean;
}

/**
 * Minimal paginated listing slice — the real R2Bucket satisfies this
 * (its `list` returns R2Objects, a superset of the shape below). Used
 * only by the ops stats probe; audio routes never list.
 */
export interface AudioObjectLister {
	list(options?: { readonly limit?: number; readonly cursor?: string }): Promise<{
		readonly objects: readonly { readonly key: string; readonly size: number }[];
		readonly truncated: boolean;
		readonly cursor?: string;
	}>;
}

/** Page cap for the storage stats probe — an ops health signal needs
 * an order-of-magnitude count, not a full bucket inventory. */
const STORAGE_STATS_MAX_PAGES = 5;

/**
 * Aggregate object count + bytes over an R2-style lister, capped at
 * `maxPages` pages. Returns null when the bucket cannot list or any
 * page fails — the ops console renders "unavailable", never a fake
 * zero.
 */
export const audioStorageStats = async (
	bucket: AudioObjectLister | undefined,
	maxPages = STORAGE_STATS_MAX_PAGES,
): Promise<AudioStorageStats | null> => {
	if (bucket?.list === undefined) return null;
	try {
		let objects = 0;
		let bytes = 0;
		let cursor: string | undefined;
		for (let page = 0; page < maxPages; page++) {
			const result = await bucket.list({ limit: 1000, cursor });
			for (const object of result.objects) {
				objects += 1;
				bytes += object.size;
			}
			if (!result.truncated) return { objects, bytes, truncated: false };
			cursor = result.cursor;
			// Truncated without a cursor cannot be paged further.
			if (cursor === undefined) return { objects, bytes, truncated: true };
		}
		return { objects, bytes, truncated: true };
	} catch {
		return null;
	}
};

/** The slice of the Workers AI binding the transcribe route needs. */
export interface AiRunner {
	run(model: string, inputs: unknown): Promise<unknown>;
}

/**
 * Host capabilities plugin server functions may reach. Populated once by
 * the composition root (apps/web `lib/platform.ts`) — plugins never read
 * env or platform bindings themselves; the env read stays host-side
 * behind this registry (P-033).
 */
export interface ServerRuntime {
	/** Run an Effect program against the composed app runtime (system paths). */
	readonly run: <A, E>(effect: Effect.Effect<A, E, unknown>) => Promise<A>;
	/** Run an Effect program as an authenticated user (Principal + Authz +
	 * resolved Tenant bound). `tenantSelector` is the opaque request
	 * selector forwarded to the app's TenantResolver — omit for the
	 * resolver's default path. */
	readonly runAs: <A, E>(
		user: { readonly id: string; readonly email?: string },
		effect: Effect.Effect<A, E, unknown>,
		tenantSelector?: TenantSelector | null,
	) => Promise<A>;
	/** Audio object storage for upload/download routes and best-effort
	 * purge; undefined when unbound. */
	readonly audio?: AudioStore;
	/** Queue producer for async transcription jobs; undefined when unbound. */
	readonly audioQueue?: AudioQueueSender;
	/** Queue depth probe — present only when the bound queue exposes
	 * stats (the dev:node SQLite queue). Resolves null on probe failure;
	 * undefined field means the queue is managed externally. */
	readonly audioQueueDepth?: () => Promise<QueueDepth | null>;
	/** Audio bucket aggregate stats (object count + bytes, capped
	 * pagination); undefined when no bucket binding is published. */
	readonly audioStorageStats?: () => Promise<AudioStorageStats | null>;
	/** Workers AI binding (or host-resolved stand-in) for transcription;
	 * undefined when unbound. */
	readonly ai?: AiRunner;
	/** Model id for audio transcription jobs/routes; resolved by the
	 * composition root from deploy config — the port never names a
	 * provider model itself. */
	readonly audioTranscribeModel: string;
	/** Interop record exporters behind the @ktb/interop port — the host
	 * wires the standard-specific adapters, plugins only see the port. */
	readonly recordExporters?: Record<ExportFormat, RecordExporter>;
	/** Active UI locale — the host's i18n runtime (paraglide) resolved per request. */
	readonly getLocale: () => string;
	/**
	 * Plugin enable-state check (P-058) backing `pluginEnabledFn` and the
	 * `createPluginFileRoute` gate. The composition root wires it to
	 * `PluginStates.isEnabled`; absent (tests, non-app contexts) the gate
	 * is inert — there is no plugin_state store to consult anyway.
	 */
	readonly pluginEnabled?: (pluginId: string) => Promise<boolean>;
	/**
	 * Credential-provider request handler for the auth plugin's
	 * `/api/auth/*` catch-all (P-062): the composition root owns the
	 * provider instance (apps/web deliberately builds it outside the
	 * driver registry — see @ktb/app-host), so plugin routes reach it
	 * through this capability instead of importing the adapter. Absent
	 * outside the composed app — the route answers 500.
	 */
	readonly authHandler?: (request: Request) => Promise<Response>;
}

let runtime: ServerRuntime | undefined;

/** Composition-root hook: call once at startup before any server fn runs. */
export const setServerRuntime = (next: ServerRuntime): void => {
	runtime = next;
};

/** Test hook: drop the registry between cases. */
export const resetServerRuntime = (): void => {
	runtime = undefined;
};

export const getServerRuntime = (): ServerRuntime => {
	if (runtime === undefined)
		throw new Error(
			"@ktb/server-fns: runtime not initialized — call setServerRuntime() at the composition root",
		);
	return runtime;
};

/**
 * Non-throwing variant of `getServerRuntime` for optional capabilities
 * (the plugin route gate): `undefined` outside the composed app, where
 * callers degrade to their documented default instead of crashing.
 */
export const peekServerRuntime = (): ServerRuntime | undefined => runtime;

/** `run` against the registered runtime. */
export const run = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
	getServerRuntime().run(effect);

/** `runAs` against the registered runtime. */
export const runAs = <A, E>(
	user: { readonly id: string; readonly email?: string },
	effect: Effect.Effect<A, E, unknown>,
	tenantSelector?: TenantSelector | null,
): Promise<A> => getServerRuntime().runAs(user, effect, tenantSelector);

/** Active locale for the current request (SSR ALS / client cookie). */
export const getLocale = (): string => getServerRuntime().getLocale();

/** R2 delete batch size — the bucket accepts at most 1000 keys per call. */
const AUDIO_DELETE_BATCH = 1000;

/**
 * Best-effort removal of consultation audio once its database rows are
 * gone (storage is outside the D1 batch). Returns the keys that could
 * not be removed so the caller can report orphaned recordings instead
 * of losing track of patient audio silently.
 */
export const purgeAudio = async (
	bucket: AudioDeleter | undefined,
	keys: readonly string[],
): Promise<string[]> => {
	if (keys.length === 0) return [];
	if (!bucket) return [...keys];
	const failed: string[] = [];
	for (let i = 0; i < keys.length; i += AUDIO_DELETE_BATCH) {
		const batch = keys.slice(i, i + AUDIO_DELETE_BATCH);
		try {
			await bucket.delete(batch);
		} catch (error) {
			console.error("audio purge failed", { keys: batch.length, error });
			failed.push(...batch);
		}
	}
	return failed;
};
