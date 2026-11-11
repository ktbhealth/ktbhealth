// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate: async () => {} }),
}));

type FnMock = (arg: { data: unknown }) => Promise<{ ok: boolean }>;
const fns = vi.hoisted(() => ({
	assignSubjectFn: vi.fn<FnMock>(async () => ({ ok: true })),
	createRoleFn: vi.fn<FnMock>(async () => ({ ok: true })),
	deleteRoleFn: vi.fn<FnMock>(async () => ({ ok: true })),
	revokeRolePermissionFn: vi.fn<FnMock>(async () => ({ ok: true })),
	setRolePermissionFn: vi.fn<FnMock>(async () => ({ ok: true })),
	unassignSubjectFn: vi.fn<FnMock>(async () => ({ ok: true })),
}));
vi.mock("../fns.ts", () => fns);

import type { AdminRbacPageData } from "../index.ts";

import { AdminRbacPage } from "./index.ts";

const empty: AdminRbacPageData = { roles: [], details: [], assignments: [], catalog: [] };

const role = (
	id: number,
	name: string,
	description: string | null = null,
): AdminRbacPageData["roles"][number] => ({
	id,
	name,
	description,
	meta: null,
	createdAt: new Date("2026-11-01T10:00:00Z"),
});

const detail = (
	id: number,
	name: string,
	permissions: AdminRbacPageData["details"][number]["permissions"] = [],
): AdminRbacPageData["details"][number] => ({
	role: role(id, name),
	permissions,
});

const assignment = (
	over: Partial<AdminRbacPageData["assignments"][number]>,
): AdminRbacPageData["assignments"][number] => ({
	id: 5,
	subjectKind: "user",
	subjectId: "u1",
	roleId: 1,
	roleName: "auditor",
	tenantId: null,
	grantedBy: null,
	expiresAt: null,
	createdAt: new Date("2026-11-01T10:00:00Z"),
	...over,
});

const full: AdminRbacPageData = {
	roles: [role(1, "auditor", "Read-only"), role(2, "billing")],
	details: [
		detail(1, "auditor", [
			{ id: 1, roleId: 1, resource: "patient", action: "read", effect: "allow" },
			{ id: 2, roleId: 1, resource: "patient", action: "delete", effect: "deny" },
		]),
		detail(2, "billing"),
	],
	assignments: [
		assignment({ id: 5, expiresAt: new Date("2030-01-01T00:00:00Z") }),
		assignment({
			id: 6,
			subjectKind: "group",
			subjectId: "9",
			roleId: 2,
			roleName: "billing",
			tenantId: "clinic-1",
			grantedBy: "admin@x.com",
		}),
	],
	catalog: [
		{ key: "patient.read", resource: "patient", action: "read" },
		{ key: "patient.delete", resource: "patient", action: "delete" },
		{ key: "billing.manage", resource: "billing", action: "manage" },
	],
};

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

/** Picks an option from a design-system Select (trigger is aria-labelled). */
const choose = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
	await user.click(screen.getByLabelText(label));
	await user.click(await screen.findByRole("option", { name: option }));
};

