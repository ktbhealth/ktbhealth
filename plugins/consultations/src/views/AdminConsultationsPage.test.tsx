// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
});
