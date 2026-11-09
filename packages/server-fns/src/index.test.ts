import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";

import {
	getServerRuntime,
	purgeAudio,
	resetServerRuntime,
	run,
	runAs,
	setServerRuntime,
	type AudioDeleter,
	type ServerRuntime,
} from "./index.ts";

// The stub runs effects that carry no requirements; ServerRuntime.run
// accepts `unknown` requirements so plugins can pass provisioned layers.
const runPromise = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
	Effect.runPromise(effect as Effect.Effect<A, E, never>);

const stubRuntime = (overrides: Partial<ServerRuntime> = {}): ServerRuntime => ({
	run: runPromise,
	runAs: (_user, effect) => runPromise(effect),
	getLocale: () => "en",
	...overrides,
});

describe("server runtime registry", () => {
	it("throws when unset", () => {
		resetServerRuntime();
		expect(() => getServerRuntime()).toThrow("runtime not initialized");
		expect(() => run(Effect.void)).toThrow("runtime not initialized");
	});

	it("delegates run/runAs to the registered runtime", async () => {
		resetServerRuntime();
		const seen: string[] = [];
		setServerRuntime(
			stubRuntime({
				run: (effect) => {
					seen.push("run");
					return runPromise(effect);
				},
				runAs: (user, effect) => {
					seen.push(`runAs:${user.id}`);
					return runPromise(effect);
				},
			}),
		);
		await expect(run(Effect.succeed(1))).resolves.toBe(1);
		await expect(runAs({ id: "u1" }, Effect.succeed(2))).resolves.toBe(2);
		expect(seen).toEqual(["run", "runAs:u1"]);
	});
});

describe("purgeAudio", () => {
	it("returns [] for no keys", async () => {
		expect(await purgeAudio(undefined, [])).toEqual([]);
	});

	it("returns all keys when no bucket is bound", async () => {
		expect(await purgeAudio(undefined, ["a", "b"])).toEqual(["a", "b"]);
	});

	it("deletes in batches of 1000 and reports failed batches", async () => {
		const calls: string[][] = [];
		const keys = Array.from({ length: 1500 }, (_, i) => `k${i}`);
		const bucket: AudioDeleter = {
			delete: async (batch) => {
				calls.push([...batch]);
				if (batch.length === 500) throw new Error("r2 down");
			},
		};
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const failed = await purgeAudio(bucket, keys);
		expect(calls.map((c) => c.length)).toEqual([1000, 500]);
		expect(failed).toEqual(keys.slice(1000));
		error.mockRestore();
	});
});
