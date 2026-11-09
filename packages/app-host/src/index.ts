import { discoverPlugins, orderPlugins, requireDriver, type Driver } from "@ktb/driver-framework";
import type { Plugin } from "@ktb/kernel";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { Bot } from "@ktb/bot";
import { recallDriver } from "@ktb/bot-recall";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { Binding, Db, DbLive, makeDb, type DbClient } from "@ktb/db";
import { makeAuth } from "@ktb/auth-better";
import { Captcha, nullCaptchaDriver } from "@ktb/captcha";
import { stubCaptchaDriver } from "@ktb/captcha-stub";
import { turnstileCaptchaDriver } from "@ktb/captcha-turnstile";
import { Auth } from "@ktb/auth";
import { AuthzLive, Principal } from "@ktb/authz";
import { AnamnesisEngine } from "@ktb/anamnesis/services";
import type { LlmConfig } from "@ktb/anamnesis-llm/services";
import { llmDrivers } from "@ktb/anamnesis-llm/drivers";
import { correctTranscript as correctTranscriptEffect } from "@ktb/anamnesis-llm";
import {
	Command,
	CommandBus,
	makeCommandBus,
	makeEventBus,
	makeQueryBus,
	mergeDispatchTables,
	Middleware,
	Query,
	QueryBus,
	type DispatchTable,
} from "@effect-server-utils/cqrs";

/**
 * Plugin registry discovered from the filesystem: every module under
 * packages/plugins/* exporting `plugins` (single-concern Plugin objects)
 * is registered, topo-sorted by `requiredDeps`/`optionalDeps`.
 * import.meta.glob is a build-time transform — Vite emits static imports,
 * so workerd bundling and type safety are preserved.
 */
export const plugins: readonly Plugin[] = orderPlugins(
	discoverPlugins(import.meta.glob("../../../plugins/*/src/index.ts", { eager: true })),
);

/**
 * CQRS groups are enumerated by convention, not by plugin objects: every
 * plugin api module (`plugins/<name>/src/api.ts`) may export query/command
 * group values, and the `isGroup` guards (provided by the library exactly for
 * host reflection) filter them out of each module's export surface.
 * Events need no enumeration — `EventBus` is already app-wide.
 */
const apiModules = import.meta.glob("../../../plugins/*/src/api.ts", { eager: true });
const moduleExports = Object.values(apiModules).flatMap((m) =>
	Object.values(m as Record<string, unknown>),
);
const queryGroups = moduleExports.filter(Query.isGroup);
const commandGroups = moduleExports.filter(Command.isGroup);

/** Minimal binding surface the host needs. Any platform (workerd, bun,
 * future adapters) supplies these; the host never touches cloudflare:*. */
export interface AppEnv {
	readonly DB: D1Database;
	readonly BETTER_AUTH_SECRET?: string;
	readonly BETTER_AUTH_URL?: string;
	readonly CAPTCHA_STUB?: unknown;
	readonly TURNSTILE_SECRET_KEY?: string;
	readonly ANTHROPIC_API_KEY?: string;
	readonly LLM_API_KEY?: string;
	readonly OPENAI_API_KEY?: string;
	readonly LLM_BASE_URL?: string;
	readonly LLM_MODEL?: string;
	readonly WORKERS_AI_MODEL?: string;
	/** Comma-separated admin allowlist for the /platform console (P-026). */
	readonly PLATFORM_ADMIN_EMAILS?: string;
	/** Workers AI binding — optional; any object with `run(model, inputs)`. */
	readonly AI?: {
		run(model: string, inputs: unknown): Promise<unknown>;
	};
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

	// Port→impl selection is data: impl packages export Driver descriptors
	// and the first enabled driver for a port wins (array order is the
	// tie-break). Ordering encodes precedence — e.g. the captcha stub
	// before Turnstile before the disabled verifier; LLM drivers carry
	// their own when predicates mirroring the old factory branches.
	// Auth and Db stay manual: they wrap the live auth/db instances
	// built above, not env-selected impls.
	const drivers: readonly Driver<unknown>[] = [
		recallDriver,
		stubCaptchaDriver,
		turnstileCaptchaDriver,
		nullCaptchaDriver,
		...llmDrivers,
	];
	// Drivers are type-erased (Layer.Any); each port maps to exactly one
	// service, so the concrete layer type is restored here — same shape
	// the hand-written ternaries used to produce.
	const layerFor = <S>(port: string, driverEnv: unknown): Layer.Layer<S, never, never> =>
		requireDriver(drivers, port, driverEnv).provides(driverEnv) as Layer.Layer<S, never, never>;

