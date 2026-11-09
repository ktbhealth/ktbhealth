import { describe, expect, it } from "vitest";

import { jobsHeaderPlugin } from "./index.ts";
import { jobFromAudioRow, jobsFromAudioRows } from "./jobs.ts";

describe("jobs.header plugin", () => {
	it("declares the header action contribution", () => {
		expect(jobsHeaderPlugin.id).toBe("jobs.header");
		expect(jobsHeaderPlugin.requiredDeps).toEqual(["platform.panel"]);
		expect(jobsHeaderPlugin.optionalDeps).toEqual(["platform.header"]);
		expect(jobsHeaderPlugin.panel?.headerActions).toHaveLength(1);
		expect(jobsHeaderPlugin.panel?.headerActions?.[0]?.id).toBe("jobs");
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
