// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Plugin } from "@ktb/kernel";
import type { AdminConsultationRow } from "@ktb/consultations";
import type { AdminPatientRow } from "@ktb/patients";
import { makePatient } from "@ktb/patients/testing";

import { DashboardPage } from "./DashboardPage.tsx";

const patient = (over: Partial<AdminPatientRow>): AdminPatientRow => ({
	...makePatient({ name: "Ana" }),
	ownerEmail: "d@x.com",
	ownerName: "Dra",
	...over,
});

const consultation = (over: Partial<AdminConsultationRow>): AdminConsultationRow => ({
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
	ownerEmail: "d@x.com",
	ownerName: "Dra",
	patientName: null,
	...over,
});

const plugin = (id: string, sidebar = 0): Plugin =>
	sidebar ? { id, panel: { sidebar: [{ to: "/x", label: id }] } } : { id };

afterEach(cleanup);

describe("DashboardPage", () => {
	it("renders stat cards and empty states", () => {
		render(<DashboardPage patients={[]} consultations={[]} plugins={[plugin("a.b")]} />);
		expect(screen.getByText("dashboard")).toBeTruthy();
		expect(screen.getByText("Patients")).toBeTruthy();
		expect(screen.getByText("Consultations")).toBeTruthy();
		expect(screen.getByText("Plugins")).toBeTruthy();
		expect(screen.getByText("Sidebar items")).toBeTruthy();
		expect(screen.getByText("No consultations yet.")).toBeTruthy();
		expect(screen.getByText("a.b")).toBeTruthy();
	});

	it("renders counts, recent consultations and plugin contributions", () => {
		render(
			<DashboardPage
				patients={[patient({}), patient({ id: 2, name: "Bia" })]}
				consultations={[
					consultation({ id: 9, status: "live", source: "bot" }),
					consultation({ id: 8 }),
				]}
				plugins={[plugin("x.y", 2)]}
			/>,
		);
		// Stat values (patients count and sidebar-item count are both 2).
		expect(screen.getAllByText("2")).toHaveLength(2);
		expect(screen.getByText("live")).toBeTruthy();
		expect(screen.getByText("bot")).toBeTruthy();
		expect(screen.getByText("x.y")).toBeTruthy();
		expect(screen.getByText("panel")).toBeTruthy();
	});
});
