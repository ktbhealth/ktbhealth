// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The view renders outside a router: Link degrades to a plain anchor
// with its params filled in.
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	const React = await import("react");
	return {
		...actual,
		Link: ({
			to,
			params,
			children,
			className,
		}: {
			to: string;
			params?: Record<string, string>;
			children?: unknown;
			className?: string;
		}) =>
			React.createElement(
				"a",
				{
					href: Object.entries(params ?? {}).reduce(
						(path, [key, value]) => path.replace(`$${key}`, value),
						to,
					),
					className,
				},
				children as never,
			),
	};
});

import { PatientAccessPage, type PatientAccessApi, type PatientLinkItem } from "./index.ts";

const patient = { id: 7, name: "Ana Souza" };
const active: PatientLinkItem = {
	id: 1,
	email: "ana@ktb.test",
	relation: "self",
	status: "active",
	source: "invite",
};
const pendingMatch: PatientLinkItem = {
	id: 2,
	email: "mae@ktb.test",
	relation: "guardian",
	status: "pending",
	source: "cpf",
};
const invited: PatientLinkItem = {
	id: 3,
	email: "pai@ktb.test",
	relation: "guardian",
	status: "invited",
	source: "invite",
};

const setup = (
	links: PatientLinkItem[],
	overrides: Partial<PatientAccessApi> = {},
	locale = "en",
) => {
	const api: PatientAccessApi = {
		invite: vi.fn<PatientAccessApi["invite"]>(async () => ({ ok: true })),
		approve: vi.fn<PatientAccessApi["approve"]>(async () => ({ ok: true })),
		revoke: vi.fn<PatientAccessApi["revoke"]>(async () => ({ ok: true })),
		...overrides,
	};
	const onChanged = vi.fn<() => void>();
	render(
		<PatientAccessPage
			patient={patient}
			links={links}
			locale={locale}
			api={api}
			onChanged={onChanged}
		/>,
	);
	return { api, onChanged };
};

const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const relation = () => screen.getByLabelText("Relation") as HTMLSelectElement;
const submitInvite = (value: string) =>
	act(async () => {
		fireEvent.change(email(), { target: { value } });
		fireEvent.submit(email().closest("form")!);
	});
const click = (name: string, index = 0) =>
	act(async () => {
		fireEvent.click(screen.getAllByRole("button", { name })[index]!);
	});
/** The list row of a link, found by its address. */
const row = (address: string) => screen.getByText(address).closest("li")!;

afterEach(cleanup);

