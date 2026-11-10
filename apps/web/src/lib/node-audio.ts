import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Node/Bun stand-ins for the Cloudflare bindings that have no workerd
 * equivalent under `KTB_DEV_NODE=1` (see node-cloudflare-workers.ts):
 *
 * - {@link makeLocalAudioBucket}: filesystem-backed R2Bucket slice —
 *   objects land as plain files under a gitignored data dir, with a
 *   `.ktb-meta.json` sidecar carrying `httpMetadata.contentType`.
 * - {@link makeLocalAudioQueue}: in-process Queue producer — `send()`
 *   returns immediately (like the real binding) and dispatches the
 *   message to the consumer handler in the background, with bounded
 *   retries standing in for Cloudflare's retry/DLQ — exhausted messages
 *   go to a dead-letter dir as JSON files when one is configured.
 *
 * Both are plain deploy glue for apps/web — no ports/adapters involved.
 */

/** Sidecar suffix storing `{ contentType }` next to each object file. */
const META_SUFFIX = ".ktb-meta.json";

/** Resolve an object key to a path inside `dir`; rejects traversal. */
const keyPath = (dir: string, key: string): string => {
	if (key === "" || key.includes("\0"))
		throw new Error(`invalid audio key: ${JSON.stringify(key)}`);
	const file = resolve(dir, key);
	if (file !== dir && !file.startsWith(dir + sep)) {
		throw new Error(`audio key escapes storage dir: ${JSON.stringify(key)}`);
	}
	return file;
};

const toBytes = async (value: ArrayBuffer | Uint8Array | ReadableStream): Promise<Uint8Array> => {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return new Uint8Array(await new Response(value).arrayBuffer());
};

const readMeta = async (file: string): Promise<string | undefined> => {
	try {
		const meta = JSON.parse(await readFile(file + META_SUFFIX, "utf8")) as {
			contentType?: unknown;
		};
		return typeof meta.contentType === "string" ? meta.contentType : undefined;
	} catch {
		return undefined;
	}
};

/**
 * Filesystem-backed slice of R2Bucket covering what the audio routes
 * and purge path use: `put` (ArrayBuffer/Uint8Array/ReadableStream +
 * httpMetadata.contentType), `get` (body stream + size + arrayBuffer,
 * R2ObjectBody-compatible), `delete` (single key or batch).
 */
export const makeLocalAudioBucket = (dir: string) => {
	const root = resolve(dir);
	return {
		put: async (
			key: string,
			value: ArrayBuffer | Uint8Array | ReadableStream,
			options?: { readonly httpMetadata?: { readonly contentType?: string } },
		): Promise<unknown> => {
			const file = keyPath(root, key);
			const bytes = await toBytes(value);
			await mkdir(dirname(file), { recursive: true });
			await writeFile(file, bytes);
			const contentType = options?.httpMetadata?.contentType;
			if (contentType !== undefined) {
				await writeFile(file + META_SUFFIX, JSON.stringify({ contentType }));
			} else {
				// Overwrite of a previously typed object must not leak stale meta.
				await rm(file + META_SUFFIX, { force: true });
			}
			return {};
		},
		get: async (key: string) => {
			const file = keyPath(root, key);
			let bytes: Uint8Array;
			try {
				bytes = await readFile(file);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw error;
			}
			const contentType = await readMeta(file);
			// Exact-copy ArrayBuffer: Buffer pooling and stream bodies both
			// need a buffer that starts at offset 0.
			const buffer = bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer;
			return {
				key,
				size: bytes.byteLength,
				httpMetadata: { contentType },
				body: new Response(buffer).body as ReadableStream,
				arrayBuffer: async () => buffer.slice(0),
			};
		},
		delete: async (keys: string | string[]): Promise<void> => {
			for (const key of Array.isArray(keys) ? keys : [keys]) {
				const file = keyPath(root, key);
				await rm(file, { force: true });
				await rm(file + META_SUFFIX, { force: true });
			}
		},
	};
};

/** Shape the queue consumer expects (handleAudioQueueBatch input). */
interface LocalQueueMessage {
	readonly body: unknown;
	ack(): void;
	retry(): void;
}

export type LocalQueueHandler = (messages: readonly LocalQueueMessage[]) => Promise<void>;

/** Stand-in for Cloudflare's retry budget before a message is dropped. */
const MAX_DELIVERY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;

/**
 * Filesystem-free Queue producer stand-in. `send()` resolves as soon as
 * the message is accepted (the real binding's contract) and delivers it
 * to the consumer handler asynchronously — one message per batch, which
 * is all the audio pipeline produces. `retry()` re-delivers the same
 * body up to {@link MAX_DELIVERY_ATTEMPTS} times (Cloudflare would
 * retry then dead-letter; dev:node logs and drops instead — or writes
 * the body to `deadLetterDir` as a JSON file when that dir is set).
 */
export const makeLocalAudioQueue = (
	loadHandler: () => Promise<LocalQueueHandler>,
	deadLetterDir?: string,
) => ({
	send: (body: unknown): Promise<unknown> => {
		const deliver = async (): Promise<boolean> => {
			const handler = await loadHandler();
			let acked = false;
			await handler([
				{
					body,
					ack: () => {
						acked = true;
					},
					retry: () => {},
				},
			]);
			return acked;
		};
		void (async () => {
			for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
				try {
					if (await deliver()) {
						console.info("[dev:node] audio job processed", body);
						return;
					}
				} catch (error) {
					console.error("[dev:node] audio job dispatch failed", { attempt, error });
				}
				if (attempt < MAX_DELIVERY_ATTEMPTS) {
					await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
				}
			}
			console.error(
				"[dev:node] dropping audio job after retries (Cloudflare Queue would dead-letter)",
				body,
			);
			if (deadLetterDir !== undefined) {
				try {
					await mkdir(deadLetterDir, { recursive: true });
					const file = resolve(deadLetterDir, `${Date.now()}-${randomUUID()}.json`);
					await writeFile(file, JSON.stringify({ body, attempts: MAX_DELIVERY_ATTEMPTS }));
					console.info("[dev:node] audio job dead-lettered to", file);
				} catch (error) {
					console.error("[dev:node] failed to write audio job dead-letter", error);
				}
			}
		})();
		return Promise.resolve({});
	},
});
