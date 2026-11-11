// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
const fns = vi.hoisted(() => ({
	adminCreateConsultationFn: vi.fn(),
	adminDeleteConsultationFn: vi.fn(),
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

import type { AdminConsultationRow } from "../index.ts";
import type { ConsultationPatientOption } from "../platform-page.tsx";
import type { OwnerOption } from "@ktb/patients";
import { AdminConsultationsPage } from "./AdminConsultationsPage.tsx";

const OWNERS: OwnerOption[] = [
	{ id: "u1", label: "Dra Ana" },
	{ id: "u2", label: "Dr B" },
];

const PATIENTS: ConsultationPatientOption[] = [
	{ id: 5, name: "Paciente Um", ownerId: "u1", ownerName: "Dra Ana" },
	{ id: 6, name: "Paciente Dois", ownerId: "u2", ownerName: "Dr B" },
];

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
beforeEach(() => vi.clearAllMocks());

/** Picks an option from a design-system Select (trigger is aria-labelled). */
const choose = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
	await user.click(screen.getByLabelText(label));
	await user.click(await screen.findByRole("option", { name: option }));
};

describe("AdminConsultationsPage", () => {
	it("renders the empty state", () => {
		render(<AdminConsultationsPage owners={OWNERS} patients={PATIENTS} consultations={[]} />);
		expect(screen.getByText("No consultations yet.")).toBeTruthy();
		expect(screen.getByText("No consultations")).toBeTruthy();
	});

	it("renders the dense table with owner and patient fields", () => {
		render(
			<AdminConsultationsPage
				owners={OWNERS}
				patients={PATIENTS}
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
				owners={OWNERS}
				patients={PATIENTS}
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
				owners={OWNERS}
				patients={PATIENTS}
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
		render(
			<AdminConsultationsPage owners={OWNERS} patients={PATIENTS} consultations={[row({})]} />,
		);
		await user.type(screen.getByLabelText("Search consultations"), "zzz");
		expect(screen.getByText("No consultations match the search.")).toBeTruthy();
		expect(screen.getByText("Showing 0 of 1")).toBeTruthy();
	});

	it("creates a consultation for a chosen owner and patient", async () => {
		const user = userEvent.setup();
		fns.adminCreateConsultationFn.mockResolvedValue({ ok: true, id: 42 });
		render(<AdminConsultationsPage owners={OWNERS} patients={PATIENTS} consultations={[]} />);
		await user.click(screen.getByRole("button", { name: "New consultation" }));
		await choose(user, "Owner", "Dr B");
		await choose(user, "Patient", "Paciente Dois — Dr B");
		await user.type(screen.getByLabelText("Transcript"), "hello");
		await user.click(screen.getAllByRole("button", { name: "New consultation" }).at(-1)!);
		expect(fns.adminCreateConsultationFn).toHaveBeenCalledWith({
			data: { userId: "u2", patientId: 6, transcript: "hello" },
		});
		await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("creates without patient or transcript and surfaces failure", async () => {
		const user = userEvent.setup();
		fns.adminCreateConsultationFn.mockResolvedValueOnce({ ok: true, id: 43 });
		render(<AdminConsultationsPage owners={OWNERS} patients={PATIENTS} consultations={[]} />);
		await user.click(screen.getByRole("button", { name: "New consultation" }));
		await choose(user, "Owner", "Dra Ana");
		await user.click(screen.getAllByRole("button", { name: "New consultation" }).at(-1)!);
		expect(fns.adminCreateConsultationFn).toHaveBeenCalledWith({
			data: { userId: "u1" },
		});

		fns.adminCreateConsultationFn.mockResolvedValueOnce({ ok: false });
		await user.click(screen.getByRole("button", { name: "New consultation" }));
		await choose(user, "Owner", "Dra Ana");
		await user.click(screen.getAllByRole("button", { name: "New consultation" }).at(-1)!);
		expect(await screen.findByText("Could not create the consultation. Try again.")).toBeTruthy();
	});

	it("deletes a consultation through the confirm dialog", async () => {
		const user = userEvent.setup();
		fns.adminDeleteConsultationFn.mockResolvedValue({ ok: true, orphanedAudio: 0 });
		render(
			<AdminConsultationsPage owners={OWNERS} patients={PATIENTS} consultations={[row({})]} />,
		);
		await user.click(screen.getByRole("button", { name: "Delete Paciente Um" }));
		expect(
			await screen.findByText("This permanently deletes Paciente Um and its recording."),
		).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Delete permanently" }));
		expect(fns.adminDeleteConsultationFn).toHaveBeenCalledWith({ data: 1 });
		await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("does not reload the list when the delete fails", async () => {
		const user = userEvent.setup();
		fns.adminDeleteConsultationFn.mockResolvedValue({ ok: false });
		render(
			<AdminConsultationsPage owners={OWNERS} patients={PATIENTS} consultations={[row({})]} />,
		);
		await user.click(screen.getByRole("button", { name: "Delete Paciente Um" }));
		expect(
			await screen.findByText("This permanently deletes Paciente Um and its recording."),
		).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Delete permanently" }));
		await vi.waitFor(() => expect(fns.adminDeleteConsultationFn).toHaveBeenCalled());
		// The alert action closes the dialog either way; a failed delete
		// simply skips the reload.
		expect(invalidate).not.toHaveBeenCalled();
	});

	it("clears owner and patient selections back to the placeholders", async () => {
		const user = userEvent.setup();
		render(<AdminConsultationsPage owners={OWNERS} patients={PATIENTS} consultations={[]} />);
		await user.click(screen.getByRole("button", { name: "New consultation" }));
		await choose(user, "Owner", "Dr B");
		await choose(user, "Patient", "Paciente Dois — Dr B");
		await choose(user, "Patient", "No patient");
		await choose(user, "Owner", "Select an owner");
		expect(fns.adminCreateConsultationFn).not.toHaveBeenCalled();
	});

	it("closes the create dialog on escape", async () => {
		const user = userEvent.setup();
		render(<AdminConsultationsPage owners={OWNERS} patients={PATIENTS} consultations={[]} />);
		await user.click(screen.getByRole("button", { name: "New consultation" }));
		expect(screen.getByLabelText("Owner")).toBeTruthy();
		await user.keyboard("{Escape}");
		await vi.waitFor(() => expect(screen.queryByLabelText("Owner")).toBeNull());
	});
});
