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

afterEach(cleanup);

describe("PatientsPage", () => {
	it("renders the empty state with a registration link", () => {
		render(<PatientsPage patients={[]} />);
		expect(screen.getByText("No patients yet.")).toBeTruthy();
		expect(screen.getByText("Register patient").getAttribute("href")).toBe("/patients/new");
		expect(screen.queryByLabelText("Search patients")).toBeNull();
	});

	it("lists patients with demographics, CPF and record badges", () => {
		render(
			<PatientsPage
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

	it("uses the singular count", () => {
		render(<PatientsPage patients={[BASE]} />);
		expect(screen.getByText("1 patient registered.")).toBeTruthy();
	});

	it("searches by name, social name, CPF and CNS", async () => {
		const user = userEvent.setup();
		render(
			<PatientsPage
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
