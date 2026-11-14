import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, test } from "vitest";

import { UsageError } from "./args.ts";
import { repoRoot } from "./context.ts";
import {
	assertCapabilities,
	datasetVersionOf,
	resolveFor,
	selectProfile,
	workdirFlag,
} from "./shared.ts";
import type { LoadedSuite } from "./suites.ts";
import { defineSuite } from "@ktb/eval-core";

const suite = (over: Record<string, unknown> = {}): LoadedSuite => ({
	file: "<test>",
	manifest: defineSuite({
		id: "s",
		domain: "d",
		dataset: { id: "ds", version: "v2" },
		stages: [],
		caps: {},
		metrics: [],
		gates: [],
		schemaVersion: 1,
		...over,
	}),
});

const args = (flags: Record<string, string | number | boolean | undefined> = {}) => ({
	positional: {},
	flags,
});

describe("datasetVersionOf", () => {
	test("joins dataset id and version", () => {
		expect(datasetVersionOf(suite().manifest)).toBe("ds-v2");
	});
});

describe("selectProfile", () => {
	test("defaults to manifest.adapterProfile then stub", () => {
		expect(selectProfile(args(), suite({ adapterProfile: "local" }))).toBe("local");
		expect(selectProfile(args(), suite())).toBe("stub");
		expect(selectProfile(args({ profile: "cloud" }), suite({ adapterProfile: "local" }))).toBe(
			"cloud",
		);
	});

	test("unknown profile is a UsageError listing known profiles", () => {
		expect(() => selectProfile(args({ profile: "nope" }), suite())).toThrow(UsageError);
		expect(() => selectProfile(args({ profile: "nope" }), suite())).toThrow(/stub, local, cloud/);
	});
});

describe("resolveFor", () => {
	test("returns profile + resolution", () => {
		const r = resolveFor(suite({ caps: { asr: "transcription.asr" } }), "stub");
		expect(r.profile).toBe("stub");
		expect(r.resolution.adapters.asr).toBe("stub");
	});
});

describe("assertCapabilities", () => {
	test("passes when needed caps are resolved", () => {
		const s = suite({ caps: { asr: "transcription.asr" } });
		const { resolution } = resolveFor(s, "stub");
		expect(() => assertCapabilities(s, resolution, ["asr"])).not.toThrow();
	});

	test("throws naming every missing ref", () => {
		const s = suite({ caps: { ghost: "x" } });
		const { resolution } = resolveFor(s, "stub");
		expect(() => assertCapabilities(s, resolution, ["ghost"])).toThrow(
			/capability "ghost" \(no registered contribution\)/,
		);
	});
});

describe("workdirFlag", () => {
	test("defaults under os.tmpdir()", () => {
		const w = workdirFlag(args());
		expect(w.startsWith(path.resolve(os.tmpdir()))).toBe(true);
	});

	test("accepts a scratch path under tmpdir", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-wd-"));
		fs.rmSync(dir, { recursive: true, force: true });
		expect(workdirFlag(args({ workdir: dir }))).toBe(dir);
	});

	test("rejects non-scratch paths", () => {
		expect(() => workdirFlag(args({ workdir: "/etc" }))).toThrow(UsageError);
		expect(() => workdirFlag(args({ workdir: "/home/user/data" }))).toThrow(/--workdir must live/);
	});
});

test("repoRoot resolves to the monorepo root", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), "package.json"), "utf8")) as {
		name?: string;
	};
	expect(pkg.name).toBe("ktb");
});
