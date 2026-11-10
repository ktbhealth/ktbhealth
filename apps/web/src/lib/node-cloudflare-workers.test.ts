import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The module is the dev:node stand-in for `cloudflare:workers` — it is
 * only reachable through the vite alias (vitest aliases the specifier
 * to src/test/cloudflare-workers.ts instead), so it is imported
 * directly here. Env is read once at module evaluation: each test
 * resets modules and re-imports with the process.env it needs.
 */

const ENV_KEYS = [
	"DATABASE_URL",
	"AUDIO_BUCKET_DIR",
	"AI_STUB",
	"AI_BASE_URL",
	"BETTER_AUTH_SECRET",
] as const;

const saved: Record<string, string | undefined> = {};
let audioDir: string | undefined;

for (const key of ENV_KEYS) saved[key] = process.env[key];

const loadEnv = async () => {
	vi.resetModules();
	const mod = await import("./node-cloudflare-workers.ts");
	return mod.env as Record<string, any>;
};

afterEach(() => {
	vi.unstubAllEnvs();
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	if (audioDir !== undefined) {
		rmSync(audioDir, { recursive: true, force: true });
		audioDir = undefined;
	}
	vi.resetModules();
});

describe("node-cloudflare-workers env", () => {
	it("exposes DB, AUDIO_BUCKET and AUDIO_QUEUE; AI stays unset unconfigured", async () => {
		process.env.DATABASE_URL = ":memory:";
		audioDir = mkdtempSync(join(tmpdir(), "ktb-node-env-"));
		process.env.AUDIO_BUCKET_DIR = audioDir;
		delete process.env.AI_STUB;
		delete process.env.AI_BASE_URL;

		const env = await loadEnv();
		expect(typeof env.DB.prepare).toBe("function");
		expect(typeof env.AUDIO_BUCKET.put).toBe("function");
		expect(typeof env.AUDIO_BUCKET.get).toBe("function");
		expect(typeof env.AUDIO_BUCKET.delete).toBe("function");
		expect(typeof env.AUDIO_QUEUE.send).toBe("function");
		expect(env.AI).toBeUndefined();

		// The bucket writes under AUDIO_BUCKET_DIR.
		await env.AUDIO_BUCKET.put("k.bin", new Uint8Array([1, 2]));
		const object = await env.AUDIO_BUCKET.get("k.bin");
		expect(object.size).toBe(2);
	});

	it("forwards plain config keys and resolves AI_STUB into env.AI", async () => {
		process.env.DATABASE_URL = ":memory:";
		process.env.AI_STUB = "1";
		process.env.BETTER_AUTH_SECRET = "s3cret";

		const env = await loadEnv();
		expect(env.BETTER_AUTH_SECRET).toBe("s3cret");
		expect(typeof env.AI.run).toBe("function");
		await expect(env.AI.run("m", { audio: "aGk=" })).resolves.toEqual({
			text: "[AI_STUB] stub transcription",
		});
	});

	it("AUDIO_QUEUE.send dispatches to the audio job consumer", async () => {
		// DATABASE_URL deliberately unset → covers the ./data/app.db
		// default (the same file `dev:node` opens; migrations are
		// idempotent). env.DB itself is unused by this test.
		vi.stubEnv("DATABASE_URL", undefined);
		audioDir = mkdtempSync(join(tmpdir(), "ktb-node-env-"));
		process.env.AUDIO_BUCKET_DIR = audioDir;

		const env = await loadEnv();
		// Unknown consultation → consumer marks the job failed and acks.
		// Under vitest the lazy audio-jobs import resolves platform.ts
		// against the test cloudflare:workers double (test D1 + fakes).
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		await env.AUDIO_QUEUE.send({ consultationId: 999999, audioKey: "k", userId: "u" });
		await vi.waitFor(
			() => expect(info).toHaveBeenCalledWith("[dev:node] audio job processed", expect.anything()),
			{ timeout: 10000 },
		);
	});
});
