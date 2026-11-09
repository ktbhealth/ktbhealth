// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { patientMessages } from "../i18n.ts";
import { DeletePatientDialog, type PatientDeleteApi } from "./DeletePatientDialog.tsx";

afterEach(cleanup);

const PATIENT = { id: 7, name: "Cida" };

const setup = (api: Partial<PatientDeleteApi>, locale = "en") => {
	// Standalone mocks (not object methods) so assertions never read unbound methods.
	const impact =
		api.impact ?? vi.fn<PatientDeleteApi["impact"]>(async () => ({ consultations: 0 }));
	const remove = vi.fn<PatientDeleteApi["remove"]>(api.remove ?? (async () => ({ ok: true })));
	const onClose = vi.fn<() => void>();
	const onDeleted = vi.fn<(id: number) => void>();
	render(
		<DeletePatientDialog
			patient={PATIENT}
			api={{ impact, remove }}
			t={patientMessages(locale)}
			onClose={onClose}
			onDeleted={onDeleted}
		/>,
	);
	return { remove, onClose, onDeleted, user: userEvent.setup() };
};

const confirmButton = (name = "Delete permanently") =>
	screen.getByRole("button", { name }) as HTMLButtonElement;

describe("DeletePatientDialog", () => {
	it("renders nothing without a patient", () => {
		render(
			<DeletePatientDialog
				patient={null}
				api={{
					impact: vi.fn<PatientDeleteApi["impact"]>(),
					remove: vi.fn<PatientDeleteApi["remove"]>(),
				}}
				t={patientMessages("en")}
				onClose={vi.fn<() => void>()}
				onDeleted={vi.fn<() => void>()}
			/>,
		);
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("deletes a patient without consultations after a single confirmation", async () => {
		const { remove, onDeleted, user } = setup({});
		expect(screen.getByText("Checking linked consultations…")).toBeTruthy();
		expect(confirmButton().disabled).toBe(true);
		expect(await screen.findByText(/has no consultations/)).toBeTruthy();
		expect(screen.getByText("This permanently deletes the record of Cida.")).toBeTruthy();
		expect(screen.queryByRole("checkbox")).toBeNull();
		await user.click(confirmButton());
		expect(remove).toHaveBeenCalledWith(7);
		expect(onDeleted).toHaveBeenCalledWith(7);
	});

	it("spells out the consultation cascade and requires an explicit acknowledgement", async () => {
		const { remove, onDeleted, user } = setup({
			impact: vi.fn<PatientDeleteApi["impact"]>(async () => ({ consultations: 3 })),
		});
		expect(
			await screen.findByText(
				"3 consultations of this patient will also be permanently deleted, including transcripts, anamneses and audio recordings. This action cannot be undone.",
			),
		).toBeTruthy();
		expect(confirmButton().disabled).toBe(true);
		await user.click(screen.getByRole("checkbox"));
		expect(screen.getByText("I understand that 3 consultations will be deleted")).toBeTruthy();
		expect(confirmButton().disabled).toBe(false);
		await user.click(confirmButton());
		expect(remove).toHaveBeenCalledWith(7);
		expect(onDeleted).toHaveBeenCalledWith(7);
	});

	it("uses the singular for one consultation", async () => {
		setup({ impact: vi.fn<PatientDeleteApi["impact"]>(async () => ({ consultations: 1 })) });
		expect(await screen.findByText(/^1 consultation of this patient/)).toBeTruthy();
		expect(screen.getByText("I understand that 1 consultation will be deleted")).toBeTruthy();
	});

	it("reports a failed or refused deletion and stays open", async () => {
		const remove = vi
			.fn<PatientDeleteApi["remove"]>()
			.mockResolvedValueOnce({ ok: false })
			.mockRejectedValueOnce(new Error("network"));
		const { onDeleted, user } = setup({ remove });
		await screen.findByText(/has no consultations/);
		await user.click(confirmButton());
		expect(await screen.findByText("Could not delete the patient. Try again.")).toBeTruthy();
		await user.click(confirmButton());
		expect(remove).toHaveBeenCalledTimes(2);
		expect(screen.getByText("Could not delete the patient. Try again.")).toBeTruthy();
		expect(onDeleted).not.toHaveBeenCalled();
	});

	it("cannot confirm when the impact check fails", async () => {
		setup({ impact: vi.fn<PatientDeleteApi["impact"]>(async () => null) });
		expect(await screen.findByText("Could not delete the patient. Try again.")).toBeTruthy();
		expect(confirmButton().disabled).toBe(true);
		cleanup();
		setup({
			impact: vi.fn<PatientDeleteApi["impact"]>(async () => Promise.reject(new Error("down"))),
		});
		expect(await screen.findByText("Could not delete the patient. Try again.")).toBeTruthy();
	});

	it("closes on cancel", async () => {
		const { onClose, user } = setup({});
		await screen.findByText(/has no consultations/);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).toHaveBeenCalled();
	});

	it("ignores an impact answer that arrives after closing", async () => {
		let resolve: (v: { consultations: number }) => void = () => {};
		const impact = vi.fn<PatientDeleteApi["impact"]>(
			() => new Promise<{ consultations: number }>((r) => (resolve = r)),
		);
		setup({ impact });
		cleanup();
		await act(async () => resolve({ consultations: 2 }));
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("speaks Portuguese", async () => {
		setup(
			{ impact: vi.fn<PatientDeleteApi["impact"]>(async () => ({ consultations: 2 })) },
			"pt-BR",
		);
		expect(
			await screen.findByText(
				"2 consultas deste paciente também serão excluídas permanentemente, incluindo transcrições, anamneses e gravações de áudio. Esta ação não pode ser desfeita.",
			),
		).toBeTruthy();
		expect(screen.getByText("Entendo que 2 consultas serão excluídas")).toBeTruthy();
		expect(screen.getByText("Excluir paciente?")).toBeTruthy();
		expect(confirmButton("Excluir permanentemente")).toBeTruthy();
		cleanup();
		setup(
			{ impact: vi.fn<PatientDeleteApi["impact"]>(async () => ({ consultations: 1 })) },
			"pt-BR",
		);
		expect(await screen.findByText(/^1 consulta deste paciente também será excluída/)).toBeTruthy();
		expect(screen.getByText("Entendo que 1 consulta será excluída")).toBeTruthy();
	});
});
