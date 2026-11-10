// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PanelPageContext } from "@ktb/kernel";

import type { AdminConsultationRow } from "./index.ts";
import { ConsultationsPlatformPage } from "./platform-page.tsx";

afterEach(cleanup);

const ctx: PanelPageContext = { plugins: [], locale: "en" };

const row = {
	id: 7,
	status: "done",
	source: "upload",
	patientName: "Ana",
	ownerName: "Dr. Bia",
	ownerEmail: "bia@ktb.test",
	createdAt: new Date("2026-11-09T12:00:00Z"),
} as unknown as AdminConsultationRow;

describe("ConsultationsPlatformPage", () => {
	it("renders the empty state when the loader returns no rows", () => {
		render(<ConsultationsPlatformPage data={[]} ctx={ctx} />);
		expect(screen.getByText("No consultations")).toBeTruthy();
	});

	it("narrows the loader data into the admin listing rows", () => {
		render(<ConsultationsPlatformPage data={[row]} ctx={ctx} />);
		expect(screen.getByText("1 consultation across all owners.")).toBeTruthy();
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.getByText("Dr. Bia")).toBeTruthy();
	});
});
