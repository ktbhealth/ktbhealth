// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, ...props }: Record<string, unknown>) =>
			React.createElement("a", { ...props, href: String(to) }, props.children as never),
	};
});

import { JobsDataContext, type ConsoleJob } from "../context.ts";
import { JobsHeaderAction } from "./JobsHeaderAction.tsx";

const jobs: ConsoleJob[] = [
	{ id: "a", title: "Audio transcription", status: "processing", description: "pt-1" },
	{ id: "b", title: "PDF export", status: "failed", error: "render timeout" },
	{ id: "c", title: "FHIR sync", status: "done" },
];

class MockEventSource {
	static instances: MockEventSource[] = [];
	onmessage: ((event: { data: string }) => void) | null = null;
	closed = false;
	constructor(public readonly url: string) {
		MockEventSource.instances.push(this);
	}
	close() {
		this.closed = true;
	}
}

const audioRow = (id: number, audioStatus: string, audioError: string | null = null) =>
	JSON.stringify({
		id,
		audioStatus,
		audioError,
		createdAt: "2025-01-01T00:00:00.000Z",
		patientName: "Ana",
	});

const renderAction = (value: readonly ConsoleJob[] = jobs) =>
	render(
		<JobsDataContext.Provider value={value}>
			<JobsHeaderAction />
		</JobsDataContext.Provider>,
	);

afterEach(() => {
	cleanup();
	MockEventSource.instances = [];
	vi.unstubAllGlobals();
});

describe("JobsHeaderAction", () => {
	it("renders the icon button with an active-jobs badge", () => {
		renderAction();
		const button = screen.getByRole("button", { name: "Background jobs" });
		expect(button).toBeTruthy();
		// 1 processing job → badge count 1 (failed/done are not active).
		expect(button.textContent).toContain("1");
	});

	it("opens a wide popover listing jobs grouped by status", async () => {
		const user = userEvent.setup();
		renderAction();
		await user.click(screen.getByRole("button", { name: "Background jobs" }));
		expect(await screen.findByText("Background jobs")).toBeTruthy();
		expect(screen.getByText("Audio transcription")).toBeTruthy();
		expect(screen.getByText("PDF export")).toBeTruthy();
		// Done group is collapsible and starts closed.
		expect(screen.queryByText("FHIR sync")).toBeNull();
		await user.click(screen.getByRole("button", { name: /done/i }));
		expect(await screen.findByText("FHIR sync")).toBeTruthy();
		expect(screen.getByText("1 active")).toBeTruthy();
	});

	it("shows an empty state when the feed is empty", async () => {
		const user = userEvent.setup();
		renderAction([]);
		await user.click(screen.getByRole("button", { name: "Background jobs" }));
		expect(await screen.findByText("No background jobs")).toBeTruthy();
	});

	it("opens /api/jobs and upserts live frames by job id", async () => {
		vi.stubGlobal("EventSource", MockEventSource);
		const user = userEvent.setup();
		renderAction();

		expect(MockEventSource.instances).toHaveLength(1);
		expect(MockEventSource.instances[0]!.url).toBe("/api/jobs");
		const source = MockEventSource.instances[0]!;

		// Live arrival: consultation 42 went processing → second active job.
		act(() => {
			source.onmessage!({ data: audioRow(42, "processing") });
		});
		expect(screen.getByRole("button", { name: "Background jobs" }).textContent).toContain("2");

		await user.click(screen.getByRole("button", { name: "Background jobs" }));
		expect((await screen.findAllByText("Audio transcription")).length).toBe(2);

		// Same row transitions to done → updates in place, badge back to 1.
		act(() => {
			source.onmessage!({ data: audioRow(42, "done") });
		});
		expect(screen.getByRole("button", { name: "Background jobs" }).textContent).toContain("1");
		// The done group starts collapsed — expand to see both rows.
		await user.click(screen.getByRole("button", { name: /done/i }));
		expect((await screen.findAllByText("Audio transcription")).length).toBe(2);
	});

	it("closes the EventSource on unmount", () => {
		vi.stubGlobal("EventSource", MockEventSource);
		const { unmount } = renderAction();
		const source = MockEventSource.instances[0]!;
		unmount();
		expect(source.closed).toBe(true);
	});

	it("drops a job whose live frame is no longer a job and ignores unknown ones", async () => {
		vi.stubGlobal("EventSource", MockEventSource);
		const user = userEvent.setup();
		renderAction([{ id: "audio-5", title: "Audio transcription", status: "processing" }]);
		const source = MockEventSource.instances[0]!;
		const badge = () => screen.getByRole("button", { name: "Background jobs" }).textContent;
		expect(badge()).toContain("1");

		// Unknown id + not a job → list unchanged.
		act(() => {
			source.onmessage!({ data: audioRow(99, "none") });
		});
		expect(badge()).toContain("1");

		// Known id + not a job → removed from the list.
		act(() => {
			source.onmessage!({ data: audioRow(5, "none") });
		});
		expect(badge()).not.toContain("1");
		await user.click(screen.getByRole("button", { name: "Background jobs" }));
		expect(await screen.findByText("No background jobs")).toBeTruthy();
	});

	it("ignores malformed live frames", () => {
		vi.stubGlobal("EventSource", MockEventSource);
		renderAction();
		const source = MockEventSource.instances[0]!;
		act(() => {
			source.onmessage!({ data: "{not json" });
		});
		expect(screen.getByRole("button", { name: "Background jobs" }).textContent).toContain("1");
	});

	it("renders job progress and filters by status, with an empty state per filter", async () => {
		const user = userEvent.setup();
		renderAction([
			{ id: "a", title: "Audio transcription", status: "processing", progress: 40 },
			{ id: "b", title: "PDF export", status: "failed", error: "render timeout", meta: "2m ago" },
		]);
		await user.click(screen.getByRole("button", { name: "Background jobs" }));
		expect(await screen.findByText("PDF export")).toBeTruthy();

		await user.click(screen.getByRole("tab", { name: /failed/i }));
		expect(screen.getByText("PDF export")).toBeTruthy();
		expect(screen.queryByText("Audio transcription")).toBeNull();

		await user.click(screen.getByRole("tab", { name: /done/i }));
		expect(await screen.findByText("No jobs in this state")).toBeTruthy();
		expect(screen.getByText("Nothing matches the selected filter.")).toBeTruthy();
	});
});
