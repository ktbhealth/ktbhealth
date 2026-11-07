import type { Plugin } from "@ktb/kernel";
import { plugin as consultations } from "@ktb/consultations";
import { plugin as patients } from "@ktb/patients";
import { BotLive } from "@ktb/bot-recall";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { Binding, Db, makeDb, type DbClient } from "@ktb/db";
import { makeAuth } from "@ktb/auth-better";
import { StubCaptchaLive } from "@ktb/captcha-stub";
import { TurnstileCaptchaLive } from "@ktb/captcha-turnstile";
import { Captcha } from "@ktb/captcha";

/**
 * Static plugin registry. Add a workspace plugin here — order matters for
 * nav/route composition. Everything is statically imported: workerd can't
 * do dynamic module loading and static keeps 100% type safety.
 */
export const plugins: readonly Plugin[] = [patients, consultations];

/** Minimal binding surface the host needs. Any platform (workerd, bun,
 * future adapters) supplies these; the host never touches cloudflare:*. */
export interface AppEnv {
	readonly DB: D1Database;
	readonly BETTER_AUTH_SECRET?: string;
	readonly BETTER_AUTH_URL?: string;
	readonly CAPTCHA_STUB?: unknown;
	readonly TURNSTILE_SECRET_KEY?: string;
}

/**
 * Composition root: wires the plugin registry, platform bindings, and
 * impl layers into a runnable app. Deploy targets (apps/web) call this
 * once with their env and re-export the pieces they need.
 */
export const createApp = <E extends AppEnv>(env: E) => {
	const BindingLive = Layer.succeed(Binding, env.DB);
	const db = makeDb(env.DB);
	const auth = makeAuth(db, {
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
	});

	// Bot check on credential endpoints. CAPTCHA_STUB (local dev var, never
	// set in the Alchemy stack) selects the stub; otherwise Turnstile when
	// its secret is bound; null skips verification entirely.
	const CaptchaLive = env.CAPTCHA_STUB
		? StubCaptchaLive
		: env.TURNSTILE_SECRET_KEY
			? TurnstileCaptchaLive(env.TURNSTILE_SECRET_KEY)
			: Layer.succeed(Captcha, null);

	// Plugin `services` layers merge here; platform bindings sit underneath.
	const pluginServices = plugins
		.map((p) => p.services)
		.filter((s): s is NonNullable<typeof s> => s !== undefined) as Layer.Layer<
		Db,
		never,
		Binding
	>[];
	const AppLive = Layer.mergeAll(BotLive, CaptchaLive, ...pluginServices).pipe(
		Layer.provideMerge(BindingLive),
	);
	const runtime = ManagedRuntime.make(AppLive);

	/** Resolve the Db service from AppLive and run a query against it. */
	const withDb = <A>(f: (db: DbClient) => Promise<A>): Promise<A> =>
		runtime.runPromise(Effect.flatMap(Effect.service(Db), (db) => Effect.promise(() => f(db))));

	return {
		plugins,
		BindingLive,
		CaptchaLive,
		AppLive,
		runtime,
		withDb,
		db,
		auth,
	};
};
