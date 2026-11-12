import { describe, expect, it } from "vitest";

import * as Effect from "effect/Effect";

import { Forbidden, Principal } from "@ktb/authz";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import type { QueueDepth, AudioStorageStats } from "@ktb/server-fns";

import {
	jobsHeaderPlugin,
	opsChromePlugin,
	opsPanelPlugin,
	opsServicesPlugin,
	plugins,
} from "./index.ts";
import { Ops } from "./ops.ts";
import type { OpsPageData } from "./platform-page.tsx";
import {
	isAudioRetryable,
	jobFromAudioRow,
	jobStatusOf,
	jobsFromAudioRows,
	RETRYABLE_AUDIO_STATUSES,
} from "./jobs.ts";

describe("jobs.header plugin", () => {
	it("declares the header action contribution", () => {
		expect(jobsHeaderPlugin.id).toBe("jobs.header");
		expect(jobsHeaderPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(jobsHeaderPlugin.optionalDeps).toEqual(["platform.header"]);
		expect(jobsHeaderPlugin.chrome).toHaveLength(1);
		expect(jobsHeaderPlugin.chrome?.[0]).toMatchObject({
			region: "console.header.actions",
			content: { kind: "headerAction", id: "jobs" },
		});
	});
});

describe("ops plugins", () => {
	it("declares the ops services contribution behind consultations + admin deps", () => {
		expect(opsServicesPlugin.id).toBe("jobs.ops.services");
		expect(opsServicesPlugin.requiredDeps).toEqual(["consultations.services", "platform.admin"]);
	});

	it("declares the /platform/ops sidebar entry and page", () => {
		expect(opsChromePlugin.id).toBe("jobs.chrome");
		expect(opsChromePlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(opsChromePlugin.chrome?.[0]).toMatchObject({
			region: "console.sidebar",
			content: {
				kind: "sidebarItem",
				item: { to: "/platform/ops", label: "Ops", group: "System" },
			},
		});
		expect(opsPanelPlugin.id).toBe("jobs.panel");
		expect(opsPanelPlugin.requiredDeps).toEqual(["platform.panel", "jobs.ops.services"]);
		const page = opsPanelPlugin.panel?.pages?.[0];
		expect(page).toMatchObject({ id: "jobs.ops", path: "/platform/ops" });
		expect(typeof page?.guard).toBe("function");
		expect(typeof page?.loader).toBe("function");
	});

	it("is discoverable through the plugins export", () => {
		expect(plugins.map((p) => p.id)).toEqual([
			"jobs.header",
			"jobs.routes",
			"jobs.ops.services",
			"jobs.chrome",
			"jobs.panel",
		]);
	});
});

describe("ops panel page guard", () => {
	const guard = opsPanelPlugin.panel!.pages![0]!.guard as () => Effect.Effect<
		boolean,
		never,
		PlatformAdmin
	>;
	const gate = (admin: boolean) =>
		makePlatformAdminGate(parsePlatformAdminEmails(admin ? "admin@x.com" : ""));

	it("returns true for allowlisted admins", async () => {
		const result = await Effect.runPromise(
			guard().pipe(
				Effect.provideService(PlatformAdmin, gate(true)),
				Effect.provideService(Principal, { userId: "u1", email: "admin@x.com" }),
			),
		);
		expect(result).toBe(true);
	});

	it("returns false for non-admins and null principals", async () => {
		for (const principal of [{ userId: "u1", email: "doc@x.com" }, null] as const) {
			const result = await Effect.runPromise(
				guard().pipe(
					Effect.provideService(PlatformAdmin, gate(true)),
					Effect.provideService(Principal, principal),
				),
			);
			expect(result).toBe(false);
		}
	});
});

describe("ops panel page loader", () => {
	const loader = opsPanelPlugin.panel!.pages![0]!.loader as () => Effect.Effect<
		OpsPageData,
		never,
		Ops
	>;
	const ROW = {
		id: 3,
		audioStatus: "failed",
		audioError: "boom",
		createdAt: new Date("2025-01-01T00:00:00Z"),
		patientName: "Pac",
	};
	const DEPTH: QueueDepth = { pending: 1, processing: 2, done: 3, failed: 4 };
	const STATS: AudioStorageStats = { objects: 5, bytes: 6, truncated: false };
	const opsStub = (overrides: Partial<Ops["Service"]> = {}) =>
		({
			audioJobs: () => Effect.succeed([ROW]),
			queueDepth: () => Effect.succeed(DEPTH),
			storageStats: () => Effect.succeed(STATS),
			...overrides,
		}) as unknown as Ops["Service"];

	it("returns all three signals", async () => {
		const result = await Effect.runPromise(loader().pipe(Effect.provideService(Ops, opsStub())));
		expect(result).toEqual({ jobs: [ROW], queue: DEPTH, storage: STATS });
	});

	it("collapses Forbidden sections to null independently", async () => {
		const forbidden = () => Effect.fail(new Forbidden({ path: "platform.admin" }));
		const result = await Effect.runPromise(
			loader().pipe(
				Effect.provideService(Ops, opsStub({ queueDepth: forbidden, storageStats: forbidden })),
			),
		);
		expect(result).toEqual({ jobs: [ROW], queue: null, storage: null });
	});
});

describe("audio job status helpers", () => {
	it("maps pipeline statuses to badges and null for non-jobs", () => {
		expect(jobStatusOf("stored")).toBe("queued");
		expect(jobStatusOf("queued")).toBe("queued");
		expect(jobStatusOf("processing")).toBe("processing");
		expect(jobStatusOf("done")).toBe("done");
		expect(jobStatusOf("failed")).toBe("failed");
		expect(jobStatusOf("none")).toBeNull();
		expect(jobStatusOf("bogus")).toBeNull();
	});

	it("marks only stored/failed rows as retryable", () => {
		expect([...RETRYABLE_AUDIO_STATUSES]).toEqual(["stored", "failed"]);
		expect(isAudioRetryable("stored")).toBe(true);
		expect(isAudioRetryable("failed")).toBe(true);
		expect(isAudioRetryable("queued")).toBe(false);
		expect(isAudioRetryable("processing")).toBe(false);
		expect(isAudioRetryable("done")).toBe(false);
		expect(isAudioRetryable("none")).toBe(false);
	});
});

describe("jobsFromAudioRows", () => {
	const base = { id: 1, audioError: null, createdAt: new Date("2025-01-01T00:00:00Z") };

	it("maps pipeline statuses and skips rows without audio", () => {
		const jobs = jobsFromAudioRows([
			{ ...base, audioStatus: "none" },
			{ ...base, id: 2, audioStatus: "stored" },
			{ ...base, id: 3, audioStatus: "processing" },
			{ ...base, id: 4, audioStatus: "done" },
			{ ...base, id: 5, audioStatus: "failed", audioError: "boom" },
		]);
		expect(jobs.map((j) => j.status)).toEqual(["queued", "processing", "done", "failed"]);
		expect(jobs[3]?.error).toBe("boom");
		expect(jobs[3]?.meta).toBe("boom");
	});

	it("tolerates ISO-string dates from serialized loader data", () => {
		const [job] = jobsFromAudioRows([
			{ ...base, audioStatus: "queued", createdAt: "2025-01-01T00:00:00.000Z" },
		]);
		expect(job?.meta).toBeTruthy();
	});
});

describe("jobFromAudioRow", () => {
	const base = { id: 7, audioError: null, createdAt: "2025-01-01T00:00:00.000Z" };

	it("maps a single live-frame row to its job", () => {
		const job = jobFromAudioRow({ ...base, audioStatus: "processing" });
		expect(job).toMatchObject({ id: "audio-7", status: "processing" });
	});

	it("returns null for rows that are not jobs", () => {
		expect(jobFromAudioRow({ ...base, audioStatus: "none" })).toBeNull();
	});
});

describe("job meta date fallback", () => {
	it("leaves the meta empty when the row date is not parseable", () => {
		const [job] = jobsFromAudioRows([
			{ id: 3, audioStatus: "done", audioError: null, createdAt: "not-a-date", patientName: null },
		]);
		expect(job).toMatchObject({ id: "audio-3", meta: "", description: "consultation #3" });
	});
});
