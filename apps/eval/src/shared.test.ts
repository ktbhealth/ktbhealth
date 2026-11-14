import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as Effect from "effect/Effect";
import { Option } from "effect";
import { describe, expect, test } from "vitest";

import { PortError } from "@ktb/eval-core";

import { defaultContext, repoRoot } from "./context.ts";
import { UsageError } from "./errors.ts";
import {
	assertCapabilities,
	datasetVersionOf,
	intFlag,
	isTransientBatchError,
	localeFlag,
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

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const runErr = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));

describe("datasetVersionOf", () => {
	test("joins dataset id and version", () => {
		expect(datasetVersionOf(suite().manifest)).toBe("ds-v2");
	});
});

describe("selectProfile", () => {
	test("defaults to manifest.adapterProfile then stub", async () => {
		expect(await run(selectProfile(Option.none(), suite({ adapterProfile: "local" })))).toBe(
			"local",
		);
		expect(await run(selectProfile(Option.none(), suite()))).toBe("stub");
		expect(await run(selectProfile(Option.some("cloud"), suite({ adapterProfile: "local" })))).toBe(
			"cloud",
		);
	});

	test("unknown profile is a UsageError listing known profiles", async () => {
		const err = await runErr(selectProfile(Option.some("nope"), suite()));
		expect(err).toBeInstanceOf(UsageError);
		expect(err.message).toMatch(/stub, local, local-systemone, cloud/);
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
	test("passes when needed caps are resolved", async () => {
		const s = suite({ caps: { asr: "transcription.asr" } });
		const { resolution } = resolveFor(s, "stub");
		await expect(run(assertCapabilities(s, resolution, ["asr"]))).resolves.toBeUndefined();
	});

	test("fails naming every missing ref", async () => {
		const s = suite({ caps: { ghost: "x" } });
		const { resolution } = resolveFor(s, "stub");
		const err = await runErr(assertCapabilities(s, resolution, ["ghost"]));
		expect(err.message).toMatch(/capability "ghost" \(no registered contribution\)/);
	});
});

describe("intFlag", () => {
	test("absent flag returns the default even below the floor", async () => {
		expect(await run(intFlag("limit", Option.none(), 0, 1))).toBe(0);
	});

	test("present flag must be an integer >= min", async () => {
		expect(await run(intFlag("limit", Option.some(3), 0, 1))).toBe(3);
		const err = await runErr(intFlag("limit", Option.some(0), 0, 1));
		expect(err).toBeInstanceOf(UsageError);
		expect(err.message).toMatch(/--limit must be an integer >= 1/);
	});
});

describe("localeFlag", () => {
	test("defaults to pt-BR and resolves known locales", async () => {
		expect((await run(localeFlag(Option.none()))).id).toBe("ptbr-v1");
		expect((await run(localeFlag(Option.some("pt-BR")))).asrLanguage).toBe("pt");
	});

	test("unknown locale is a UsageError listing the known set", async () => {
		const err = await runErr(localeFlag(Option.some("en")));
		expect(err).toBeInstanceOf(UsageError);
		expect(err.message).toMatch(/unknown --locale en/);
	});
});

describe("isTransientBatchError", () => {
	test("deterministic domain ports are permanent; everything else retries", () => {
		for (const port of ["phi", "pipeline", "generate"]) {
			expect(isTransientBatchError(new PortError({ port, message: "x" }))).toBe(false);
		}
		expect(isTransientBatchError(new PortError({ port: "asr", message: "x" }))).toBe(true);
		expect(isTransientBatchError(new PortError({ port: "tts", message: "x" }))).toBe(true);
		expect(isTransientBatchError(new Error("boom"))).toBe(true);
	});
});

describe("workdirFlag", () => {
	test("defaults under os.tmpdir()", async () => {
		const w = await run(workdirFlag(Option.none()));
		expect(w.startsWith(path.resolve(os.tmpdir()))).toBe(true);
	});

	test("accepts a scratch path under tmpdir", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-wd-"));
		fs.rmSync(dir, { recursive: true, force: true });
		expect(await run(workdirFlag(Option.some(dir)))).toBe(dir);
	});

	test("rejects non-scratch paths", async () => {
		const err = await runErr(workdirFlag(Option.some("/etc")));
		expect(err).toBeInstanceOf(UsageError);
		expect(err.message).toMatch(/--workdir must live/);
	});
});

test("repoRoot resolves to the monorepo root", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), "package.json"), "utf8")) as {
		name?: string;
	};
	expect(pkg.name).toBe("ktb");
});

test("defaultContext derives evalsDir under repoRoot", () => {
	const c = defaultContext();
	expect(c.evalsDir).toBe(`${repoRoot()}evals`);
	expect(c.repoRoot).toBe(repoRoot());
});
