import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Forbidden } from "@ktb/authz";
import { Consultations, type AudioJobRow } from "@ktb/consultations";
import { PlatformAdmin } from "@ktb/platform";
import {
	getServerRuntime,
	type AudioStorageStats,
	type QueueDepth,
	type ServerRuntime,
} from "@ktb/server-fns";

/**
 * Ops console port (T-035): the read side of /platform/ops. Every
 * signal is real or explicitly unavailable — `null` means the host
 * binding cannot report it (prod Cloudflare Queue has no query API;
 * unbound storage), never a fabricated zero.
 *
 * - `audioJobs`: the consultation audio-pipeline projection, delegated
 *   to `Consultations.adminAudioJobs` (PlatformAdmin gate inside).
 * - `queueDepth`/`storageStats`: host-runtime probes published by the
 *   composition root (apps/web platform.ts) — the dev:node SQLite
 *   queue and filesystem/R2 bucket expose them; workerd bindings
 *   resolve null → the page renders "unavailable".
 */
export class Ops extends Context.Service<
	Ops,
	{
		readonly audioJobs: () => Effect.Effect<readonly AudioJobRow[], Forbidden>;
		readonly queueDepth: () => Effect.Effect<QueueDepth | null, Forbidden>;
		readonly storageStats: () => Effect.Effect<AudioStorageStats | null, Forbidden>;
	}
>()("@ktb/jobs/Ops") {}

type StatProbe<A> = (runtime: ServerRuntime) => (() => Promise<A | null>) | undefined;

/**
 * Resolve a ServerRuntime stats probe lazily per call: the registry is
 * only populated at the composition root, and a missing runtime or a
 * throwing/absent probe collapses to null (unavailable) — the ops page
 * must never take down because a health signal is missing.
 */
const probe = <A>(pick: StatProbe<A>) =>
	Effect.promise(async (): Promise<A | null> => {
		try {
			const read = pick(getServerRuntime());
			return read === undefined ? null : await read();
		} catch {
			return null;
		}
	});

export const OpsLive = Layer.effect(
	Ops,
	Effect.gen(function* () {
		const consultations = yield* Consultations;
		const platformAdmin = yield* PlatformAdmin;
		return Ops.of({
			audioJobs: () => consultations.adminAudioJobs(),
			// The stats probes carry no domain data but still sit behind
			// the admin gate — defense in depth on top of the page guard.
			queueDepth: () =>
				platformAdmin.requireAdmin().pipe(Effect.andThen(probe((r) => r.audioQueueDepth))),
			storageStats: () =>
				platformAdmin.requireAdmin().pipe(Effect.andThen(probe((r) => r.audioStorageStats))),
		});
	}),
);
