import type * as Effect from "effect/Effect";

/** The slice of R2 needed to drop objects — the real R2Bucket satisfies this. */
export interface AudioDeleter {
	delete(keys: string[]): Promise<void>;
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
	/** Run an Effect program as an authenticated user (Principal + Authz bound). */
	readonly runAs: <A, E>(
		user: { readonly id: string; readonly email?: string },
		effect: Effect.Effect<A, E, unknown>,
	) => Promise<A>;
	/** Audio object storage for best-effort purge; undefined when unbound. */
	readonly audio?: AudioDeleter;
	/** Active UI locale — the host's i18n runtime (paraglide) resolved per request. */
	readonly getLocale: () => string;
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

/** `run` against the registered runtime. */
export const run = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
	getServerRuntime().run(effect);

/** `runAs` against the registered runtime. */
export const runAs = <A, E>(
	user: { readonly id: string; readonly email?: string },
	effect: Effect.Effect<A, E, unknown>,
): Promise<A> => getServerRuntime().runAs(user, effect);

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