describe("PatientAccessPage", () => {
	it("heads the page with the patient and links back to the record", () => {
		setup([]);
		expect(screen.getByRole("heading", { name: "Portal access — Ana Souza" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Back to the patient" }).getAttribute("href")).toBe(
			"/patients/7",
		);
	});

	it("shows the empty state without links", () => {
		setup([]);
		expect(screen.getByText("Nobody has portal access yet")).toBeTruthy();
		expect(screen.queryByRole("list")).toBeNull();
		expect(screen.queryByRole("button", { name: "Remove access" })).toBeNull();
	});

	it("lists each link with its relation, status and origin", () => {
		setup([active, pendingMatch, invited]);
		expect(screen.queryByText("Nobody has portal access yet")).toBeNull();
		expect(row("ana@ktb.test").textContent).toContain("Patient");
		expect(row("ana@ktb.test").textContent).toContain("Active");
		expect(row("ana@ktb.test").textContent).not.toContain("CPF match");
		expect(row("mae@ktb.test").textContent).toContain("Guardian · CPF match");
		expect(row("mae@ktb.test").textContent).toContain("Awaiting approval");
		expect(row("pai@ktb.test").textContent).toContain("Invited");
	});

	it("offers approval only for links awaiting it, and removal for all", () => {
		setup([active, pendingMatch, invited]);
		expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
		expect(row("mae@ktb.test").textContent).toContain("Approve");
		expect(screen.getAllByRole("button", { name: "Remove access" })).toHaveLength(3);
	});

	it("shows a relation or status it has no label for as is", () => {
		setup([{ ...active, relation: "sibling", status: "suspended" }]);
		expect(row("ana@ktb.test").textContent).toContain("sibling");
		expect(row("ana@ktb.test").textContent).toContain("suspended");
	});

	it("renders in the locale the host passes", () => {
		setup([pendingMatch], {}, "pt-BR");
		expect(screen.getByRole("heading", { name: "Acesso ao portal — Ana Souza" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Convidar" })).toBeTruthy();
		expect(row("mae@ktb.test").textContent).toContain("Responsável · Match por CPF");
	});

	it("invites the patient by email, clears the field and refreshes", async () => {
		const { api, onChanged } = setup([]);
		await submitInvite("new@ktb.test");
		expect(api.invite).toHaveBeenCalledWith({ email: "new@ktb.test", relation: "self" });
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
		expect(email().value).toBe("");
		expect(screen.getByRole("button", { name: "Invite" })).toHaveProperty("disabled", false);
	});

	it("invites a guardian when that relation is chosen", async () => {
		const { api } = setup([]);
		fireEvent.change(relation(), { target: { value: "guardian" } });
		await submitInvite("mae@ktb.test");
		expect(api.invite).toHaveBeenCalledWith({ email: "mae@ktb.test", relation: "guardian" });
	});

	it("ignores an empty address", async () => {
		const { api, onChanged } = setup([]);
		await submitInvite("   ");
		expect(api.invite).not.toHaveBeenCalled();
		expect(onChanged).not.toHaveBeenCalled();
	});

	it("shows the rejection reason and keeps the typed address", async () => {
		const { onChanged } = setup([], {
			invite: async () => ({ ok: false, error: "invalid_email" }),
		});
		await submitInvite("ana@ktb");
		await waitFor(() => expect(screen.getByText("Enter a valid email address.")).toBeTruthy());
		expect(email().value).toBe("ana@ktb");
		expect(onChanged).not.toHaveBeenCalled();
	});

	it("reports a generic failure when the invite call throws", async () => {
		const { onChanged } = setup([], { invite: async () => Promise.reject(new Error("network")) });
		await submitInvite("new@ktb.test");
		await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
		expect(email().value).toBe("new@ktb.test");
		expect(onChanged).not.toHaveBeenCalled();
	});

	it("clears a previous error once an invite goes through", async () => {
		const invite = vi
			.fn<PatientAccessApi["invite"]>()
			.mockResolvedValueOnce({ ok: false, error: "invalid_relation" })
			.mockResolvedValueOnce({ ok: true });
		const { onChanged } = setup([], { invite });
		await submitInvite("new@ktb.test");
		await waitFor(() =>
			expect(screen.getByText("Choose who this person is to the patient.")).toBeTruthy(),
		);
		await submitInvite("new@ktb.test");
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
		expect(screen.queryByText("Choose who this person is to the patient.")).toBeNull();
	});

	it("locks every action and ignores a second invite while one is in flight", async () => {
		let release: (value: { ok: true }) => void = () => {};
		const invite = vi.fn<PatientAccessApi["invite"]>(
			() => new Promise<{ ok: true }>((resolve) => (release = resolve)),
		);
		const { onChanged } = setup([pendingMatch], { invite });
		await submitInvite("new@ktb.test");
		expect(screen.getByRole("button", { name: "Please wait…" })).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "Remove access" })).toHaveProperty("disabled", true);
		await act(async () => {
			fireEvent.submit(email().closest("form")!);
		});
		expect(invite).toHaveBeenCalledTimes(1);
		await act(async () => release({ ok: true }));
		expect(onChanged).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", false);
	});

	it("approves a pending link and refreshes", async () => {
		const { api, onChanged } = setup([active, pendingMatch]);
		await click("Approve");
		expect(api.approve).toHaveBeenCalledWith(2);
		expect(api.revoke).not.toHaveBeenCalled();
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
	});

	it("removes access and refreshes", async () => {
		const { api, onChanged } = setup([active, pendingMatch, invited]);
		await click("Remove access", 2);
		expect(api.revoke).toHaveBeenCalledWith(3);
		expect(api.approve).not.toHaveBeenCalled();
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
	});

	it("reports a refused or failed approval", async () => {
		const approve = vi
			.fn<PatientAccessApi["approve"]>()
			.mockResolvedValueOnce({ ok: false })
			.mockRejectedValueOnce(new Error("network"));
		const { onChanged } = setup([pendingMatch], { approve });
		await click("Approve");
		await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
		await click("Approve");
		await waitFor(() => expect(approve).toHaveBeenCalledTimes(2));
		expect(screen.getByText(/Something went wrong/)).toBeTruthy();
		expect(onChanged).not.toHaveBeenCalled();
	});

	it("reports a refused or failed removal", async () => {
		const revoke = vi
			.fn<PatientAccessApi["revoke"]>()
			.mockResolvedValueOnce({ ok: false })
			.mockRejectedValueOnce(new Error("network"));
		const { onChanged } = setup([active], { revoke });
		await click("Remove access");
		await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
		await click("Remove access");
		await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
		expect(screen.getByText(/Something went wrong/)).toBeTruthy();
		expect(onChanged).not.toHaveBeenCalled();
	});
});
