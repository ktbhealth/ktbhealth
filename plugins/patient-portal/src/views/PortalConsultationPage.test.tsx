// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, children, ...rest }: Record<string, unknown>) =>
			React.createElement("a", { href: String(to), ...rest }, children as never),
	};
});

import { PortalConsultationPage, type PortalConsultationView } from "./index.ts";

const consultation: PortalConsultationView = {
	id: 10,
	createdAt: new Date("2026-11-06T14:30:00"),
	patientName: "Ana",
	doctorName: "Dra. Bia",
	sections: [
		{ key: "queixa_principal", content: "Dor de cabeça há três dias" },
		{ key: "conduta", content: "Retorno em 15 dias" },
	],
};

afterEach(cleanup);

describe("PortalConsultationPage", () => {
	it("shows the saved record: who, when and what the doctor wrote", () => {
		render(<PortalConsultationPage consultation={consultation} locale="en" />);
		expect(screen.getByRole("heading", { level: 1, name: "Consultation" })).toBeTruthy();
		expect(screen.getByText(/November 6, 2026/)).toBeTruthy();
		expect(screen.getByText("Ana")).toBeTruthy();
		expect(screen.getByText("Dra. Bia")).toBeTruthy();
		expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
			"Chief complaint",
			"Management plan",
		]);
		expect(screen.getByText("Dor de cabeça há três dias")).toBeTruthy();
		expect(screen.getByText("Retorno em 15 dias")).toBeTruthy();
	});

	it("is read-only: the only way out is back to the list", () => {
		render(<PortalConsultationPage consultation={consultation} locale="en" />);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(screen.queryByRole("textbox")).toBeNull();
		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(1);
		expect(links[0]!.getAttribute("href")).toBe("/portal");
		expect(screen.getByText(/Only your doctor can change it/)).toBeTruthy();
	});

	it("localizes the section labels", () => {
		render(<PortalConsultationPage consultation={consultation} locale="pt-BR" />);
		expect(screen.getByText("Queixa principal")).toBeTruthy();
		expect(screen.getByText("Conduta")).toBeTruthy();
		expect(screen.getByText("Voltar às minhas consultas")).toBeTruthy();
	});

	it("omits the doctor line when unknown and says when nothing was written", () => {
		render(
			<PortalConsultationPage
				consultation={{ ...consultation, doctorName: null, sections: [] }}
				locale="en"
			/>,
		);
		expect(screen.queryByText("Doctor")).toBeNull();
		expect(
			screen.getByText("Your doctor has not written anything in this record yet."),
		).toBeTruthy();
		expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
	});
});
