// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: (props: Record<string, unknown>) =>
			React.createElement(
				"a",
				{ href: String(props.to ?? "#"), ...props },
				props.children as never,
			),
	};
});

import { ConsultationsPage, type ConsultationListItem } from "./ConsultationsPage.tsx";

const BASE: ConsultationListItem = {
	id: 1,
	engine: "heuristic",
	createdAt: new Date("2026-11-06T14:30:00"),
	transcript: "Médico: oi\nPaciente: olá",
	source: "browser",
	status: "done",
	consentAt: new Date("2026-11-06T14:00:00"),
	patientName: "Maria Silva",
	chiefComplaint: "Dor de cabeça",
	hasAnamnesis: true,
};

const item = (over: Partial<ConsultationListItem>): ConsultationListItem => ({ ...BASE, ...over });

afterEach(cleanup);

describe("ConsultationsPage", () => {
	it("renders empty state", () => {
		render(<ConsultationsPage consultations={[]} />);
		expect(screen.getByText("No consultations yet.")).toBeTruthy();
		expect(screen.getByText("No consultations yet")).toBeTruthy();
		expect(screen.getByText("Start consultation")).toBeTruthy();
	});

	it("links to the patient record only for linked consultations", () => {
		render(
			<ConsultationsPage
				consultations={[
					item({ id: 1, patientId: 5 }),
					item({ id: 2, patientId: null, patientName: null }),
				]}
			/>,
		);
		const links = screen.getAllByText("Patient record");
		expect(links).toHaveLength(1);
		expect(links[0]!.getAttribute("href")).toBe("/patients/$id");
	});

	it("renders singular/plural count and list", () => {
		render(<ConsultationsPage consultations={[item({})]} />);
		expect(screen.getByText("1 consultation recorded.")).toBeTruthy();
		expect(screen.getByText("Maria Silva")).toBeTruthy();
		expect(screen.getByText("Dor de cabeça")).toBeTruthy();
	});

	it("renders badges for live/anamnesis/consent/source", () => {
		render(
			<ConsultationsPage
				consultations={[
					item({
						status: "live",
						source: "bot",
						patientName: null,
						hasAnamnesis: false,
						consentAt: null,
					}),
				]}
			/>,
		);
		expect(screen.getByText("● live")).toBeTruthy();
		expect(screen.getByText("No anamnesis")).toBeTruthy();
		expect(screen.getByText("Teleconsult (bot)")).toBeTruthy();
		expect(screen.getByText("Unlinked patient")).toBeTruthy();
		expect(screen.getByText("Dor de cabeça")).toBeTruthy();
	});

	it("falls back to transcript when queixa is placeholder", () => {
		render(
			<ConsultationsPage
				consultations={[
					item({ chiefComplaint: "A preencher pelo médico", transcript: "fallback text" }),
				]}
			/>,
		);
		expect(screen.getByText("fallback text")).toBeTruthy();
	});

	it("shows 'No transcript' when no chiefComplaint and empty transcript", () => {
		render(<ConsultationsPage consultations={[item({ chiefComplaint: null, transcript: "" })]} />);
		expect(screen.getByText("No transcript.")).toBeTruthy();
	});

	it("shows PDF link only with anamnesis", () => {
		const { rerender } = render(
			<ConsultationsPage consultations={[item({ hasAnamnesis: true })]} />,
		);
		expect(screen.getByText("PDF")).toBeTruthy();
		rerender(<ConsultationsPage consultations={[item({ hasAnamnesis: false })]} />);
		expect(screen.queryByText("PDF")).toBeNull();
	});

	it("filters by search text across fields", async () => {
		const user = userEvent.setup();
		render(
			<ConsultationsPage
				consultations={[
					item({ id: 1, patientName: "Ana" }),
					item({ id: 2, patientName: "Bia", chiefComplaint: "Tosse seca" }),
				]}
			/>,
		);
		const input = screen.getByLabelText("Search consultations");
		await user.type(input, "tosse");
		expect(screen.queryByText("Ana")).toBeNull();
		expect(screen.getByText("Bia")).toBeTruthy();
		await user.clear(input);
		await user.type(input, "zzz-nada");
		expect(screen.getByText(/No consultations match/)).toBeTruthy();
	});

	it("filters by anamnesis/pending tabs", async () => {
		const user = userEvent.setup();
		render(
			<ConsultationsPage
				consultations={[
					item({ id: 1, patientName: "Ana", hasAnamnesis: true }),
					item({ id: 2, patientName: "Bia", hasAnamnesis: false }),
				]}
			/>,
		);
		await user.click(screen.getByText("With anamnesis"));
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.queryByText("Bia")).toBeNull();
		await user.click(screen.getByText("Pending"));
		expect(screen.getByText("Bia")).toBeTruthy();
		expect(screen.queryByText("Ana")).toBeNull();
		await user.click(screen.getByText("All"));
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.getByText("Bia")).toBeTruthy();
	});

	it("handles initials edge cases", () => {
		render(
			<ConsultationsPage
				consultations={[
					item({ id: 1, patientName: "  " }),
					item({ id: 2, patientName: "Single" }),
					item({ id: 3, patientName: "Um Dois Tres" }),
				]}
			/>,
		);
	});

	it("falls back to raw source label for unknown sources", () => {
		render(
			<ConsultationsPage
				consultations={[
					item({ id: 1, source: "custom-source" }),
					item({ id: 2, source: null, patientName: "Bia" }),
				]}
			/>,
		);
		expect(screen.getByText("custom-source")).toBeTruthy();
	});

	it("hides search when list is empty", () => {
		render(<ConsultationsPage consultations={[]} />);
		expect(screen.queryByLabelText("Search consultations")).toBeNull();
	});
});