describe("AdminRbacPage", () => {
	it("renders the empty state", () => {
		render(<AdminRbacPage data={empty} />);
		expect(screen.getByText("Roles & permissions")).toBeTruthy();
		expect(screen.getByText("No roles yet.")).toBeTruthy();
		expect(screen.getByText("Select a role to edit its grants.")).toBeTruthy();
	});

	it("renders roles, matrix grants and assignments", () => {
		render(<AdminRbacPage data={full} />);
		expect(screen.getAllByText("auditor").length).toBeGreaterThan(0);
		expect(screen.getByText("patient.read")).toBeTruthy();
		expect(screen.getByText("patient.delete")).toBeTruthy();
		expect(screen.getByText("billing.manage")).toBeTruthy();
		expect(screen.getByText("allow")).toBeTruthy();
		expect(screen.getByText("deny")).toBeTruthy();
		// billing.manage has no grant on auditor → the none badge.
		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
		// Assignment rows: global tenant + null granter + date expiry on
		// the first; explicit tenant/granter + "never" on the second.
		expect(screen.getByText("u1")).toBeTruthy();
		expect(screen.getByText("global")).toBeTruthy();
		expect(screen.getByText("clinic-1")).toBeTruthy();
		expect(screen.getByText("admin@x.com")).toBeTruthy();
		expect(screen.getByText("never")).toBeTruthy();
		// The "group" subject-kind badge on the second assignment row.
		expect(screen.getAllByText("group").length).toBeGreaterThan(0);
	});

	it("shows the select-role hint when details are missing", () => {
		render(<AdminRbacPage data={{ ...full, details: [], assignments: [], catalog: [] }} />);
		expect(screen.getAllByText("Select a role…").length).toBeGreaterThan(0);
	});

	it("hides the matrix table when the catalog is empty", () => {
		render(<AdminRbacPage data={{ ...full, catalog: [] }} />);
		expect(screen.queryByText("Permission")).toBeNull();
	});

	it("creates a role and clears the inputs on success", async () => {
		const user = userEvent.setup();
		render(<AdminRbacPage data={full} />);
		await user.type(screen.getByPlaceholderText("Name"), "nurse");
		await user.type(screen.getByPlaceholderText("Description"), "Ward");
		await user.click(screen.getByRole("button", { name: /Create/ }));
		expect(fns.createRoleFn).toHaveBeenCalledWith({
			data: { name: "nurse", description: "Ward" },
		});
		await waitFor(() => {
			expect((screen.getByPlaceholderText("Name") as HTMLInputElement).value).toBe("");
			expect((screen.getByPlaceholderText("Description") as HTMLInputElement).value).toBe("");
		});
	});

	it("ignores an empty role name and keeps inputs on failure", async () => {
		const user = userEvent.setup();
		fns.createRoleFn.mockResolvedValueOnce({ ok: false });
		render(<AdminRbacPage data={full} />);
		const form = screen.getByRole("button", { name: /Create/ }).closest("form")!;
		fireEvent.submit(form);
		expect(fns.createRoleFn).not.toHaveBeenCalled();

		await user.type(screen.getByPlaceholderText("Name"), "nurse");
		await user.click(screen.getByRole("button", { name: /Create/ }));
		expect(fns.createRoleFn).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(screen.getByText("Save failed")).toBeTruthy());
		// ok:false → the inputs are not cleared.
		expect((screen.getByPlaceholderText("Name") as HTMLInputElement).value).toBe("nurse");
	});

	it("cycles permission effects none → allow → deny → revoke", async () => {
		const user = userEvent.setup();
		render(<AdminRbacPage data={full} />);
		// The effect button sits in the row's second cell.
		const cycleButton = (key: string) =>
			screen.getByText(key).closest("tr")!.querySelector("button")!;
		// billing.manage: no grant → allow.
		await user.click(cycleButton("billing.manage"));
		expect(fns.setRolePermissionFn).toHaveBeenLastCalledWith({
			data: { roleId: 1, resource: "billing", action: "manage", effect: "allow" },
		});
		// patient.read: allow → deny.
		await user.click(cycleButton("patient.read"));
		expect(fns.setRolePermissionFn).toHaveBeenLastCalledWith({
			data: { roleId: 1, resource: "patient", action: "read", effect: "deny" },
		});
		// patient.delete: deny → revoke.
		await user.click(cycleButton("patient.delete"));
		expect(fns.revokeRolePermissionFn).toHaveBeenCalledWith({
			data: { roleId: 1, resource: "patient", action: "delete" },
		});
	});

	it("selects another role and deletes a role", async () => {
		const user = userEvent.setup();
		render(<AdminRbacPage data={full} />);
		// Row click switches the selected role (billing has no grants).
		await user.click(screen.getAllByText("billing")[0]!.closest("tr")!);
		expect(screen.getAllByText("—").length).toBeGreaterThan(2);
		// Delete on the auditor row — stopPropagation keeps the selection.
		const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
		await user.click(deleteButtons[0]!);
		expect(fns.deleteRoleFn).toHaveBeenCalledWith({ data: { id: 1 } });
	});

	it("assigns a subject with and without optional fields", async () => {
		const user = userEvent.setup();
		render(<AdminRbacPage data={full} />);
		const assignForm = screen.getByRole("button", { name: "Assign" }).closest("form")!;

		// Empty subject/role → guard returns early.
		fireEvent.submit(assignForm);
		expect(fns.assignSubjectFn).not.toHaveBeenCalled();

		// Required fields only → tenant/expires collapse to null.
		await user.type(screen.getByPlaceholderText("Subject id"), "u2");
		await choose(user, "Role", "billing");
		fireEvent.submit(assignForm);
		expect(fns.assignSubjectFn).toHaveBeenLastCalledWith({
			data: {
				subjectKind: "user",
				subjectId: "u2",
				roleId: 2,
				tenantId: null,
				expiresAt: null,
			},
		});

		// Full form: group kind + tenant + expiry.
		await choose(user, "Kind", "group");
		await user.type(screen.getByPlaceholderText("Tenant id (optional)"), "t-9");
		fireEvent.change(screen.getByLabelText("Expires at (optional)"), {
			target: { value: "2030-06-01T10:00" },
		});
		fireEvent.submit(assignForm);
		expect(fns.assignSubjectFn).toHaveBeenLastCalledWith({
			data: {
				subjectKind: "group",
				subjectId: "u2",
				roleId: 2,
				tenantId: "t-9",
				expiresAt: new Date("2030-06-01T10:00").toISOString(),
			},
		});
	});

	it("unassigns a subject", async () => {
		const user = userEvent.setup();
		render(<AdminRbacPage data={full} />);
		const removeButtons = screen.getAllByRole("button", { name: "Remove" });
		await user.click(removeButtons[0]!);
		expect(fns.unassignSubjectFn).toHaveBeenCalledWith({ data: { id: 5 } });
	});

	it("surfaces save errors from failed mutations", async () => {
		const user = userEvent.setup();
		fns.setRolePermissionFn.mockResolvedValueOnce({ ok: false });
		render(<AdminRbacPage data={full} />);
		await user.click(screen.getByText("billing.manage").closest("tr")!.querySelector("button")!);
		await waitFor(() => expect(screen.getByText("Save failed")).toBeTruthy());
	});
});
