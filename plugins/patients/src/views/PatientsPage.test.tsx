// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, params, search: _search, ...props }: Record<string, unknown>) =>
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

import { PatientsPage, type PatientListItem } from "./PatientsPage.tsx";

const BASE: PatientListItem = {
	id: 1,
	name: "Maria Silva",
	socialName: null,
	gender: "female",
	birthDate: "1984-03-05",
	cpf: "52998224725",
	cns: null,
	active: true,
};

const item = (over: Partial<PatientListItem>): PatientListItem => ({ ...BASE, ...over });

import type { PatientDeleteApi } from "./DeletePatientDialog.tsx";

afterEach(cleanup);

const actions = {
	deleteApi: {
		impact: vi.fn<PatientDeleteApi["impact"]>(async () => ({ consultations: 0 })),
		remove: vi.fn<PatientDeleteApi["remove"]>(async () => ({ ok: true })),
	},
	onDeleted: vi.fn<() => void>(),
};

describe("PatientsPage", () => {
	it("renders the empty state with a registration link", () => {
		render(<PatientsPage patients={[]} locale="en" {...actions} />);
		expect(screen.getByText("No patients yet.")).toBeTruthy();
		expect(screen.getByText("Register patient").getAttribute("href")).toBe("/patients/new");
		expect(screen.queryByLabelText("Search patients")).toBeNull();
	});

	it("lists patients with demographics, CPF and record badges", () => {
		render(
			<PatientsPage
				locale="en"
				{...actions}
				patients={[
					BASE,
					item({
						id: 2,
						name: "João Pereira",
						socialName: "Joana Pereira",
						gender: null,
						birthDate: null,
						cpf: null,
						active: false,
					}),
				]}
			/>,
		);
		expect(screen.getByText("2 patients registered.")).toBeTruthy();
		const maria = screen.getByText("Maria Silva");
		expect(maria.getAttribute("href")).toBe("/patients/1");
		expect(screen.getByText(/Female · \d+ years · CPF 529\.982\.247-25/)).toBeTruthy();
		// social name first, civil name as a hint
		expect(screen.getByText("Joana Pereira").getAttribute("href")).toBe("/patients/2");
		expect(screen.getByText("(João Pereira)")).toBeTruthy();
		expect(screen.getByText("No demographics recorded")).toBeTruthy();
		expect(screen.getByText("Inactive")).toBeTruthy();
		expect(screen.getByText("Incomplete record")).toBeTruthy();
		expect(screen.getByText("JP")).toBeTruthy();
	});

	it("renders in Portuguese for pt-BR", () => {
		render(
			<PatientsPage
				locale="pt-BR"
				{...actions}
				patients={[BASE, item({ id: 2, birthDate: null, gender: null, cpf: null, active: false })]}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Pacientes" })).toBeTruthy();
		expect(screen.getByText("2 pacientes cadastrados.")).toBeTruthy();
		expect(screen.getByText(/Feminino · \d+ anos · CPF 529\.982\.247-25/)).toBeTruthy();
		expect(screen.getByLabelText("Buscar pacientes")).toBeTruthy();
		expect(screen.getByText("Novo paciente")).toBeTruthy();
		expect(screen.getByText("Inativo")).toBeTruthy();
		expect(screen.getByText("Cadastro incompleto")).toBeTruthy();
		expect(screen.getByText("Sem dados demográficos registrados")).toBeTruthy();
	});

	it("uses the singular count", () => {
		render(<PatientsPage patients={[BASE]} locale="en" {...actions} />);
		expect(screen.getByText("1 patient registered.")).toBeTruthy();
	});

	it("offers edit, export and delete per patient from the row menu", async () => {
		const user = userEvent.setup();
		const deleteApi = {
			impact: vi.fn<PatientDeleteApi["impact"]>(async () => ({ consultations: 2 })),
			remove: vi.fn<PatientDeleteApi["remove"]>(async () => ({ ok: true })),
		};
		const onDeleted = vi.fn<(id: number) => void>();
		render(
			<PatientsPage
				patients={[BASE, item({ id: 2, name: "João Pereira", socialName: "Joana Pereira" })]}
				locale="en"
				deleteApi={deleteApi}
				onDeleted={onDeleted}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Actions for Joana Pereira" }));
		expect(
			(await screen.findByRole("menuitem", { name: "Edit record" })).getAttribute("href"),
		).toBe("/patients/2/edit");
		const fhir = screen.getByRole("menuitem", { name: "HL7 FHIR R4 (JSON)" });
		expect(fhir.getAttribute("href")).toBe("/api/patients/2/export?format=fhir-r4");
		expect(fhir.hasAttribute("download")).toBe(true);
		expect(screen.getByRole("menuitem", { name: "openEHR (JSON)" }).getAttribute("href")).toBe(
			"/api/patients/2/export?format=openehr",
		);

		await user.click(screen.getByRole("menuitem", { name: "Delete patient" }));
		expect(
			await screen.findByText("This permanently deletes the record of Joana Pereira."),
		).toBeTruthy();
		await user.click(await screen.findByRole("checkbox"));
		await user.click(screen.getByRole("button", { name: "Delete permanently" }));
		expect(deleteApi.remove).toHaveBeenCalledWith(2);
		expect(onDeleted).toHaveBeenCalledWith(2);
		expect(screen.queryByText("This permanently deletes the record of Joana Pereira.")).toBeNull();
	});

	it("closes the delete dialog on cancel", async () => {
		const user = userEvent.setup();
		render(<PatientsPage patients={[BASE]} locale="pt-BR" {...actions} />);
		await user.click(screen.getByRole("button", { name: "Ações para Maria Silva" }));
		expect(await screen.findByRole("menuitem", { name: "Editar cadastro" })).toBeTruthy();
		await user.click(screen.getByRole("menuitem", { name: "Excluir paciente" }));
		await user.click(await screen.findByRole("button", { name: "Cancelar" }));
		expect(screen.queryByText("Excluir paciente?")).toBeNull();
	});

	it("searches by name, social name, CPF and CNS", async () => {
		const user = userEvent.setup();
		render(
			<PatientsPage
				locale="en"
				{...actions}
				patients={[
					BASE,
					item({ id: 2, name: "Ana Costa", socialName: "Nina", cpf: null, cns: "100000000000007" }),
				]}
			/>,
		);
		const search = screen.getByLabelText("Search patients");

		await user.type(search, "nina");
		expect(screen.queryByText("Maria Silva")).toBeNull();
		expect(screen.getByText("Nina")).toBeTruthy();

		await user.clear(search);
		await user.type(search, "529.982");
		expect(screen.getByText("Maria Silva")).toBeTruthy();
		expect(screen.queryByText("Nina")).toBeNull();

		await user.clear(search);
		await user.type(search, "1000000");
		expect(screen.getByText("Nina")).toBeTruthy();

		await user.clear(search);
		await user.type(search, "zzz");
		expect(screen.getByText("No patients match the search.")).toBeTruthy();

		await user.clear(search);
		expect(screen.getByText("Maria Silva")).toBeTruthy();
	});
});
