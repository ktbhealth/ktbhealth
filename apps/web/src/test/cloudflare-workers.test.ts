import { afterEach, describe, expect, it, vi } from "vitest";

import { audioBucketStore, audioQueueSent, env } from "./cloudflare-workers.ts";

// The module is the test double for `cloudflare:workers`; its fakes carry
// real logic (R2 put/get/delete, queue capture) that the route tests rely on.
type Bucket = {
	put: (k: string, v: ArrayBuffer | Uint8Array | ReadableStream, o?: unknown) => Promise<unknown>;
	get: (k: string) => Promise<{
		key: string;
		size: number;
		httpMetadata: { contentType?: string };
		body: ReadableStream | null;
		arrayBuffer: () => Promise<ArrayBufferLike>;
	} | null>;
	delete: (k: string | string[]) => Promise<void>;
};
const bucket = env.AUDIO_BUCKET as unknown as Bucket;

afterEach(() => {
	audioBucketStore.clear();
	audioQueueSent.length = 0;
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("fake R2 bucket", () => {
	it("stores Uint8Array, ArrayBuffer and stream values", async () => {
		await bucket.put("a", new Uint8Array([1, 2]), { httpMetadata: { contentType: "audio/webm" } });
		await bucket.put("b", new Uint8Array([3]).buffer);
		await bucket.put("c", new Response(new Uint8Array([4, 5, 6])).body!);
		expect([...audioBucketStore.get("a")!.data]).toEqual([1, 2]);
		expect(audioBucketStore.get("a")!.contentType).toBe("audio/webm");
		expect([...audioBucketStore.get("b")!.data]).toEqual([3]);
		expect(audioBucketStore.get("b")!.contentType).toBeUndefined();
		expect([...audioBucketStore.get("c")!.data]).toEqual([4, 5, 6]);
	});

	it("returns a readable object on get and null for a missing key", async () => {
		await bucket.put("k", new Uint8Array([7, 8, 9]), {
			httpMetadata: { contentType: "audio/wav" },
		});
		const obj = (await bucket.get("k"))!;
		expect(obj.key).toBe("k");
		expect(obj.size).toBe(3);
		expect(obj.httpMetadata.contentType).toBe("audio/wav");
		expect(new Uint8Array(await obj.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
		expect(new Uint8Array(await new Response(obj.body).arrayBuffer())).toEqual(
			new Uint8Array([7, 8, 9]),
		);
		expect(await bucket.get("missing")).toBeNull();
	});

	it("deletes one key or a list of keys", async () => {
		for (const k of ["x", "y", "z"]) await bucket.put(k, new Uint8Array([1]));
		await bucket.delete("x");
		expect([...audioBucketStore.keys()]).toEqual(["y", "z"]);
		await bucket.delete(["y", "z"]);
		expect(audioBucketStore.size).toBe(0);
	});
});

describe("fake queue and env", () => {
	it("records sent queue messages", async () => {
		await (env.AUDIO_QUEUE as { send: (b: unknown) => Promise<unknown> }).send({ id: 1 });
		expect(audioQueueSent).toEqual([{ id: 1 }]);
	});

	it("answers AI runs with a canned transcription", async () => {
		await expect(env.AI.run("m", {})).resolves.toEqual({ text: "transcrição do servidor" });
	});

	it("defaults the platform admin allowlist and honours an override", async () => {
		expect(env.PLATFORM_ADMIN_EMAILS).toBe(
			process.env.PLATFORM_ADMIN_EMAILS ?? "platform-admin@ktb.test",
		);
		vi.stubEnv("PLATFORM_ADMIN_EMAILS", "boss@ktb.test");
		vi.resetModules();
		const fresh = await import("./cloudflare-workers.ts");
		expect(fresh.env.PLATFORM_ADMIN_EMAILS).toBe("boss@ktb.test");
		vi.unstubAllEnvs();
		vi.stubEnv("PLATFORM_ADMIN_EMAILS", undefined as unknown as string);
		delete process.env.PLATFORM_ADMIN_EMAILS;
		vi.resetModules();
		const dflt = await import("./cloudflare-workers.ts");
		expect(dflt.env.PLATFORM_ADMIN_EMAILS).toBe("platform-admin@ktb.test");
	});
});
