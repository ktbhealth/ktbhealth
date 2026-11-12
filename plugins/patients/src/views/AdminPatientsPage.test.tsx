// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
const fns = vi.hoisted(() => ({
	adminCreatePatientFn: vi.fn(),
	createPatientFn: vi.fn(),
	deletePatientFn: vi.fn(),
	patientDeletionImpactFn: vi.fn(),
	updatePatientFn: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		useRouter: () => ({ invalidate }),
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

vi.mock("../fns.ts", () => fns);

import type { AdminPatientRow, OwnerOption } from "../index.ts";
import { makePatient } from "../testing.ts";
import { AdminPatientsPage } from "./AdminPatientsPage.tsx";

const OWNERS: OwnerOption[] = [
	{ id: "u1", label: "Dra Ana" },
	{ id: "u2", label: "Dr B" },
];

const row = (over: Partial<AdminPatientRow>): AdminPatientRow => ({
	...makePatient({ name: "Ana" }),
	ownerEmail: "dra@x.com",
	ownerName: "Dra Ana",
	...over,
});

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

/** Picks an option from a design-system Select (trigger is aria-labelled). */
const choose = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
	await user.click(screen.getByLabelText(label));
	await user.click(await screen.findByRole("option", { name: option }));
};

describe("AdminPatientsPage", () => {
	it("renders the empty state", () => {
		render(<AdminPatientsPage owners={OWNERS} patients={[]} />);
		expect(screen.getByText("No patients registered.")).toBeTruthy();
		expect(screen.getByText("No patients")).toBeTruthy();
	});

	it("renders the dense table with owner fields", () => {
		render(
			<AdminPatientsPage
				owners={OWNERS}
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
		render(<AdminPatientsPage owners={OWNERS} patients={[row({}), row({ id: 2, name: "Bia" })]} />);
		expect(screen.getByRole("link", { name: "Ana" }).getAttribute("href")).toBe("/patients/1");
		expect(screen.getByRole("link", { name: "Bia" }).getAttribute("href")).toBe("/patients/2");
	});

	it("filters rows case-insensitively by name or owner", async () => {
		const user = userEvent.setup();
		render(
			<AdminPatientsPage
				owners={OWNERS}
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
		render(<AdminPatientsPage owners={OWNERS} patients={[row({})]} />);
		await user.type(screen.getByLabelText("Search patients"), "zzz");
		expect(screen.getByText("No patients match the search.")).toBeTruthy();
		expect(screen.getByText("Showing 0 of 1")).toBeTruthy();
	});

	it("links each row to the edit form", () => {
		render(<AdminPatientsPage owners={OWNERS} patients={[row({})]} />);
		expect(screen.getByRole("link", { name: "Edit Ana" }).getAttribute("href")).toBe(
			"/patients/1/edit",
		);
	});

	it("creates a patient for a chosen owner", async () => {
		const user = userEvent.setup();
		fns.adminCreatePatientFn.mockResolvedValue({ ok: true, patient: { id: 9 } });
		render(<AdminPatientsPage owners={OWNERS} patients={[]} />);
		await user.click(screen.getByRole("button", { name: "New patient" }));
		// Submit stays disabled until an owner is picked.
		expect(screen.getByRole("button", { name: "New patient", hidden: false })).toBeTruthy();
		await choose(user, "Owner", "Dr B");
		await user.type(screen.getByLabelText("Full name"), "New Person");
		await user.type(screen.getByLabelText("Birth date"), "1990-01-02");
		await user.click(screen.getAllByRole("button", { name: "New patient" }).at(-1)!);
		expect(fns.adminCreatePatientFn).toHaveBeenCalledWith({
			data: expect.objectContaining({ ownerId: "u2", name: "New Person" }),
		});
		await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("shows field errors and the generic failure from the create fn", async () => {
		const user = userEvent.setup();
		fns.adminCreatePatientFn.mockResolvedValueOnce({
			ok: false,
			errors: { cpf: "invalid_cpf" },
		});
		render(<AdminPatientsPage owners={OWNERS} patients={[]} />);
		await user.click(screen.getByRole("button", { name: "New patient" }));
		await choose(user, "Owner", "Dra Ana");
		await user.type(screen.getByLabelText("Full name"), "X");
		await user.type(screen.getByLabelText("Birth date"), "1990-01-02");
		await user.type(screen.getByLabelText("CPF"), "123");
		await user.click(screen.getAllByRole("button", { name: "New patient" }).at(-1)!);
		expect(await screen.findByText("Invalid CPF.")).toBeTruthy();

		fns.adminCreatePatientFn.mockResolvedValueOnce({ ok: false, errors: {} });
		await user.click(screen.getAllByRole("button", { name: "New patient" }).at(-1)!);
		expect(await screen.findByText("Could not create the patient. Try again.")).toBeTruthy();
	});

	it("deletes a patient through the cascade dialog", async () => {
		const user = userEvent.setup();
		fns.patientDeletionImpactFn.mockResolvedValue({ consultations: 0 });
		fns.deletePatientFn.mockResolvedValue({ ok: true, consultations: 0, orphanedAudio: 0 });
		render(<AdminPatientsPage owners={OWNERS} patients={[row({})]} />);
		await user.click(screen.getByRole("button", { name: "Delete Ana" }));
		expect(await screen.findByText("This permanently deletes the record of Ana.")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Delete permanently" }));
		expect(fns.deletePatientFn).toHaveBeenCalledWith({ data: 1 });
		await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("closes the delete dialog on cancel without deleting", async () => {
		const user = userEvent.setup();
		fns.patientDeletionImpactFn.mockResolvedValue({ consultations: 0 });
		render(<AdminPatientsPage owners={OWNERS} patients={[row({})]} />);
		await user.click(screen.getByRole("button", { name: "Delete Ana" }));
		expect(await screen.findByText("This permanently deletes the record of Ana.")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await vi.waitFor(() =>
			expect(screen.queryByText("This permanently deletes the record of Ana.")).toBeNull(),
		);
		expect(fns.deletePatientFn).not.toHaveBeenCalled();
	});

	it("lets the owner selection be cleared back to the placeholder", async () => {
		const user = userEvent.setup();
		render(<AdminPatientsPage owners={OWNERS} patients={[]} />);
		await user.click(screen.getByRole("button", { name: "New patient" }));
		await choose(user, "Owner", "Dr B");
		await choose(user, "Owner", "Select an owner");
		expect(fns.adminCreatePatientFn).not.toHaveBeenCalled();
	});

	it("closes the create dialog on escape", async () => {
		const user = userEvent.setup();
		render(<AdminPatientsPage owners={OWNERS} patients={[]} />);
		await user.click(screen.getByRole("button", { name: "New patient" }));
		expect(screen.getByLabelText("Full name")).toBeTruthy();
		await user.keyboard("{Escape}");
		await vi.waitFor(() => expect(screen.queryByLabelText("Full name")).toBeNull());
	});
});
