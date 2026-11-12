// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, params, children, ...rest }: Record<string, unknown>) =>
			React.createElement(
				"a",
				{
					href: String(to).replace("$id", String((params as { id?: string } | undefined)?.id)),
					...rest,
				},
				children as never,
			),
	};
});

import {
	PortalPage,
	type PortalApi,
	type PortalConsultationItem,
	type PortalProfileItem,
	type PortalRecord,
} from "./index.ts";

const me: PortalProfileItem = { patientId: 1, name: "Ana", relation: "self" };
const kid: PortalProfileItem = { patientId: 2, name: "Leo", relation: "guardian" };
const record: PortalRecord = { patientId: 1, name: "Ana", doctorName: "Dra. Bia" };
const consultations: PortalConsultationItem[] = [
	{ id: 11, createdAt: new Date("2026-11-06T14:30:00"), chiefComplaint: "Dor de cabeça" },
	{ id: 10, createdAt: new Date("2026-10-01T09:00:00"), chiefComplaint: null },
];

const setup = (
	props: Partial<Parameters<typeof PortalPage>[0]> = {},
	overrides: Partial<PortalApi> = {},
) => {
	const api: PortalApi = {
		select: vi.fn<PortalApi["select"]>(async () => ({ ok: true })),
		setCpf: vi.fn<PortalApi["setCpf"]>(async () => ({ ok: true })),
		...overrides,
	};
	const onChanged = vi.fn<() => void>();
	render(
		<PortalPage
			user={{ name: "Ana", email: "ana@ktb.test" }}
			hasCpf
			profiles={[me]}
			profile={record}
			consultations={consultations}
			locale="en"
			api={api}
			onChanged={onChanged}
			{...props}
		/>,
	);
	return { api, onChanged };
};

const click = (name: string, index = 0) =>
	act(async () => {
		fireEvent.click(screen.getAllByRole("button", { name })[index]!);
	});

afterEach(cleanup);

describe("PortalPage", () => {
	it("lists the open record's consultations, each linking to its page", () => {
		setup();
		expect(screen.getByText("Hello, Ana.")).toBeTruthy();
		expect(screen.getByText("Consultations · Doctor: Dra. Bia")).toBeTruthy();
		expect(screen.getByText("November 6, 2026")).toBeTruthy();
		expect(screen.getByText("Dor de cabeça")).toBeTruthy();
		// No chief complaint on record → a neutral label.
		expect(screen.getByText("Consultation")).toBeTruthy();
		const links = screen.getAllByRole("link", { name: "View consultation" });
		expect(links.map((a) => a.getAttribute("href"))).toEqual([
			"/portal/consultations/11",
			"/portal/consultations/10",
		]);
	});

	it("is read-only: nothing but viewing is offered on a linked record", () => {
		setup();
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(screen.queryByRole("textbox")).toBeNull();
		// Registration data is not part of the portal.
		expect(screen.queryByText("CPF")).toBeNull();
	});

	it("says so when the record has no consultations yet", () => {
		setup({ consultations: [], profile: { ...record, doctorName: null } });
		expect(screen.getByText("Consultations")).toBeTruthy();
		expect(screen.getByText("No consultations yet")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("greets by email when the account has no name", () => {
		setup({ user: { name: null, email: "ana@ktb.test" } });
		expect(screen.getByText("Hello, ana@ktb.test.")).toBeTruthy();
	});

	it("explains how records get linked when there is none", () => {
		setup({ profiles: [], profile: null, consultations: [] });
		expect(screen.getByText("No records linked yet")).toBeTruthy();
		expect(screen.queryByText("Profiles")).toBeNull();
	});

	it("switches between profiles and reloads", async () => {
		const { api, onChanged } = setup({ profiles: [me, kid] });
		expect(screen.getByText("Me")).toBeTruthy();
		expect(screen.getByText("In my care")).toBeTruthy();
		// The open profile is marked, the other one can be opened.
		expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(1);
		await click("Open");
		expect(api.select).toHaveBeenCalledWith(2);
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
	});

	it("asks for a choice when several profiles are linked and none is open", () => {
		setup({ profiles: [me, kid], profile: null, consultations: [] });
		expect(screen.getByText("Choose a profile to see its consultations.")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Open" })).toHaveLength(2);
	});

	it("reports a refused or failed profile switch", async () => {
		const select = vi
			.fn<PortalApi["select"]>()
			.mockResolvedValueOnce({ ok: false })
			.mockRejectedValueOnce(new Error("network"));
		const { onChanged } = setup({ profiles: [me, kid] }, { select });
		await click("Open");
		await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
		await click("Open");
		await waitFor(() => expect(select).toHaveBeenCalledTimes(2));
		expect(screen.getByText(/Something went wrong/)).toBeTruthy();
		expect(onChanged).not.toHaveBeenCalled();
	});

	describe("CPF prompt", () => {
		const type = (value: string) =>
			fireEvent.change(screen.getByLabelText("CPF"), { target: { value } });

		it("is hidden once the account has a CPF", () => {
			setup();
			expect(screen.queryByText("Tell us your CPF")).toBeNull();
		});

		it("saves the CPF and reloads", async () => {
			const { api, onChanged } = setup({ hasCpf: false });
			type("529.982.247-25");
			await click("Save CPF");
			expect(api.setCpf).toHaveBeenCalledWith("529.982.247-25");
			await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
		});

		it("ignores an empty submit", async () => {
			const { api } = setup({ hasCpf: false });
			type("   ");
			await act(async () => {
				fireEvent.submit(screen.getByLabelText("CPF").closest("form")!);
			});
			expect(api.setCpf).not.toHaveBeenCalled();
		});

		it("shows why a CPF was refused", async () => {
			const setCpf = vi
				.fn<PortalApi["setCpf"]>()
				.mockResolvedValueOnce({ ok: false, error: "cpf_taken" })
				.mockRejectedValueOnce(new Error("network"));
			const { onChanged } = setup({ hasCpf: false }, { setCpf });
			type("529.982.247-25");
			await click("Save CPF");
			await waitFor(() =>
				expect(screen.getByText("This CPF is already used by another account.")).toBeTruthy(),
			);
			await click("Save CPF");
			await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
			expect(onChanged).not.toHaveBeenCalled();
		});

		it("shows progress and ignores a second submit while saving", async () => {
			let release: (value: { ok: true }) => void = () => {};
			const setCpf = vi.fn<PortalApi["setCpf"]>(
				() => new Promise<{ ok: true }>((resolve) => (release = resolve)),
			);
			const { onChanged } = setup({ hasCpf: false }, { setCpf });
			type("529.982.247-25");
			await click("Save CPF");
			expect(screen.getByRole("button", { name: "Please wait…" })).toBeTruthy();
			await act(async () => {
				fireEvent.submit(screen.getByLabelText("CPF").closest("form")!);
			});
			expect(setCpf).toHaveBeenCalledTimes(1);
			await act(async () => release({ ok: true }));
			expect(onChanged).toHaveBeenCalledTimes(1);
		});
	});
});
