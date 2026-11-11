import { describe, expect, it, vi } from "vitest";

import type { AudioStorageStats, QueueDepth } from "@ktb/server-fns";

// platform.ts reads the cloudflare:workers env once at composition and
// publishes the ops probes (audioQueueDepth/audioStorageStats) on the
// server runtime. Each scenario re-imports the module after rewiring
// the env double — vi.resetModules gives a fresh env + composition.

const DEPTH: QueueDepth = { pending: 1, processing: 2, done: 3, failed: 4 };
const STATS: AudioStorageStats = { objects: 2, bytes: 11, truncated: false };

const compose = async (configure: (env: Record<string, unknown>) => void) => {
	vi.resetModules();
	const { env } = await import("#/test/cloudflare-workers.ts");
	configure(env as Record<string, unknown>);
	await import("./platform.ts");
	const { getServerRuntime } = await import("@ktb/server-fns");
	return getServerRuntime();
};

describe("platform ops probes", () => {
	it(
		"publishes queue depth and storage stats probes when bindings support them",
		{ timeout: 30_000 }, // first compose pays the full app import cost
		async () => {
			let depthImpl: () => Promise<QueueDepth | null> = async () => DEPTH;
			const runtime = await compose((env) => {
				(env.AUDIO_QUEUE as Record<string, unknown>).stats = () => depthImpl();
				(env.AUDIO_BUCKET as Record<string, unknown>).list = async () => ({
					objects: [
						{ key: "a/1.webm", size: 5 },
						{ key: "b/2.webm", size: 6 },
					],
					truncated: false,
				});
			});

			expect(runtime.audioQueueDepth).toBeDefined();
			expect(runtime.audioStorageStats).toBeDefined();
			await expect(runtime.audioQueueDepth!()).resolves.toEqual(DEPTH);
			await expect(runtime.audioStorageStats!()).resolves.toEqual(STATS);

			// A rejecting stats probe collapses to null, never throws.
			depthImpl = () => Promise.reject(new Error("queue stats down"));
			await expect(runtime.audioQueueDepth!()).resolves.toBeNull();
		},
	);

	it("leaves the probes undefined when bindings cannot report", async () => {
		const runtime = await compose((env) => {
			// Queue without stats() and no bucket at all.
			env.AUDIO_QUEUE = { send: async () => ({}) };
			env.AUDIO_BUCKET = undefined;
		});

		expect(runtime.audioQueueDepth).toBeUndefined();
		expect(runtime.audioStorageStats).toBeUndefined();
	});
});
