import { describe, expect, it } from "vitest";

import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { makePluginStatesLive, PluginStates } from "@ktb/platform/plugin-states";
import { Principal } from "@ktb/authz";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { managerChromePlugin, managerPanelPlugin, plugins } from "./index.ts";
import { managerConfig, managerConfigSchema } from "./config.tsx";

const DDL = `
CREATE TABLE plugin_state (
	plugin_id TEXT PRIMARY KEY NOT NULL,
	enabled INTEGER DEFAULT true NOT NULL,
	config TEXT,
	updated_at INTEGER NOT NULL
);
`;

describe("manager plugins", () => {
	it("declares the sidebar chrome and the /platform/plugins page", () => {
		expect(managerChromePlugin.id).toBe("manager.chrome");
		expect(managerChromePlugin.chrome).toHaveLength(1);
		expect(managerChromePlugin.chrome[0]).toMatchObject({
			region: "console.sidebar",
			content: {
				kind: "sidebarItem",
				item: { to: "/platform/plugins", label: "Plugins", group: "System" },
			},
		});
		expect(managerPanelPlugin.id).toBe("manager.panel");
		expect(managerPanelPlugin.panel?.pages?.[0]).toMatchObject({
			id: "manager.plugins",
			path: "/platform/plugins",
		});
	});

	it("carries meta for the manager list, including a JSON-Schema config doc", () => {
		expect(managerPanelPlugin.meta?.name).toBe("Plugin manager");
		// meta.config is the serializable projection shared with client.ts;
		// configSchema is the server-only effect/Schema it derives from.
		expect(managerPanelPlugin.meta?.config).toBe(managerConfig);
		expect(managerPanelPlugin.meta?.config?.schema.schema).toMatchObject({
			type: "object",
			properties: {
				cascadeConfirm: { type: "boolean", default: true },
			},
		});
		expect(managerPanelPlugin.configSchema).toBe(managerConfigSchema);
	});

	it("exports the discovery plugins array", () => {
		expect(plugins.map((p) => p.id)).toEqual(["manager.chrome", "manager.panel"]);
	});
});

describe("manager page loader", () => {
	const loader = managerPanelPlugin.panel!.pages![0]!.loader!;

	const runtimeFor = (adminEmail?: string) =>
		ManagedRuntime.make(
			Layer.mergeAll(
				makePluginStatesLive(plugins).pipe(Layer.provide(Layer.succeed(Db, makeDb(makeD1(DDL))))),
				Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails(adminEmail))),
			),
		);

	it("returns plugin states for an admin principal", async () => {
		const runtime = runtimeFor("admin@x.com");
		try {
			const data = await runtime.runPromise(
				loader().pipe(Effect.provideService(Principal, { userId: "u1", email: "admin@x.com" })),
			);
			expect(data).toEqual({
				states: [
					{ pluginId: "manager.chrome", enabled: true, config: null },
					{ pluginId: "manager.panel", enabled: true, config: { cascadeConfirm: true } },
				],
			});
		} finally {
			await runtime.dispose();
		}
	});

	it("fails Forbidden for a non-admin principal", async () => {
		const runtime = runtimeFor("admin@x.com");
		try {
			await expect(
				runtime.runPromise(
					loader().pipe(Effect.provideService(Principal, { userId: "u2", email: "user@x.com" })),
				),
			).rejects.toMatchObject({ _tag: "Forbidden" });
		} finally {
			await runtime.dispose();
		}
	});
});
