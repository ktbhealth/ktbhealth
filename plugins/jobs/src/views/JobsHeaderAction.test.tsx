// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

const renderAction = (value: readonly ConsoleJob[] = jobs) =>
	render(
		<JobsDataContext.Provider value={value}>
			<JobsHeaderAction />
		</JobsDataContext.Provider>,
	);

afterEach(cleanup);

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
});
