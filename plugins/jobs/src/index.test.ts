import { describe, expect, it } from "vitest";

import { jobsHeaderPlugin, opsPanelPlugin, opsServicesPlugin, plugins } from "./index.ts";
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
		expect(jobsHeaderPlugin.panel?.headerActions).toHaveLength(1);
		expect(jobsHeaderPlugin.panel?.headerActions?.[0]?.id).toBe("jobs");
	});
});

describe("ops plugins", () => {
	it("declares the ops services contribution behind consultations + admin deps", () => {
		expect(opsServicesPlugin.id).toBe("jobs.ops.services");
		expect(opsServicesPlugin.requiredDeps).toEqual(["consultations.services", "platform.admin"]);
	});

	it("declares the /platform/ops sidebar entry and page", () => {
		expect(opsPanelPlugin.id).toBe("jobs.panel");
		expect(opsPanelPlugin.requiredDeps).toEqual(["platform.panel", "jobs.ops.services"]);
		expect(opsPanelPlugin.panel?.sidebar?.[0]).toMatchObject({
			to: "/platform/ops",
			label: "Ops",
			group: "System",
		});
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
			"jobs.panel",
		]);
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
