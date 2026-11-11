// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.fn(async () => {});
vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate }),
}));

const retryAudioJobFn = vi.fn(async (_arg?: { data?: { consultationId: number } }) => ({
	ok: true as const,
}));
vi.mock("../fns.ts", () => ({
	retryAudioJobFn: (arg?: { data?: { consultationId: number } }) => retryAudioJobFn(arg),
}));

import type { AudioStorageStats, QueueDepth } from "@ktb/server-fns";

import type { AudioJobRow } from "../jobs.ts";
import { OpsPage } from "./OpsPage.tsx";

const job = (over: Partial<AudioJobRow> = {}): AudioJobRow => ({
	id: 1,
	audioStatus: "failed",
	audioError: "whisper exploded",
	createdAt: "2025-01-01T00:00:00.000Z",
	patientName: "Maria Silva",
	...over,
});

const queue: QueueDepth = { pending: 2, processing: 1, done: 40, failed: 3 };
const storage: AudioStorageStats = { objects: 12, bytes: 5 * 1024 * 1024, truncated: false };

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("OpsPage", () => {
	it("renders all sections with data", () => {
		render(<OpsPage jobs={[job()]} queue={queue} storage={storage} locale="en" />);
		expect(screen.getByText("Ops")).toBeTruthy();
		expect(screen.getByText("Audio pipeline jobs")).toBeTruthy();
		expect(screen.getByText("#1")).toBeTruthy();
		expect(screen.getByText("Maria Silva")).toBeTruthy();
		// "Failed" appears both as a job status label and a queue stat label.
		expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
		expect(screen.getByText("whisper exploded")).toBeTruthy();
		expect(screen.getByText("Transcription queue")).toBeTruthy();
		expect(screen.getByText("40")).toBeTruthy();
		expect(screen.getByText("Audio storage")).toBeTruthy();
		expect(screen.getByText(/12 objects/)).toBeTruthy();
		expect(screen.getByText("Bot webhooks")).toBeTruthy();
	});

	it("renders unavailable states for null signals", () => {
		render(<OpsPage jobs={null} queue={null} storage={null} locale="en" />);
		expect(screen.getAllByText("Signal unavailable")).toHaveLength(3);
		expect(screen.getByText(/not instrumented/)).toBeTruthy();
	});

	it("renders the empty jobs state", () => {
		render(<OpsPage jobs={[]} queue={queue} storage={storage} locale="en" />);
		expect(screen.getByText("No audio jobs")).toBeTruthy();
	});

	it("filters jobs by the search box", () => {
		render(
			<OpsPage
				jobs={[job(), job({ id: 2, patientName: "João", audioStatus: "done", audioError: null })]}
				queue={queue}
				storage={storage}
				locale="en"
			/>,
		);
		fireEvent.change(screen.getByLabelText("Filter jobs"), { target: { value: "joão" } });
		expect(screen.queryByText("Maria Silva")).toBeNull();
		expect(screen.getByText("João")).toBeTruthy();
	});

	it("runs the retry flow: confirm → fn → invalidate", async () => {
		render(<OpsPage jobs={[job()]} queue={queue} storage={storage} locale="en" />);
		fireEvent.click(screen.getByText("Retry"));
		expect(screen.getByText("Retry transcription?")).toBeTruthy();
		fireEvent.click(screen.getByText("Retry job"));
		await waitFor(() =>
			expect(retryAudioJobFn).toHaveBeenCalledWith({ data: { consultationId: 1 } }),
		);
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("shows an error when the retry fn fails", async () => {
		retryAudioJobFn.mockResolvedValueOnce({ ok: false, reason: "enqueue-failed" } as never);
		render(<OpsPage jobs={[job()]} queue={queue} storage={storage} locale="en" />);
		fireEvent.click(screen.getByText("Retry"));
		fireEvent.click(screen.getByText("Retry job"));
		await waitFor(() => expect(screen.getByText(/could not be re-enqueued/)).toBeTruthy());
		expect(invalidate).not.toHaveBeenCalled();
	});

	it("does not offer retry for non-retryable statuses", () => {
		render(
			<OpsPage
				jobs={[
					job({ id: 3, audioStatus: "done", audioError: null }),
					job({ id: 4, audioStatus: "processing", audioError: null }),
					job({ id: 5, audioStatus: "stored", audioError: null }),
				]}
				queue={queue}
				storage={storage}
				locale="en"
			/>,
		);
		// Only the "stored" row is retryable — exactly one Retry button.
		expect(screen.getAllByText("Retry")).toHaveLength(1);
		// "Stored"/"Processing" also appear as queue stat labels — assert presence.
		expect(screen.getAllByText("Stored").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Processing").length).toBeGreaterThan(0);
	});

	it("renders queued jobs, missing patients and Date/invalid createdAt values", () => {
		render(
			<OpsPage
				jobs={[
					job({
						id: 6,
						audioStatus: "queued",
						audioError: null,
						patientName: null,
						createdAt: new Date("2025-02-02T00:00:00Z"),
					}),
					job({
						id: 7,
						audioStatus: "done",
						audioError: null,
						patientName: "X",
						createdAt: "not-a-date",
					}),
				]}
				queue={queue}
				storage={storage}
				locale="en"
			/>,
		);
		// "Queued" is both a job badge label here and a queue stat label.
		expect(screen.getAllByText("Queued").length).toBeGreaterThan(0);
		// The null patientName falls back to the em-dash placeholder.
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	});

	it("searches rows with missing patient names and shows the no-match row", () => {
		render(
			<OpsPage
				jobs={[
					job({ id: 8, audioStatus: "done", audioError: null, patientName: null }),
					job({ id: 9, patientName: "Ana", audioStatus: "done", audioError: null }),
				]}
				queue={queue}
				storage={storage}
				locale="en"
			/>,
		);
		fireEvent.change(screen.getByLabelText("Filter jobs"), { target: { value: "ana" } });
		expect(screen.queryByText("#8")).toBeNull();
		expect(screen.getByText("#9")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Filter jobs"), { target: { value: "zzz" } });
		expect(screen.getByText("No jobs match the filter.")).toBeTruthy();
	});

	it("localizes the console in pt-BR", () => {
		render(<OpsPage jobs={[job()]} queue={queue} storage={storage} locale="pt-BR" />);
		expect(screen.getByText("Operações")).toBeTruthy();
		expect(screen.getByText("Tarefas do pipeline de áudio")).toBeTruthy();
		expect(screen.getByText("Falhou")).toBeTruthy();
	});

	it("marks truncated storage listings as lower bounds", () => {
		render(
			<OpsPage
				jobs={[]}
				queue={queue}
				storage={{ objects: 1000, bytes: 2048, truncated: true }}
				locale="en"
			/>,
		);
		expect(screen.getByText(/lower bound/)).toBeTruthy();
	});
});
