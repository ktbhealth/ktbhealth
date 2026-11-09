import { createFileRoute } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { getSessionUser, runAs } from "@ktb/server-fns";

import { Notifications } from "../Notifications.ts";

/**
 * GET /api/notifications — SSE feed of the session user's console
 * notifications. `Notifications.stream` replays the persisted backlog,
 * then fans out live inserts; each item is framed as an SSE `data:`
 * event and a `: hb` comment heartbeat keeps proxies from idling the
 * connection out. `toReadableStreamEffect` captures the runAs context
 * (Principal + services), so the stream's authz/db effects keep working
 * outside the ManagedRuntime; cancelling the response body interrupts
 * the underlying fiber.
 *
 * The route module lives in this package and is mounted into the host's
 * virtual route tree by `notificationsRoutesPlugin` (physical("/api",
 * "src/api-routes")); the session/runtime boundary is @ktb/server-fns,
 * so no host imports are needed (P-033).
 */
export const Route = createFileRoute("/api/notifications")({
	server: {
		handlers: {
			GET: async () => {
				const user = await getSessionUser();
				if (!user) return new Response("unauthorized", { status: 401 });

				const body = await runAs(
					user,
					Effect.gen(function* () {
						const notifications = yield* Notifications;
						const frames = notifications
							.stream(user.id)
							.pipe(Stream.map((n) => `data: ${JSON.stringify(n)}\n\n`));
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
