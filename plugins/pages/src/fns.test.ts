import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));

import { Auth } from "@ktb/auth";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { Principal } from "@ktb/authz";
import {
	makePlatformAdminGate,
	parsePlatformAdminEmails,
	PlatformAdmin,
	platformAdminPlugin,
	platformPanelPlugin,
	platformRoutesPlugin,
} from "@ktb/platform";
import {
	makePluginStatesLive,
	PluginStates,
	type PluginStatesShape,
} from "@ktb/platform/plugin-states";
import { resetServerRuntime, setServerRuntime } from "@ktb/server-fns";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { plugins } from "./index.ts";
import { CUSTOM_PAGES_TEST_DDL, CustomPages, CustomPagesLive } from "./service.ts";
import { createPageFn, deletePageFn, navPagesFn, updatePageFn } from "./fns.ts";

const PLUGIN_STATE_DDL = `
CREATE TABLE plugin_state (
	plugin_id TEXT PRIMARY KEY NOT NULL,
	enabled INTEGER DEFAULT true NOT NULL,
	config TEXT,
	updated_at INTEGER NOT NULL
);
`;

// The pages plugins depend on the platform markers — the test registry
// includes them so dep edges and PluginStates resolve like the host.
const registry = [platformAdminPlugin, platformRoutesPlugin, platformPanelPlugin, ...plugins];

const sessionFor = (email: string | null) =>
	email === null
		? null
		: {
				user: { id: `id-${email}`, email, name: email },
				sessionId: "s1",
				expiresAt: new Date(Date.now() + 3600_000),
			};

