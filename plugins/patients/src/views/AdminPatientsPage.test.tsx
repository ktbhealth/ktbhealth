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

	it("links each patient name to the patient detail page", () => {
		render(<AdminPatientsPage patients={[row({}), row({ id: 2, name: "Bia" })]} />);
		expect(screen.getByRole("link", { name: "Ana" }).getAttribute("href")).toBe("/patients/1");
		expect(screen.getByRole("link", { name: "Bia" }).getAttribute("href")).toBe("/patients/2");
	});

	it("filters rows case-insensitively by name or owner", async () => {
		const user = userEvent.setup();
		render(
			<AdminPatientsPage
				patients={[
					row({}),
					row({ id: 2, name: "Bia", ownerId: "u2", ownerEmail: "drb@x.com", ownerName: "Dr B" }),
				]}
			/>,
		);
		await user.type(screen.getByLabelText("Search patients"), "drb");
		expect(screen.queryByText("Ana")).toBeNull();
		expect(screen.getByText("Bia")).toBeTruthy();
		expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
	});

	it("shows the no-match row when the filter empties the list", async () => {
		const user = userEvent.setup();
		render(<AdminPatientsPage patients={[row({})]} />);
		await user.type(screen.getByLabelText("Search patients"), "zzz");
		expect(screen.getByText("No patients match the search.")).toBeTruthy();
		expect(screen.getByText("Showing 0 of 1")).toBeTruthy();
	});
});
