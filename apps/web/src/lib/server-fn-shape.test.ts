import { describe, expect, it } from "vitest";

// Every source file that may declare server functions: the host app,
// the plugins and the shared packages.
const sources = import.meta.glob(
	[
		"../**/*.{ts,tsx}",
		"../../../../plugins/*/src/**/*.{ts,tsx}",
		"../../../../packages/*/src/**/*.{ts,tsx}",
		"!**/*.test.*",
		"!**/paraglide/**",
		"!**/routeTree.gen.ts",
	],
	{ query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The only shape the TanStack Start compiler turns into an RPC stub. */
const TOP_LEVEL = /^export const \w+ = createServerFn\(/;

/** Lines of `code` that create a server function some other way. */
const misplaced = (code: string): number[] =>
	code
		.split("\n")
		.flatMap((line, index) =>
			line.includes("createServerFn(") && !TOP_LEVEL.test(line) ? [index + 1] : [],
		);

describe("server functions", () => {
	it("scans the app, the plugins and the packages", () => {
		const files = Object.keys(sources);
		expect(files).toContain("./fns.ts");
		expect(files.some((f) => f.endsWith("/plugins/auth/src/fns.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith("/packages/server-fns/src/session.ts"))).toBe(true);
		expect(files.some((f) => f.includes(".test."))).toBe(false);
	});

	it("flags a server function built by a factory, not a top-level one", () => {
		expect(
			misplaced(
				[
					'export const okFn = createServerFn({ method: "GET" }).handler(() => 1);',
					"const make = (action: string) =>",
					'\tcreateServerFn({ method: "POST" }).handler(() => action);',
					'const localFn = createServerFn({ method: "GET" }).handler(() => 2);',
				].join("\n"),
			),
		).toEqual([3, 4]);
	});

	// A `createServerFn` built anywhere else — inside a factory, a loop, a
	// local — is not compiled: the browser bundle keeps the real handler
	// (and the server code it reaches) and runs it client-side, where it
	// fails. Unit tests cannot see this, since they fake `createServerFn`.
	it("are each declared as a top-level `export const … = createServerFn(…)`", () => {
		const offenders = Object.entries(sources).flatMap(([file, code]) =>
			misplaced(code).map((line) => `${file}:${line}`),
		);
		expect(offenders).toEqual([]);
	});
});