describe("pages fns", () => {
	let runtime: ManagedRuntime.ManagedRuntime<unknown, never>;
	let currentEmail: string | null = null;
	let auth: ReturnType<typeof Auth.of>;

	const installRuntime = (rt: ManagedRuntime.ManagedRuntime<unknown, never>) => {
		setServerRuntime({
			run: (effect) => rt.runPromise(effect.pipe(Effect.provideService(Auth, auth))),
			runAs: (user, effect) =>
				rt.runPromise(
					effect.pipe(
						Effect.provideService(Principal, {
							userId: user.id,
							email: user.email,
						}),
					),
				),
			audioTranscribeModel: "test-model",
			getLocale: () => "en",
		});
	};

	beforeAll(async () => {
		const db = makeDb(makeD1(CUSTOM_PAGES_TEST_DDL + PLUGIN_STATE_DDL));
		const env = Layer.mergeAll(
			Layer.succeed(Db, db),
			Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
		);
		const states = makePluginStatesLive(registry);
		const customPages = CustomPagesLive.pipe(Layer.provide(env));
		runtime = ManagedRuntime.make(
			Layer.mergeAll(states.pipe(Layer.provide(env)), customPages, env) as Layer.Layer<
				unknown,
				never,
				never
			>,
		);
		auth = Auth.of({
			getSession: async () => sessionFor(currentEmail) as never,
			setUserBanned: async () => {},
		});
		installRuntime(runtime);
	});

	afterAll(() => {
		resetServerRuntime();
		return runtime.dispose();
	});

	it("rejects anonymous admin callers but serves the public nav", async () => {
		currentEmail = null;
		await expect(createPageFn({ data: { path: "/x", title: "X", content: "" } })).rejects.toThrow(
			"unauthenticated",
		);
		await expect(deletePageFn({ data: { id: 1 } })).rejects.toThrow("unauthenticated");
		// Public read works without a session.
		await expect(navPagesFn()).resolves.toEqual([]);
	});

	it("denies non-admin principals", async () => {
		currentEmail = "doc@x.com";
		await expect(
			createPageFn({ data: { path: "/x", title: "X", content: "" } }),
		).resolves.toBeNull();
		await expect(
			updatePageFn({ data: { id: 1, path: "/x", title: "X", content: "" } }),
		).resolves.toBeNull();
		await expect(deletePageFn({ data: { id: 1 } })).resolves.toBe(false);
	});

	it("creates, updates, deletes and lists nav pages as admin", async () => {
		currentEmail = "admin@x.com";
		const created = await createPageFn({
			data: {
				path: "/hello",
				title: "Hello",
				content: "# Hi",
				published: true,
				showInNav: true,
				sortOrder: 3,
			},
		});
		expect(created).toMatchObject({
			path: "/hello",
			title: "Hello",
			published: true,
			showInNav: true,
			sortOrder: 3,
		});
		expect(created).not.toHaveProperty("createdAt");

		// Duplicate path → handled failure → null.
		await expect(
			createPageFn({ data: { path: "/hello", title: "Dup", content: "" } }),
		).resolves.toBeNull();
		// Invalid path → null.
		await expect(
			createPageFn({ data: { path: "bad", title: "Bad", content: "" } }),
		).resolves.toBeNull();

		const updated = await updatePageFn({
			data: {
				id: created!.id,
				path: "/hello/",
				title: "Hello!",
				content: "bye",
				published: false,
				showInNav: false,
			},
		});
		expect(updated).toMatchObject({ id: created!.id, path: "/hello", title: "Hello!" });
		await expect(
			updatePageFn({ data: { id: 999, path: "/x", title: "X", content: "" } }),
		).resolves.toBeNull();
		await expect(
			updatePageFn({ data: { id: created!.id, path: "/platform/x", title: "X", content: "" } }),
		).resolves.toBeNull();

		// Republish for nav, then check the public listing.
		await updatePageFn({
			data: {
				id: created!.id,
				path: "/hello",
				title: "Hello",
				content: "",
				published: true,
				showInNav: true,
				sortOrder: 3,
			},
		});
		await expect(navPagesFn()).resolves.toEqual([{ path: "/hello", title: "Hello", sortOrder: 3 }]);

		expect(await deletePageFn({ data: { id: created!.id } })).toBe(true);
		expect(await deletePageFn({ data: { id: created!.id } })).toBe(false);
		await expect(navPagesFn()).resolves.toEqual([]);
	});

	it("validates wire input before the handler runs", async () => {
		currentEmail = "admin@x.com";
		await expect(createPageFn({ data: { path: 1 } } as never)).rejects.toBeInstanceOf(Error);
		await expect(updatePageFn({ data: { path: "/x" } } as never)).rejects.toBeInstanceOf(Error);
		await expect(deletePageFn({ data: { id: "1" } } as never)).rejects.toBeInstanceOf(Error);
	});

	it("navPagesFn returns [] while the render plugin is disabled", async () => {
		currentEmail = "admin@x.com";
		const created = await createPageFn({
			data: { path: "/nav", title: "Nav", content: "", published: true, showInNav: true },
		});
		expect(created).not.toBeNull();
		await runtime.runPromise(
			Effect.gen(function* () {
				const states = yield* PluginStates;
				yield* states.setEnabled(["pages.render"], false);
			}),
		);
		await expect(navPagesFn()).resolves.toEqual([]);
		await runtime.runPromise(
			Effect.gen(function* () {
				const states = yield* PluginStates;
				yield* states.setEnabled(["pages.render"], true);
			}),
		);
		await expect(navPagesFn()).resolves.toHaveLength(1);
	});

	it("propagates unexpected service errors instead of mapping them", async () => {
		const stubPages = CustomPages.of({
			adminList: () => Effect.fail({ _tag: "Other" }),
			adminCreate: () => Effect.fail({ _tag: "Other" }),
			adminUpdate: () => Effect.fail({ _tag: "Other" }),
			adminRemove: () => Effect.fail({ _tag: "Other" }),
			publishedByPath: () => Effect.succeed(null),
			navList: () => Effect.fail({ _tag: "Other" }),
		} as unknown as CustomPages["Service"]);
		const rt = ManagedRuntime.make(
			Layer.mergeAll(
				Layer.succeed(
					PlatformAdmin,
					makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com")),
				),
				Layer.succeed(PluginStates, {
					isEnabled: () => Effect.succeed(true),
					enabledIds: () => Effect.succeed(new Set<string>()),
					config: () => Effect.succeed({}),
					setEnabled: () => Effect.void,
					setConfig: () => Effect.void,
					entries: () => Effect.succeed([]),
				} as unknown as PluginStatesShape),
				Layer.succeed(CustomPages, stubPages),
			) as Layer.Layer<unknown, never, never>,
		);
		installRuntime(rt);
		currentEmail = "admin@x.com";
		try {
			// The stub fails with an untranslatable tag — the fns' catch
			// blocks only map the handled domain errors, so it propagates.
			await expect(
				createPageFn({ data: { path: "/x", title: "X", content: "" } }),
			).rejects.toMatchObject({ _tag: "Other" });
			await expect(
				updatePageFn({ data: { id: 1, path: "/x", title: "X", content: "" } }),
			).rejects.toMatchObject({ _tag: "Other" });
			await expect(deletePageFn({ data: { id: 1 } })).rejects.toMatchObject({
				_tag: "Other",
			});
			await expect(navPagesFn()).rejects.toMatchObject({ _tag: "Other" });
		} finally {
			installRuntime(runtime);
			await rt.dispose();
		}
	});

	it("maps a null create to null and rethrows non-domain failures", async () => {
		const stubPages = CustomPages.of({
			adminList: () => Effect.succeed([]),
			// adminCreate can legitimately resolve null (empty insert
			// returning) — the fn must pass that through as null. A
			// sentinel path fails with a non-domain error to exercise
			// the catch's rethrow path.
			adminCreate: (input: { path?: string }) =>
				input.path === "/fail"
					? Effect.fail(new Error("plain create failure"))
					: Effect.succeed(null),
			// Failures without a handled _tag (plain Error, non-object)
			// take the catch's rethrow path for each admin fn.
			adminUpdate: () => Effect.fail(new Error("plain update failure")),
			adminRemove: () => Effect.fail("plain delete failure"),
			publishedByPath: () => Effect.succeed(null),
			navList: () => Effect.succeed([]),
		} as unknown as CustomPages["Service"]);
		const rt = ManagedRuntime.make(
			Layer.mergeAll(
				Layer.succeed(
					PlatformAdmin,
					makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com")),
				),
				Layer.succeed(CustomPages, stubPages),
			) as Layer.Layer<unknown, never, never>,
		);
		installRuntime(rt);
		currentEmail = "admin@x.com";
		try {
			await expect(
				createPageFn({ data: { path: "/x", title: "X", content: "" } }),
			).resolves.toBeNull();
			await expect(
				createPageFn({ data: { path: "/fail", title: "X", content: "" } }),
			).rejects.toBeInstanceOf(Error);
			await expect(
				updatePageFn({ data: { id: 1, path: "/x", title: "X", content: "" } }),
			).rejects.toBeInstanceOf(Error);
			const deleteError = await deletePageFn({ data: { id: 1 } }).catch((error: unknown) => error);
			expect(deleteError).toBe("plain delete failure");
		} finally {
			installRuntime(runtime);
			await rt.dispose();
		}
	});
});
