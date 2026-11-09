// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminPatientRow } from "../index.ts";
import { makePatient } from "../testing.ts";
import { AdminPatientsPage } from "./AdminPatientsPage.tsx";

const row = (over: Partial<AdminPatientRow>): AdminPatientRow => ({
	...makePatient({ name: "Ana" }),
	ownerEmail: "dra@x.com",
	ownerName: "Dra Ana",
	...over,
});

afterEach(cleanup);

describe("AdminPatientsPage", () => {
	it("renders the empty state", () => {
		render(<AdminPatientsPage patients={[]} />);
		expect(screen.getByText("No patients registered.")).toBeTruthy();
		expect(screen.getByText("No patients")).toBeTruthy();
	});

	it("renders the dense table with owner fields", () => {
		render(
			<AdminPatientsPage
				patients={[
					row({}),
					row({ id: 2, name: "Bia", ownerId: "u2", ownerEmail: null, ownerName: null }),
				]}
			/>,
		);
		expect(screen.getByText("2 patients across all owners.")).toBeTruthy();
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.getByText("Bia")).toBeTruthy();
		expect(screen.getByText("Dra Ana")).toBeTruthy();
		// Missing owner profile falls back to email, then dash.
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	});
});
