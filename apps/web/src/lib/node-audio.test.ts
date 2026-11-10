import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeLocalAudioBucket, makeLocalAudioQueue } from "./node-audio.ts";

let dir: string | undefined;
const bucketDir = () => {
	dir ??= mkdtempSync(join(tmpdir(), "ktb-audio-"));
	return dir;
};

afterEach(() => {
	if (dir !== undefined) {
		rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	}
	vi.restoreAllMocks();
});

describe("makeLocalAudioBucket", () => {
	it("round-trips bytes with content type metadata", async () => {
		const bucket = makeLocalAudioBucket(bucketDir());
		const bytes = new TextEncoder().encode("fake-audio-bytes");
		await bucket.put("audio/u1/42/abc.wav", bytes, {
			httpMetadata: { contentType: "audio/wav" },
		});

		const object = await bucket.get("audio/u1/42/abc.wav");
		expect(object).not.toBeNull();
		expect(object!.size).toBe(bytes.byteLength);
		expect(object!.httpMetadata?.contentType).toBe("audio/wav");
		expect(new Uint8Array(await object!.arrayBuffer())).toEqual(bytes);
		// body stream carries the same payload (route GET path).
		expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(bytes);
	});

	it("returns null for missing keys and deletes objects + meta", async () => {
		const bucket = makeLocalAudioBucket(bucketDir());
		expect(await bucket.get("nope.bin")).toBeNull();

		await bucket.put("a/b/c.bin", new Uint8Array([1, 2, 3]), {
			httpMetadata: { contentType: "application/octet-stream" },
		});
		const file = join(bucketDir(), "a", "b", "c.bin");
		expect(existsSync(file)).toBe(true);
		expect(existsSync(file + ".ktb-meta.json")).toBe(true);

		await bucket.delete(["a/b/c.bin"]);
		expect(await bucket.get("a/b/c.bin")).toBeNull();
		expect(existsSync(file)).toBe(false);
		expect(existsSync(file + ".ktb-meta.json")).toBe(false);
	});

	it("accepts ArrayBuffer and ReadableStream values; overwrite clears stale meta", async () => {
		const bucket = makeLocalAudioBucket(bucketDir());
		const ab = new Uint8Array([9, 8, 7]).buffer;
		await bucket.put("x.bin", ab, { httpMetadata: { contentType: "text/plain" } });
		await bucket.put(
			"x.bin",
			new ReadableStream({
				start(c) {
					c.enqueue(new Uint8Array([1]));
					c.close();
				},
			}),
		);
		const object = await bucket.get("x.bin");
		expect(object!.httpMetadata?.contentType).toBeUndefined();
		expect(new Uint8Array(await object!.arrayBuffer())).toEqual(new Uint8Array([1]));
	});

	it("rejects keys that escape the storage dir or are invalid", async () => {
		const bucket = makeLocalAudioBucket(bucketDir());
		await expect(bucket.put("../escape.bin", new Uint8Array([1]))).rejects.toThrow(
			/escapes storage dir/,
		);
		await expect(bucket.get("/etc/passwd")).rejects.toThrow(/escapes storage dir/);
		await expect(bucket.put("", new Uint8Array([1]))).rejects.toThrow(/invalid audio key/);
		await expect(bucket.put("a\0b.bin", new Uint8Array([1]))).rejects.toThrow(/invalid audio key/);
		// "." resolves to the bucket root itself — writeFile fails EISDIR.
		await expect(bucket.put(".", new Uint8Array([1]))).rejects.toThrow(/illegal operation|EISDIR/);
	});

	it("surfaces non-ENOENT read errors and accepts a single delete key", async () => {
		const bucket = makeLocalAudioBucket(bucketDir());
		// "blocked" as a plain file makes "blocked/x.bin" an ENOTDIR read.
		writeFileSync(join(bucketDir(), "blocked"), "not a dir");
		await expect(bucket.get("blocked/x.bin")).rejects.toThrow(/ENOTDIR|not a directory/);

		await bucket.put("solo.bin", new Uint8Array([5]), {
			httpMetadata: { contentType: "application/octet-stream" },
		});
		await bucket.delete("solo.bin");
		expect(await bucket.get("solo.bin")).toBeNull();
	});

	it("ignores malformed sidecar metadata", async () => {
		const bucket = makeLocalAudioBucket(bucketDir());
		await bucket.put("meta.bin", new Uint8Array([1]), {
			httpMetadata: { contentType: "text/plain" },
		});
		writeFileSync(join(bucketDir(), "meta.bin.ktb-meta.json"), '{"contentType":123}');
		const object = await bucket.get("meta.bin");
		expect(object!.httpMetadata?.contentType).toBeUndefined();
	});
});

describe("makeLocalAudioQueue", () => {
	it("send() resolves immediately and delivers the body to the handler", async () => {
		const seen: unknown[] = [];
		const queue = makeLocalAudioQueue(async () => async (messages) => {
			for (const m of messages) {
				seen.push(m.body);
				m.ack();
			}
		});
		const result = await queue.send({ consultationId: 1, audioKey: "k", userId: "u" });
		expect(result).toEqual({});
		await vi.waitFor(() => expect(seen).toHaveLength(1));
		expect(seen[0]).toEqual({ consultationId: 1, audioKey: "k", userId: "u" });
	});

	it("re-delivers on retry() up to the attempt cap, then drops", async () => {
		vi.useFakeTimers();
		try {
			let calls = 0;
			const queue = makeLocalAudioQueue(async () => async (messages) => {
				calls++;
				for (const m of messages) m.retry();
			});
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			await queue.send({ n: 1 });
			// Drive the retry loop: each failed attempt waits RETRY_DELAY_MS*attempt.
			for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1000);
			expect(calls).toBe(3);
			expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("dropping audio job"), {
				n: 1,
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it("handler load failures are retried like delivery failures", async () => {
		vi.useFakeTimers();
		try {
			let loads = 0;
			const queue = makeLocalAudioQueue(async () => {
				loads++;
				throw new Error("boom");
			});
			vi.spyOn(console, "error").mockImplementation(() => {});
			await queue.send({ n: 2 });
			for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(1000);
			expect(loads).toBe(3);
		} finally {
			vi.useRealTimers();
		}
	});
});
