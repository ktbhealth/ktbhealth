import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const staticSiteCalls: Array<{ name: string; spec: Record<string, unknown> }> = [];
const d1Calls: Array<{ name: string; spec: Record<string, unknown> }> = [];

vi.mock("@alchemy.run/cloudflare", () => ({
	Website: {
		StaticSite: (name: string, spec: Record<string, unknown>) =>
			Effect.sync(() => {
				staticSiteCalls.push({ name, spec });
				return { url: `https://${name}.example.com` };
			}),
	},
	D1: {
		Database: (name: string, spec: Record<string, unknown>) =>
			Effect.sync(() => {
				d1Calls.push({ name, spec });
				return { name };
			}),
	},
}));

import { deployD1, deployStaticSite, deployWorker } from "./index.ts";

describe("infra ports and cloudflare adapter", () => {
	beforeEach(() => {
		staticSiteCalls.length = 0;
		d1Calls.length = 0;
	});

	it("exports deploy functions", () => {
		expect(typeof deployStaticSite).toBe("function");
		expect(typeof deployWorker).toBe("function");
		expect(typeof deployD1).toBe("function");
	});

	it("deployStaticSite uses default build command and returns url", async () => {
		const out = await Effect.runPromise(
			deployStaticSite({ name: "site-a", outdir: "dist" }),
		);
		expect(out.url).toBe("https://site-a.example.com");
		expect(staticSiteCalls[0]).toEqual({
			name: "site-a",
			spec: { command: "bun run build", outdir: "dist" },
		});
	});

	it("deployStaticSite honors a custom command", async () => {
		await Effect.runPromise(
			deployStaticSite({ name: "site-b", outdir: "public", command: "make site" }),
		);
		expect(staticSiteCalls[0]?.spec.command).toBe("make site");
	});

	it("deployWorker maps bindings and compatibility flags", async () => {
		const out = await Effect.runPromise(
			deployWorker({
				name: "worker-a",
				outdir: "dist",
				main: "src/entry.ts",
				bindings: { DB: "d1-handle" },
				compatibilityFlags: ["nodejs_compat"],
			}),
		);
		expect(out.url).toBe("https://worker-a.example.com");
		expect(staticSiteCalls[0]?.spec).toMatchObject({
			command: "bun run build",
			outdir: "dist",
			main: "src/entry.ts",
			env: { DB: "d1-handle" },
			compatibility: { flags: ["nodejs_compat"] },
		});
	});

	it("deployWorker omits env and compatibility when unset", async () => {
		await Effect.runPromise(
			deployWorker({ name: "worker-b", outdir: "dist", main: "main.ts" }),
		);
		expect(staticSiteCalls[0]?.spec.env).toBeUndefined();
		expect(staticSiteCalls[0]?.spec.compatibility).toBeUndefined();
	});

	it("deployD1 passes the migrations dir", async () => {
		const out = await Effect.runPromise(
			deployD1({ name: "db-a", migrationsDir: "packages/db/drizzle" }),
		);
		expect(out.db).toEqual({ name: "db-a" });
		expect(d1Calls[0]).toEqual({
			name: "db-a",
			spec: { migrations: "packages/db/drizzle" },
		});
	});
});