	// Bot check on credential endpoints. CAPTCHA_STUB (local dev var, never
	// set in the Alchemy stack) selects the stub; otherwise Turnstile when
	// its secret is bound; null skips verification entirely.
	const BotLive = layerFor<Bot>(Bot.key, env);
	const CaptchaLive = layerFor<Captcha>(Captcha.key, env);

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
	// LLM provider config is resolved here, once — impl packages never
	// read env themselves.
	const llmConfig: LlmConfig = {
		anthropicApiKey: env.ANTHROPIC_API_KEY,
		openAiApiKey: env.LLM_API_KEY ?? env.OPENAI_API_KEY,
		openAiBaseUrl: env.LLM_BASE_URL,
		openAiModel: env.LLM_MODEL,
		workersAi: env.AI,
		workersAiModel: env.WORKERS_AI_MODEL,
	};
	const AnamnesisEngineLive = layerFor<AnamnesisEngine>(AnamnesisEngine.key, llmConfig);
	// Platform admin gate (P-026): env allowlist resolved once here; the
	// gate fails closed (Forbidden) when the list is unset/empty.
	const PlatformAdminLive = Layer.succeed(
		PlatformAdmin,
		makePlatformAdminGate(parsePlatformAdminEmails(env.PLATFORM_ADMIN_EMAILS)),
	);
	const core = Layer.mergeAll(
		BotLive,
		CaptchaLive,
		DbLive,
		AuthServiceLive,
		AnamnesisEngineLive,
		PlatformAdminLive,
		// Cross-plugin event bus — plugins publish/subscribe via EventBus
		// inside their service layers (CQRS event surface).
		makeEventBus(),
	);
	// App-wide CQRS buses (P-049): each group's dispatcher is built once,
	// wrapped in shared middleware, folded into an erased DispatchTable,
	// and served as QueryBus/CommandBus for dynamic dispatch
	// (`bus.execute(Def, payload)`). Typed `dispatcher(Group)` remains
	// the preferred path — buses exist for callers that can't name a
	// group statically. `declaredIn` makes a group whose handlers were
	// never registered fail at boot instead of on first dispatch.
	//
	// Middleware cannot widen the error channel, so authz cannot live
	// here — handlers keep their own `requireCanAs` checks. What the bus
	// boundary CAN own uniformly is observability: commands log at info,
	// queries at debug, failures at warning.
	const busMiddleware: ReadonlyArray<Middleware.Middleware> = [
		(dispatch, { tag, side }) =>
			(payload) =>
				dispatch(payload).pipe(
					Effect.tap(() =>
						side === "command"
							? Effect.logInfo("cqrs command", { tag })
							: Effect.logDebug("cqrs query", { tag }),
					),
					Effect.tapError((error) =>
						Effect.logWarning("cqrs dispatch failed", {
							tag,
							side,
							error: String(error),
						}),
					),
				),
	];
	const busesLive = Layer.unwrap(
		Effect.gen(function* () {
			const queryTables = yield* Effect.forEach(queryGroups, (group) =>
				Query.dispatcher(group, { middleware: busMiddleware }),
			);
			const commandTables = yield* Effect.forEach(commandGroups, (group) =>
				Command.dispatcher(group, { middleware: busMiddleware }),
			);
			return Layer.mergeAll(
				Layer.succeed(
					QueryBus,
					makeQueryBus(mergeDispatchTables(...queryTables) as DispatchTable, {
						declaredIn: queryGroups,
					}),
				),
				Layer.succeed(
					CommandBus,
					makeCommandBus(mergeDispatchTables(...commandTables) as DispatchTable, {
						declaredIn: commandGroups,
					}),
				),
			);
		}),
	).pipe(Layer.provide(pluginLayer.pipe(Layer.provide(core))));
	const AppLive = Layer.mergeAll(core, pluginLayer.pipe(Layer.provide(core)), busesLive).pipe(
		Layer.provideMerge(BindingLive),
		// Single-line JSON logs → workerd console / wrangler observability.
		Layer.provideMerge(Logger.layer([Logger.consoleJson])),
	);
	// Heterogeneous plugin layers can't be proven RIn-free at the type
	// level; unsatisfied requirements still fail at layer build time.
	const runtime = ManagedRuntime.make(AppLive as Layer.Layer<unknown, unknown, never>);

	/**
	 * Run an Effect program against the composed app runtime.
	 *
	 * System/unauthenticated paths only: provider webhooks (bot-token auth
	 * via `ownedByBot`), background simulation, LLM helpers reachable
	 * without a session. No `Principal` is bound — domain services that
	 * require a user will fail `Forbidden`; bot-channel methods that are
	 * authorized out-of-band (botId binding) are designed for this.
	 */
	const run = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
		runtime.runPromise(effect);

	/**
	 * Run an Effect program as an authenticated user: binds `Principal`
	 * and the user's `Authz` rules for the duration of the effect, so
	 * domain services enforce authorization themselves (defense in
	 * depth — handlers no longer need per-call `requireCan`).
	 */
	const runAs = <A, E>(
		user: { readonly id: string; readonly email?: string },
		effect: Effect.Effect<A, E, unknown>,
	): Promise<A> =>
		runtime.runPromise(
			effect.pipe(
				Effect.provideService(Principal, { userId: user.id, email: user.email }),
				Effect.provide(AuthzLive(user.id)),
			),
		);

	/**
	 * LLM transcript cleanup (P-017) bound to the resolved provider
	 * config. System path — no principal; returns null when unconfigured
	 * or on provider failure (correctedTranscript stays null).
	 */
	const correctTranscript = (transcript: string) =>
		runtime.runPromise(correctTranscriptEffect(llmConfig, transcript));

	return {
		plugins,
		BindingLive,
		CaptchaLive,
		AppLive,
		runtime,
		run,
		runAs,
		correctTranscript,
		db,
		auth,
	};
};
