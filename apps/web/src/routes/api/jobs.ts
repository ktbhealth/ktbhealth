import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { Consultations } from "@ktb/consultations";
import { PlatformAdmin } from "@ktb/platform";

import { getSessionUser } from "#/lib/auth.ts";
import { runAs } from "#/lib/platform.ts";

/**
 * GET /api/jobs — SSE feed of the consultation audio-pipeline rows behind
 * the /platform "jobs" popover. `Consultations.audioJobsStream` replays
 * the current cross-owner projection, then fans out one fresh row per
 * `consultation.audioUpdated` event (published by the upload route's
 * service calls and by the queue consumer); each row is framed as an
 * SSE `data:` event and a `: hb` comment heartbeat keeps proxies from
 * idling the connection out. `toReadableStreamEffect` captures the
 * runAs context (Principal + services); cancelling the response body
 * interrupts the underlying fiber.
 *
 * Admin-gated like `adminListAudioJobsFn`: the allowlist check runs
 * before streaming and `audioJobsStream` re-checks via
 * `PlatformAdmin.requireAdmin` (defense in depth).
 */
export const Route = createFileRoute("/api/jobs")({
	server: {
		handlers: {
			GET: async () => {
				const user = await getSessionUser();
				if (!user) return new Response("unauthorized", { status: 401 });

				const admin = await runAs(
					user,
					Effect.gen(function* () {
						const platformAdmin = yield* PlatformAdmin;
						return yield* platformAdmin.isAdmin(user.email);
					}),
				);
				if (!admin) return new Response("forbidden", { status: 403 });

				const body = await runAs(
					user,
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						const frames = consultations
							.audioJobsStream()
							.pipe(Stream.map((row) => `data: ${JSON.stringify(row)}\n\n`));
						const heartbeat = Stream.tick("25 seconds").pipe(Stream.map(() => ": hb\n\n"));
						return yield* Stream.toReadableStreamEffect(
							Stream.merge(frames, heartbeat).pipe(Stream.encodeText),
						);
					}),
				);

				return new Response(body, {
					headers: {
						"content-type": "text/event-stream",
						"cache-control": "no-cache",
						connection: "keep-alive",
					},
				});
			},
		},
	},
});
