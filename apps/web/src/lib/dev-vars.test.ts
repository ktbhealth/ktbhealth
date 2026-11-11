import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDevVars, parseDevVars } from "./dev-vars.ts";

let dir: string | undefined;
const tempFile = (content: string) => {
	dir ??= mkdtempSync(join(tmpdir(), "ktb-dev-vars-"));
	const file = join(dir, ".dev.vars");
	writeFileSync(file, content, { mode: 0o600 });
	return file;
};

const TEST_KEYS = ["KT_DEVVARS_A", "KT_DEVVARS_B", "KT_DEVVARS_C", "KT_DEVVARS_D"] as const;
const saved: Record<string, string | undefined> = {};
for (const key of TEST_KEYS) saved[key] = process.env[key];

afterEach(() => {
	for (const key of TEST_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	if (dir !== undefined) {
		rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	}
});

describe("parseDevVars", () => {
	it("parses bare, double-quoted and single-quoted values", () => {
		const vars = parseDevVars(
			[
				"KT_DEVVARS_A=plain",
				'KT_DEVVARS_B="value with spaces"',
				"KT_DEVVARS_C='single quoted'",
				'KT_DEVVARS_D="escaped \\"quote\\" and \\\\ backslash"',
			].join("\n"),
		);
		expect(vars).toEqual({
			KT_DEVVARS_A: "plain",
			KT_DEVVARS_B: "value with spaces",
			KT_DEVVARS_C: "single quoted",
			KT_DEVVARS_D: 'escaped "quote" and \\ backslash',
		});
	});

	it("skips comments, blanks and malformed lines; keeps '=' inside values", () => {
		const vars = parseDevVars(
			[
				"# a comment",
				"",
				"   ",
				"not a var line",
				"=novalue",
				"1BAD=key",
				"KT_DEVVARS_A=a=b=c",
			].join("\n"),
		);
		expect(vars).toEqual({ KT_DEVVARS_A: "a=b=c" });
	});

	it("later duplicate keys win; unclosed quotes fall back to stripped quotes", () => {
		const vars = parseDevVars('KT_DEVVARS_A=first\nKT_DEVVARS_A="second"\nKT_DEVVARS_B="unclosed');
		expect(vars.KT_DEVVARS_A).toBe("second");
		expect(vars.KT_DEVVARS_B).toBe('"unclosed');
	});

	it("double-quoted values that are not valid JSON fall back to stripped quotes", () => {
		// `""x""` starts and ends with a quote but JSON.parse rejects it.
		const vars = parseDevVars('KT_DEVVARS_A=""x""');
		expect(vars.KT_DEVVARS_A).toBe('"x"');
	});
});

describe("loadDevVars", () => {
	it("returns [] for a missing file and does not touch process.env", () => {
		delete process.env.KT_DEVVARS_A;
		expect(loadDevVars(join(tmpdir(), "ktb-definitely-missing.dev.vars"))).toEqual([]);
		expect(process.env.KT_DEVVARS_A).toBeUndefined();
	});

	it("applies new keys and never overrides existing env vars", () => {
		process.env.KT_DEVVARS_A = "from-env";
		const file = tempFile('KT_DEVVARS_A="from-file"\nKT_DEVVARS_B="from file"\n# comment\n');
		const applied = loadDevVars(file);
		expect(applied).toEqual(["KT_DEVVARS_B"]);
		expect(process.env.KT_DEVVARS_A).toBe("from-env");
		expect(process.env.KT_DEVVARS_B).toBe("from file");
	});

	it("returns [] when the path exists but cannot be read as a file", () => {
		// A directory passes existsSync but readFileSync throws (EISDIR).
		expect(loadDevVars(tmpdir())).toEqual([]);
	});
});
