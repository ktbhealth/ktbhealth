// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, ...props }: Record<string, unknown>) =>
			React.createElement("a", { ...props, href: String(to) }, props.children as never),
	};
});

import { makePatient } from "../testing.ts";
import { PatientFormPage, type PatientFormApi } from "./PatientFormPage.tsx";

type Save = PatientFormApi["save"];

afterEach(cleanup);

const YEAR = new Date().getFullYear();

const setup = (
	api: PatientFormApi,
	patient?: Parameters<typeof PatientFormPage>[0]["patient"],
	locale = "en",
) => {
	const onSaved = vi.fn<(id: number) => void>();
	const user = userEvent.setup();
	render(<PatientFormPage patient={patient} api={api} onSaved={onSaved} locale={locale} />);
	return { user, onSaved };
};

/** Label lookup tolerant of the decorative required marker ("Full name*"). */
const input = (label: string) =>
	screen.getByLabelText(
		new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\*?$`),
	) as HTMLInputElement;

type User = ReturnType<typeof userEvent.setup>;

/** Label shown by a design-system Select (its value slot, not the trigger's icon). */
const shown = (label: string) =>
	input(label).querySelector('[data-slot="select-value"]')?.textContent;

/** Picks an option from a design-system Select (trigger is labelled by the field). */
const choose = async (user: User, label: string, option: string) => {
	await user.click(input(label));
	await user.click(await screen.findByRole("option", { name: option }));
};

/** Picks an exact day from the birth-date Calendar popover. */
const pickDate = async (user: User, year: number, month: string, day: number) => {
	await user.click(input("Birth date"));
	await user.selectOptions(await screen.findByRole("combobox", { name: /year/i }), String(year));
	await user.selectOptions(screen.getByRole("combobox", { name: /month/i }), month);
	await user.click(
		screen.getByRole("button", { name: new RegExp(`${month} ${day}\\w*, ${year}`) }),
	);
};

describe("PatientFormPage — registration", () => {
	it("starts with Brazilian defaults and no active toggle", () => {
		setup({ save: vi.fn<Save>() });
		expect(screen.getByRole("heading", { name: "New patient" })).toBeTruthy();
		expect(shown("Country")).toBe("Brazil");
		expect(shown("Nationality")).toBe("Brazil");
		expect(shown("Preferred language")).toBe("Portuguese (Brazil)");
		expect(shown("Sex (administrative)")).toBe("—");
		expect(input("Birth date").textContent).toBe("Pick a date");
		expect(screen.getByLabelText("CEP")).toBeTruthy();
		// Brazil → state is a UF select
		expect(screen.getByRole("combobox", { name: "State" })).toBeTruthy();
		expect(screen.queryByText("Active record")).toBeNull();
		expect(screen.getByText("Cancel").getAttribute("href")).toBe("/patients");
	});

	it("blocks submit with inline errors when name and birth date are missing", async () => {
		const save = vi.fn<Save>();
		const { user } = setup({ save });
		await user.click(screen.getByRole("button", { name: "Register patient" }));
		expect(screen.getByText("Name is required.")).toBeTruthy();
		expect(screen.getByText("Birth date (or age) is required.")).toBeTruthy();
		expect(screen.getByText("Please fix the highlighted fields.")).toBeTruthy();
		expect(input("Full name").getAttribute("aria-invalid")).toBe("true");
		expect(save).not.toHaveBeenCalled();
	});

	it("registers by name + age as a year-only FHIR birth date", async () => {
		const save = vi.fn<Save>().mockResolvedValue({ ok: true, patient: { id: 42 } });
		const { user, onSaved } = setup({ save });
		await user.type(input("Full name"), "Ana Souza");
		await user.type(input("Age in years"), "40");
		expect(
			screen.getByText(`Recorded as ${YEAR - 40} (approximate). Enter the exact date if known.`),
		).toBeTruthy();
		await choose(user, "Sex (administrative)", "Female");
		await user.click(screen.getByRole("button", { name: "Register patient" }));
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Ana Souza",
				birthDate: String(YEAR - 40),
				gender: "female",
				active: true,
			}),
		);
		expect(onSaved).toHaveBeenCalledWith(42);
	});

	it("an exact date replaces the age; clearing the age clears the birth date", async () => {
		const { user } = setup({ save: vi.fn<Save>() });
		await user.type(input("Age in years"), "30");
		await pickDate(user, 1990, "May", 10);
		expect(input("Age in years").value).toBe("");
		expect(input("Birth date").textContent).toBe("10/05/1990");
		expect(screen.queryByText(/approximate/)).toBeNull();

		await user.type(input("Age in years"), "5");
		await user.clear(input("Age in years"));
		await user.type(input("Full name"), "X");
		await user.click(screen.getByRole("button", { name: "Register patient" }));
		expect(screen.getByText("Birth date (or age) is required.")).toBeTruthy();
	});

	it("validates identifiers on the client", async () => {
		const save = vi.fn<Save>();
		const { user } = setup({ save });
		await user.type(input("Full name"), "Ana");
		await user.type(input("Age in years"), "40");
		await user.type(input("CPF"), "123.456.789-00");
		await user.click(screen.getByRole("button", { name: "Register patient" }));
		expect(screen.getByText("Invalid CPF.")).toBeTruthy();
		expect(save).not.toHaveBeenCalled();
	});

	it("switches to free-form state and postal code outside Brazil", async () => {
		const { user } = setup({ save: vi.fn<Save>() });
		await choose(user, "Country", "Portugal");
		expect(screen.getByLabelText("State / province").tagName).toBe("INPUT");
		expect(screen.getByLabelText("Postal code")).toBeTruthy();
	});

	it("shows server-side field errors", async () => {
		const save = vi.fn<Save>().mockResolvedValue({
			ok: false,
			errors: { email: "invalid_email", maritalStatus: "invalid_option" },
		});
		const { user, onSaved } = setup({ save });
		await user.type(input("Full name"), "Ana");
		await user.type(input("Age in years"), "40");
		await user.click(screen.getByRole("button", { name: "Register patient" }));
		expect(await screen.findByText("Invalid email.")).toBeTruthy();
		expect(screen.getByText("Choose a valid option.")).toBeTruthy();
		expect(input("Marital status").getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByText("Please fix the highlighted fields.")).toBeTruthy();
		expect(onSaved).not.toHaveBeenCalled();
	});

	it("reports a rejected save without field errors", async () => {
		const save = vi.fn<Save>().mockResolvedValue({ ok: false, errors: {} });
		const { user } = setup({ save });
		await user.type(input("Full name"), "Ana");
		await user.type(input("Age in years"), "40");
		await user.click(screen.getByRole("button", { name: "Register patient" }));
		expect(await screen.findByText("Could not save the patient.")).toBeTruthy();
	});

	it("reports a failed request", async () => {
		const save = vi.fn<Save>().mockRejectedValue(new Error("network"));
		const { user } = setup({ save });
		await user.type(input("Full name"), "Ana");
		await user.type(input("Age in years"), "40");
		await user.click(screen.getByRole("button", { name: "Register patient" }));
		expect(await screen.findByText("Could not save the patient. Try again.")).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Register patient" }) as HTMLButtonElement).disabled,
		).toBe(false);
	});
});

describe("PatientFormPage — edit", () => {
	const patient = makePatient({
		id: 7,
		name: "Maria Silva",
		birthDate: "1984",
		gender: "female",
		country: "US",
		state: "CA",
		cpf: "52998224725",
	});

	it("prefills the record, including an approximate birth date", () => {
		setup({ save: vi.fn<Save>() }, patient);
		expect(screen.getByRole("heading", { name: "Edit patient" })).toBeTruthy();
		expect(input("Full name").value).toBe("Maria Silva");
		expect(input("CPF").value).toBe("52998224725");
		expect(input("Birth date").textContent).toBe("Pick a date");
		expect(input("Age in years").value).toBe(String(YEAR - 1984));
		expect(
			screen.getByText("Recorded as 1984 (approximate). Enter the exact date if known."),
		).toBeTruthy();
		expect(input("State / province").value).toBe("CA");
		expect(screen.getByText("Cancel").getAttribute("href")).toBe("/patients/7");
	});

	it("prefills an exact birth date without an age; re-picking the day clears it", async () => {
		const { user } = setup({ save: vi.fn<Save>() }, makePatient({ birthDate: "1984-03-05" }));
		expect(input("Birth date").textContent).toBe("05/03/1984");
		expect(input("Age in years").value).toBe("");

		await user.click(input("Birth date"));
		await user.click(await screen.findByRole("button", { name: /March 5\w*, 1984/ }));
		expect(input("Birth date").textContent).toBe("Pick a date");
	});

	it("clears a coded field back to empty", async () => {
		const save = vi.fn<Save>().mockResolvedValue({ ok: true, patient: { id: 7 } });
		const { user } = setup({ save }, patient);
		expect(shown("Sex (administrative)")).toBe("Female");
		await choose(user, "Sex (administrative)", "—");
		await user.click(screen.getByRole("button", { name: "Save changes" }));
		expect(save).toHaveBeenCalledWith(expect.objectContaining({ gender: "" }));
	});

	it("can deactivate the record and save changes", async () => {
		const save = vi.fn<Save>().mockResolvedValue({ ok: true, patient: { id: 7 } });
		const { user, onSaved } = setup({ save }, patient);
		await user.click(screen.getByRole("checkbox"));
		await user.clear(input("Full name"));
		await user.type(input("Full name"), "Maria S. Lima");
		await user.click(screen.getByRole("button", { name: "Save changes" }));
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Maria S. Lima", active: false, birthDate: "1984" }),
		);
		expect(onSaved).toHaveBeenCalledWith(7);
	});
});

describe("PatientFormPage — pt-BR", () => {
	it("renders labels, options and the calendar in Portuguese", async () => {
		const { user } = setup({ save: vi.fn<Save>() }, undefined, "pt-BR");
		expect(screen.getByRole("heading", { name: "Novo paciente" })).toBeTruthy();
		expect(shown("País")).toBe("Brasil");
		expect(shown("Idioma preferido")).toBe("Português (Brasil)");
		expect(input("Data de nascimento").textContent).toBe("Selecione uma data");
		expect(screen.getByRole("combobox", { name: "Estado" })).toBeTruthy();
		expect(screen.getByText("Contato de emergência")).toBeTruthy();

		await user.click(input("Data de nascimento"));
		expect(screen.getByRole("combobox", { name: "Escolha o ano" })).toBeTruthy();
		await user.keyboard("{Escape}");

		await choose(user, "Sexo (administrativo)", "Feminino");
		expect(shown("Sexo (administrativo)")).toBe("Feminino");
	});

	it("shows local and server validation errors in Portuguese", async () => {
		const save = vi.fn<Save>().mockResolvedValue({ ok: false, errors: { email: "invalid_email" } });
		const { user } = setup({ save }, undefined, "pt-BR");
		await user.click(screen.getByRole("button", { name: "Cadastrar paciente" }));
		expect(screen.getByText("O nome é obrigatório.")).toBeTruthy();
		expect(screen.getByText("A data de nascimento (ou idade) é obrigatória.")).toBeTruthy();
		expect(screen.getByText("Corrija os campos destacados.")).toBeTruthy();

		await user.type(input("Nome completo"), "Ana");
		await user.type(input("Idade em anos"), "40");
		expect(
			screen.getByText(
				`Registrado como ${YEAR - 40} (aproximado). Informe a data exata, se souber.`,
			),
		).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Cadastrar paciente" }));
		expect(await screen.findByText("E-mail inválido.")).toBeTruthy();
	});

	it("reports failed saves in Portuguese", async () => {
		const save = vi
			.fn<Save>()
			.mockResolvedValueOnce({ ok: false, errors: {} })
			.mockRejectedValueOnce(new Error("network"));
		const { user } = setup({ save }, makePatient({ birthDate: "1984" }), "pt-BR");
		expect(screen.getByRole("heading", { name: "Editar paciente" })).toBeTruthy();
		expect(screen.getByText("Cadastro ativo")).toBeTruthy();
		expect(screen.getByText("Cancelar")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
		expect(await screen.findByText("Não foi possível salvar o paciente.")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
		expect(
			await screen.findByText("Não foi possível salvar o paciente. Tente novamente."),
		).toBeTruthy();
	});
});
