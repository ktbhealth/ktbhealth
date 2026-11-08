import {
	createStartHandler,
	defaultStreamHandler,
	createServerEntry as createCoreServerEntry,
} from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

import { handleAudioQueueBatch } from "#/lib/audio-jobs.ts";

const fetch = createStartHandler(defaultStreamHandler);

// Providing `RequestHandler` from `@tanstack/react-start/server` is required so that the output types don't import it from `@tanstack/start-server-core`
export type ServerEntry = { fetch: RequestHandler<Register> };

// Bind the shared request context and fallback error handling to React's Register.
export const createServerEntry: (entry: ServerEntry) => ServerEntry =
	createCoreServerEntry<Register>;

/**
 * Custom worker entry (replaces TanStack's default server entry): same
 * fetch pipeline plus the Cloudflare Queue consumer for async audio
 * transcription (P-016). The default export object is the workerd
 * entrypoint — `queue` rides alongside `fetch`.
 */
export default {
	...createServerEntry({ fetch }),
	queue: (batch: MessageBatch, _env: unknown, _ctx: ExecutionContext) =>
		handleAudioQueueBatch(batch.messages),
};
