import { afterEach, describe, expect, it } from "vitest";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { Forbidden, Principal } from "@ktb/authz";
import { Consultations, type AudioJobRow } from "@ktb/consultations";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import {
	resetServerRuntime,
	setServerRuntime,
	type AudioStorageStats,
	type QueueDepth,
} from "@ktb/server-fns";

import { Ops, OpsLive } from "./ops.ts";

const ROW: AudioJobRow = {
	id: 1,
	audioStatus: "failed",
	audioError: "boom",
	createdAt: new Date("2025-01-01T00:00:00Z"),
	patientName: "Pac",
};

const consultationsStub = (
	overrides: Partial<Record<keyof Consultations["Service"], unknown>> = {},
) =>
	({
		adminAudioJobs: () => Effect.succeed([ROW]),
		...overrides,
	}) as unknown as Consultations["Service"];

const makeRuntime = (opts: { consultations?: Consultations["Service"]; admin?: boolean }) => {
	const admin = opts.admin ?? true;
	return ManagedRuntime.make(
		OpsLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(Consultations, opts.consultations ?? consultationsStub()),
					Layer.succeed(
						PlatformAdmin,
						makePlatformAdminGate(parsePlatformAdminEmails(admin ? "admin@x.com" : "")),
					),
				),
			),
		),
	);
};

const asPrincipal = <A, E>(runtime: ManagedRuntime.ManagedRuntime<Ops, never>, email?: string) =>
	runtime.runPromise(
		Effect.flatMap(Ops, (ops) =>
			Effect.all([ops.audioJobs(), ops.queueDepth(), ops.storageStats()]),
		).pipe(Effect.provideService(Principal, email === undefined ? null : { userId: "u1", email })),
	);

afterEach(() => resetServerRuntime());

describe("OpsLive", () => {
	it("delegates audioJobs to the Consultations service", async () => {
		const runtime = makeRuntime({});
		try {
			const [jobs] = await asPrincipal(runtime, "admin@x.com");
			expect(jobs).toEqual([ROW]);
		} finally {
			await runtime.dispose();
		}
	});

	it("resolves queue/storage probes from the server runtime", async () => {
		const depth: QueueDepth = { pending: 1, processing: 2, done: 3, failed: 4 };
		const stats: AudioStorageStats = { objects: 5, bytes: 6, truncated: false };
		setServerRuntime({
			run: () => Promise.reject(new Error("unused")),
			runAs: () => Promise.reject(new Error("unused")),
			getLocale: () => "en",
			audioTranscribeModel: "test-model",
			audioQueueDepth: () => Promise.resolve(depth),
			audioStorageStats: () => Promise.resolve(stats),
		});
		const runtime = makeRuntime({});
		try {
			const [, queue, storage] = await asPrincipal(runtime, "admin@x.com");
			expect(queue).toEqual(depth);
			expect(storage).toEqual(stats);
		} finally {
			await runtime.dispose();
		}
	});

	it("collapses missing runtime, absent probes and probe failures to null", async () => {
		// No runtime registered at all → getServerRuntime throws → null.
		const runtime = makeRuntime({});
		try {
			const [, queue, storage] = await asPrincipal(runtime, "admin@x.com");
			expect(queue).toBeNull();
			expect(storage).toBeNull();
		} finally {
			await runtime.dispose();
		}

		// Probes present but resolving null / rejecting → null.
		setServerRuntime({
			run: () => Promise.reject(new Error("unused")),
			runAs: () => Promise.reject(new Error("unused")),
			getLocale: () => "en",
			audioTranscribeModel: "test-model",
			audioQueueDepth: () => Promise.resolve(null),
			audioStorageStats: () => Promise.reject(new Error("r2 down")),
		});
		const runtime2 = makeRuntime({});
		try {
			const [, queue, storage] = await asPrincipal(runtime2, "admin@x.com");
			expect(queue).toBeNull();
			expect(storage).toBeNull();
		} finally {
			await runtime2.dispose();
		}
	});

	it("denies non-admin principals on every signal", async () => {
		const runtime = makeRuntime({ admin: false });
		try {
			await expect(asPrincipal(runtime, "user@x.com")).rejects.toMatchObject({
				_tag: "Forbidden",
			});
			await expect(asPrincipal(runtime)).rejects.toMatchObject({ _tag: "Forbidden" });
		} finally {
			await runtime.dispose();
		}
	});

	it("propagates a Forbidden failure from the jobs delegation", async () => {
		const runtime = makeRuntime({
			consultations: consultationsStub({
				adminAudioJobs: () => Effect.fail(new Forbidden({ path: "platform.admin" })),
			}),
		});
		try {
			await expect(asPrincipal(runtime, "admin@x.com")).rejects.toMatchObject({
				_tag: "Forbidden",
			});
		} finally {
			await runtime.dispose();
		}
	});
});
