import {
	createStartHandler,
	defaultStreamHandler,
	createServerEntry as createCoreServerEntry,
} from "@tanstack/react-start/server";
import type { Register } from "@tanstack/react-router";
import type { RequestHandler } from "@tanstack/react-start/server";

import { handleAudioQueueBatch } from "#/lib/audio-jobs.ts";
import { flushTelemetry } from "#/lib/platform.ts";

const fetch = createStartHandler(defaultStreamHandler);

// Providing `RequestHandler` from `@tanstack/react-start/server` is required so that the output types don't import it from `@tanstack/start-server-core`
export type ServerEntry = { fetch: RequestHandler<Register> };

// Bind the shared request context and fallback error handling to React's Register.
export const createServerEntry: (entry: ServerEntry) => ServerEntry =
	createCoreServerEntry<Register>;

const entry = createServerEntry({ fetch });

/**
 * Custom worker entry (replaces TanStack's default server entry): same
 * fetch pipeline plus the Cloudflare Queue consumer for async audio
 * transcription (P-016). The default export object is the workerd
 * entrypoint — `queue` rides alongside `fetch`.
 *
 * Telemetry: after each fetch and queue batch, `ctx.waitUntil` schedules
 * a bounded OTLP flush so buffered spans/logs/metrics aren't lost when
 * the isolate freezes between requests.
 */
export default {
	...entry,
	fetch: ((request: Request, _env: unknown, ctx: ExecutionContext) => {
		const response = entry.fetch(request);
		const done = Promise.resolve(response).then(
			() => flushTelemetry(),
			() => flushTelemetry(),
		);
		ctx?.waitUntil?.(done);
		return response;
	}) as RequestHandler<Register>,
	queue: async (batch: MessageBatch, _env: unknown, ctx: ExecutionContext) => {
		await handleAudioQueueBatch(batch.messages);
		ctx?.waitUntil?.(flushTelemetry());
	},
};
