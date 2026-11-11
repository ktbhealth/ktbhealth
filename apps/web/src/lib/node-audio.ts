import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Node/Bun stand-in for the Cloudflare bindings that have no workerd
 * equivalent under `KTB_DEV_NODE=1` (see node-cloudflare-workers.ts):
 *
 * - {@link makeLocalAudioBucket}: filesystem-backed R2Bucket slice —
 *   objects land as plain files under a gitignored data dir, with a
 *   `.ktb-meta.json` sidecar carrying `httpMetadata.contentType`.
 *
 * The Queue producer stand-in lives in node-queue.ts (SQLite-backed,
 * restart-persistent). Both are plain deploy glue for apps/web — no
 * ports/adapters involved.
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
 * Filesystem-backed slice of R2Bucket covering what the audio routes,
 * purge path and ops stats probe use: `put` (ArrayBuffer/Uint8Array/
 * ReadableStream + httpMetadata.contentType), `get` (body stream +
 * size + arrayBuffer, R2ObjectBody-compatible), `delete` (single key or
 * batch), `list` (full inventory in one page — dev buckets are small;
 * pagination options are accepted and ignored).
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
		// R2-style listing for the ops storage probe: every object file
		// under the root (sidecars excluded), keys as posix-relative
		// paths. Always one untruncated page — the dev store is a
		// directory, not a paginated service.
		list: async (): Promise<{
			objects: { key: string; size: number }[];
			truncated: boolean;
		}> => {
			const objects: { key: string; size: number }[] = [];
			const walk = async (dir: string, prefix: string): Promise<void> => {
				const entries = await readdir(dir, { withFileTypes: true });
				for (const entry of entries) {
					const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
					const file = resolve(dir, entry.name);
					if (entry.isDirectory()) {
						await walk(file, rel);
					} else if (entry.isFile() && !entry.name.endsWith(META_SUFFIX)) {
						objects.push({ key: rel, size: (await stat(file)).size });
					}
				}
			};
			try {
				await walk(root, "");
			} catch (error) {
				// Empty/missing store dir → zero objects, not an error.
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
			return { objects, truncated: false };
		},
	};
};
