// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, params, search, ...props }: Record<string, unknown>) => {
			const path = String(to).replace("$id", String((params as { id?: string })?.id ?? ""));
			const qs = search ? `?${new URLSearchParams(search as Record<string, string>)}` : "";
			return React.createElement("a", { ...props, href: path + qs }, props.children as never);
		},
	};
});

import { makePatient } from "../testing.ts";
import { PatientDetailPage, type PatientConsultationItem } from "./PatientDetailPage.tsx";

const FULL = makePatient({
	id: 7,
	name: "Maria Aparecida Silva",
	socialName: "Cida",
	gender: "female",
	birthDate: "1984-03-05",
	cpf: "52998224725",
	cns: "100000000000007",
	passport: "FX123456",
	phone: "+55 81 98765-4321",
	email: "cida@example.com",
	preferredLanguage: "pt-BR",
	addressLine: "Rua da Aurora",
	addressNumber: "100",
	addressComplement: "apto 12",
	district: "Boa Vista",
	city: "Recife",
	state: "PE",
	postalCode: "50050000",
	country: "BR",
	motherName: "Josefa Silva",
	maritalStatus: "M",
	raceColor: "03",
	nationality: "BR",
	emergencyContactName: "Pedro Silva",
	emergencyContactRelationship: "son",
	emergencyContactPhone: "81 3333-4444",
});

const consult = (over: Partial<PatientConsultationItem>): PatientConsultationItem => ({
	id: 10,
	createdAt: new Date("2026-11-05T14:00:00"),
	status: "done",
	hasAnamnesis: true,
	chiefComplaint: "Cefaleia há 3 dias",
	...over,
});

afterEach(cleanup);

const dd = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("PatientDetailPage", () => {
	it("renders every recorded section with formatted values", () => {
		render(<PatientDetailPage patient={FULL} consultations={[]} />);
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Cida");
		expect(screen.getByText(/^Female · \d+ years$/)).toBeTruthy();
		expect(dd("Full name")).toBe("Maria Aparecida Silva");
		expect(dd("Birth date")).toMatch(/^05\/03\/1984 \(\d+ years\)$/);
		expect(dd("CPF")).toBe("529.982.247-25");
		expect(dd("CNS")).toBe("100 0000 0000 0007");
		expect(dd("Preferred language")).toBe("Portuguese (Brazil)");
		expect(dd("Street")).toBe("Rua da Aurora, 100 · apto 12");
		expect(dd("City")).toBe("Recife / PE");
		expect(dd("Postal code")).toBe("50050-000");
		expect(dd("Country")).toBe("Brazil");
		expect(dd("Marital status")).toBe("Married");
		expect(dd("Race / color")).toBe("Parda (mixed)");
		expect(dd("Nationality")).toBe("Brazil");
		const emergency = screen.getByText("Emergency contact").parentElement!;
		expect(within(emergency).getByText("Pedro Silva · son")).toBeTruthy();
		expect(screen.queryByText(/record is incomplete/)).toBeNull();
		expect(screen.queryByText("Inactive")).toBeNull();
	});

	it("links edit and a new consultation preselecting the patient", () => {
		render(<PatientDetailPage patient={FULL} consultations={[]} />);
		expect(screen.getByText("Edit record").closest("a")?.getAttribute("href")).toBe(
			"/patients/7/edit",
		);
		expect(screen.getByText("New consultation").closest("a")!.getAttribute("href")).toBe(
			"/consultations/new?patientId=7",
		);
		expect(screen.getByText("No consultations for this patient yet.")).toBeTruthy();
	});

	it("flags an incomplete, inactive name-only record and hides empty sections", () => {
		render(<PatientDetailPage patient={makePatient({ active: false })} consultations={[]} />);
		expect(screen.getByText("No demographics recorded")).toBeTruthy();
		expect(screen.getByText("Inactive")).toBeTruthy();
		expect(screen.getByText("Complete the record").getAttribute("href")).toBe("/patients/1/edit");
		expect(screen.getByText("Identification")).toBeTruthy();
		expect(screen.queryByText("Identifiers")).toBeNull();
		expect(screen.queryByText("Address")).toBeNull();
		expect(screen.queryByText("Birth date")).toBeNull();
	});

	it("falls back to the raw code for an unknown language", () => {
		render(
			<PatientDetailPage
				patient={makePatient({ birthDate: "1990", preferredLanguage: "ja" })}
				consultations={[]}
			/>,
		);
		expect(dd("Preferred language")).toBe("ja");
		expect(dd("Birth date")).toMatch(/^1990 \(~\d+ years\)$/);
	});

	it("lists the patient's consultations", () => {
		render(
			<PatientDetailPage
				patient={FULL}
				consultations={[
					consult({}),
					consult({ id: 11, status: "live", hasAnamnesis: false, chiefComplaint: null }),
					consult({ id: 12, chiefComplaint: "A preencher pelo médico" }),
				]}
			/>,
		);
		expect(screen.getByText("(3)")).toBeTruthy();
		expect(screen.getByText("Cefaleia há 3 dias")).toBeTruthy();
		expect(screen.getByText("#11 · live · no anamnesis")).toBeTruthy();
		expect(screen.getAllByText("No chief complaint recorded.")).toHaveLength(2);
		const links = screen
			.getAllByRole("link")
			.map((a) => a.getAttribute("href"))
			.filter((h) => h?.startsWith("/consultations/1"));
		expect(links).toEqual(["/consultations/10", "/consultations/11", "/consultations/12"]);
	});
});
