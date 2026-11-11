// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, params, ...props }: Record<string, unknown>) =>
			React.createElement(
				"a",
				{
					...props,
					href: String(to).replace("$id", String((params as { id?: string })?.id ?? "")),
				},
				props.children as never,
			),
	};
});

import type { AdminConsultationRow } from "../index.ts";
import { AdminConsultationsPage } from "./AdminConsultationsPage.tsx";

const row = (over: Partial<AdminConsultationRow>): AdminConsultationRow => ({
	id: 1,
	userId: "u1",
	patientId: null,
	transcript: "t",
	anamnesis: null,
	review: null,
	engine: null,
	source: "browser",
	status: "done",
	botId: null,
	consentAt: null,
	audioKey: null,
	audioStatus: "none",
	audioContentType: null,
	audioSize: null,
	audioError: null,
	serverTranscript: null,
	correctedTranscript: null,
	enhancementEngine: null,
	createdAt: new Date("2026-11-01T10:00:00Z"),
	ownerEmail: "dra@x.com",
	ownerName: "Dra Ana",
	patientName: "Paciente Um",
	...over,
});

afterEach(cleanup);

describe("AdminConsultationsPage", () => {
	it("renders the empty state", () => {
		render(<AdminConsultationsPage consultations={[]} />);
		expect(screen.getByText("No consultations yet.")).toBeTruthy();
		expect(screen.getByText("No consultations")).toBeTruthy();
	});

	it("renders the dense table with owner and patient fields", () => {
		render(
			<AdminConsultationsPage
				consultations={[
					row({}),
					row({
						id: 2,
						status: "live",
						source: "bot",
						patientId: null,
						patientName: null,
						ownerName: null,
						ownerEmail: null,
					}),
				]}
			/>,
		);
		expect(screen.getByText("2 consultations across all owners.")).toBeTruthy();
		expect(screen.getByText("done")).toBeTruthy();
		expect(screen.getByText("live")).toBeTruthy();
		expect(screen.getByText("Paciente Um")).toBeTruthy();
		expect(screen.getByText("Dra Ana")).toBeTruthy();
		// Missing owner profile falls back to dash; missing patient too.
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	});

	it("links each patient name to the consultation detail page", () => {
		render(
			<AdminConsultationsPage
				consultations={[row({}), row({ id: 2, patientName: "Paciente Dois" })]}
			/>,
		);
		expect(screen.getByRole("link", { name: "Paciente Um" }).getAttribute("href")).toBe(
			"/consultations/1",
		);
		expect(screen.getByRole("link", { name: "Paciente Dois" }).getAttribute("href")).toBe(
			"/consultations/2",
		);
	});

	it("filters rows case-insensitively by patient or owner", async () => {
		const user = userEvent.setup();
		render(
			<AdminConsultationsPage
				consultations={[
					row({}),
					row({
						id: 2,
						patientName: "Paciente Dois",
						ownerName: "Dr B",
						ownerEmail: "drb@x.com",
					}),
				]}
			/>,
		);
		await user.type(screen.getByLabelText("Search consultations"), "drb");
		expect(screen.queryByText("Paciente Um")).toBeNull();
		expect(screen.getByText("Paciente Dois")).toBeTruthy();
		expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
	});

	it("shows the no-match row when the filter empties the list", async () => {
		const user = userEvent.setup();
		render(<AdminConsultationsPage consultations={[row({})]} />);
		await user.type(screen.getByLabelText("Search consultations"), "zzz");
		expect(screen.getByText("No consultations match the search.")).toBeTruthy();
		expect(screen.getByText("Showing 0 of 1")).toBeTruthy();
	});
});
