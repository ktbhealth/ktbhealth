import { discoverPlugins, orderPlugins } from "@ktb/driver-framework";
import type { Plugin } from "@ktb/kernel";
import { BotLive } from "@ktb/bot-recall";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { Binding, Db, DbLive, makeDb, type DbClient } from "@ktb/db";
import { makeAuth } from "@ktb/auth-better";
import { StubCaptchaLive } from "@ktb/captcha-stub";
import { TurnstileCaptchaLive } from "@ktb/captcha-turnstile";
import { Captcha } from "@ktb/captcha";
import { Auth } from "@ktb/auth";
import { AnamnesisEngineLive, ReviewEngineLive } from "@ktb/anamnesis-llm/services";

/**
 * Plugin registry discovered from the filesystem: every module under
 * packages/plugins/* exporting `plugin` is registered, topo-sorted by
 * `deps`. import.meta.glob is a build-time transform — Vite emits static
 * imports, so workerd bundling and type safety are preserved.
 */
export const plugins: readonly Plugin[] = orderPlugins(
	discoverPlugins(import.meta.glob("../../../plugins/*/src/index.ts", { eager: true })),
);

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

	// Plugin services compose in topo order: each plugin's layer is
	// provided the accumulated outputs of everything before it, so a
	// plugin can consume services provided by its `deps`.
	// Layer.Any is type-erased per plugin; requirements are still checked
	// when ManagedRuntime.make builds AppLive.
	const pluginLayer = plugins
		.map((p) => p.services as Layer.Layer<unknown, unknown, unknown> | undefined)
		.filter((s): s is NonNullable<typeof s> => s !== undefined)
		.reduce<Layer.Layer<unknown, unknown, unknown>>(
			(acc, svc) => Layer.merge(acc, svc.pipe(Layer.provideMerge(acc))),
			Layer.empty as unknown as Layer.Layer<unknown, unknown, unknown>,
		);
	// Infra layers are provided to plugin layers explicitly: mergeAll does
	// not wire one sibling's outputs into another's requirements.
	// Auth port backed by the same better-auth instance the routes use.
	const AuthServiceLive = Layer.succeed(
		Auth,
		Auth.of({
			getSession: async (headers) => {
				const s = await auth.api.getSession({ headers });
				if (!s) return null;
				return {
					user: {
						id: s.user.id,
						email: s.user.email,
						name: s.user.name ?? null,
					},
					sessionId: s.session.id,
					expiresAt: new Date(s.session.expiresAt),
				};
			},
		}),
	);
	const core = Layer.mergeAll(
		BotLive,
		CaptchaLive,
		DbLive,
		AuthServiceLive,
		AnamnesisEngineLive,
		ReviewEngineLive,
	);
	const AppLive = Layer.mergeAll(core, pluginLayer.pipe(Layer.provide(core))).pipe(
		Layer.provideMerge(BindingLive),
	);
	// Heterogeneous plugin layers can't be proven RIn-free at the type
	// level; unsatisfied requirements still fail at layer build time.
	const runtime = ManagedRuntime.make(AppLive as Layer.Layer<unknown, unknown, never>);

	/** Run an Effect program against the composed app runtime. */
	const run = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
		runtime.runPromise(effect);

	return {
		plugins,
		BindingLive,
		CaptchaLive,
		AppLive,
		runtime,
		run,
		db,
		auth,
	};
};
