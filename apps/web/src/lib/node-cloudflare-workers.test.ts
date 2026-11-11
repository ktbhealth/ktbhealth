import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
	"KTB_DEV_QUEUE_DB",
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
		process.env.KTB_DEV_QUEUE_DB = ":memory:";
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
		process.env.KTB_DEV_QUEUE_DB = ":memory:";
		process.env.AI_STUB = "1";
		process.env.BETTER_AUTH_SECRET = "s3cret";

		const env = await loadEnv();
		expect(env.BETTER_AUTH_SECRET).toBe("s3cret");
		expect(typeof env.AI.run).toBe("function");
		await expect(env.AI.run("m", { audio: "aGk=" })).resolves.toEqual({
			text: "[AI_STUB] stub transcription",
		});
	});

	it("loads apps/web/.dev.vars at boot and logs key names only", async () => {
		// The module merges ../../.dev.vars (relative to src/lib) into
		// process.env once, at evaluation. Back up any real file first —
		// devs may have secrets there.
		const devVarsPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../.dev.vars");
		const hadFile = existsSync(devVarsPath);
		const backup = hadFile ? readFileSync(devVarsPath) : undefined;
		writeFileSync(devVarsPath, 'KT_DEVVARS_FROM_FILE="loaded"\n', { mode: 0o600 });
		delete process.env.KT_DEVVARS_FROM_FILE;
		try {
			process.env.DATABASE_URL = ":memory:";
			vi.stubEnv("KTB_DEV_QUEUE_DB", ":memory:");
			const info = vi.spyOn(console, "info").mockImplementation(() => {});
			const env = await loadEnv();
			expect(process.env.KT_DEVVARS_FROM_FILE).toBe("loaded");
			expect(info).toHaveBeenCalledWith("[dev:node] loaded .dev.vars (1 keys)");
			expect(typeof env.DB.prepare).toBe("function");
		} finally {
			delete process.env.KT_DEVVARS_FROM_FILE;
			if (backup === undefined) rmSync(devVarsPath, { force: true });
			else writeFileSync(devVarsPath, backup);
		}
	});

	it("defaults the queue db to ./data/queue.db when KTB_DEV_QUEUE_DB is unset", async () => {
		process.env.DATABASE_URL = ":memory:";
		vi.stubEnv("KTB_DEV_QUEUE_DB", undefined);
		audioDir = mkdtempSync(join(tmpdir(), "ktb-node-env-"));
		process.env.AUDIO_BUCKET_DIR = audioDir;

		// The default path is apps/web/data/queue.db (gitignored) — the
		// same file `dev:node` opens. Remove the sqlite sidecars after.
		const queueDb = resolve(dirname(fileURLToPath(import.meta.url)), "../../data/queue.db");
		const env = await loadEnv();
		expect(typeof env.AUDIO_QUEUE.send).toBe("function");
		for (const suffix of ["", "-wal", "-shm"]) {
			rmSync(`${queueDb}${suffix}`, { force: true });
		}
	});

	it("AUDIO_QUEUE.send dispatches to the audio job consumer", async () => {
		// DATABASE_URL deliberately unset → covers the ./data/app.db
		// default (the same file `dev:node` opens; migrations are
		// idempotent). env.DB itself is unused by this test.
		vi.stubEnv("DATABASE_URL", undefined);
		vi.stubEnv("KTB_DEV_QUEUE_DB", ":memory:");
		audioDir = mkdtempSync(join(tmpdir(), "ktb-node-env-"));
		process.env.AUDIO_BUCKET_DIR = audioDir;

		const env = await loadEnv();
		// Unknown consultation → consumer marks the job failed and acks.
		// Under vitest the lazy audio-jobs import resolves platform.ts
		// against the test cloudflare:workers double (test D1 + fakes).
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		await env.AUDIO_QUEUE.send({ consultationId: 999999, audioKey: "k", userId: "u" });
		await vi.waitFor(
			() =>
				expect(info).toHaveBeenCalledWith("[dev:node] queue batch processed", {
					done: 1,
					total: 1,
				}),
			// The consumer lazily imports ./audio-jobs.ts — a cold vite
			// transform of the platform graph that can exceed 10s under
			// parallel load. Generous timeout; the assertion itself is
			// unchanged.
			{ timeout: 30000 },
		);
	}, 45000);
});
