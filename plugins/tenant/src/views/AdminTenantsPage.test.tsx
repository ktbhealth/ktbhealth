// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate }),
}));

type FnMock = (arg: { data: unknown }) => Promise<{ ok: boolean; data?: unknown }>;
const fns = vi.hoisted(() => ({
	addTenantMemberFn: vi.fn<FnMock>(async () => ({ ok: true })),
	listTenantMembersFn: vi.fn<FnMock>(async () => ({ ok: true, data: [] })),
	removeTenantMemberFn: vi.fn<FnMock>(async () => ({ ok: true })),
	setTenantMemberRoleFn: vi.fn<FnMock>(async () => ({ ok: true })),
}));
vi.mock("../fns.ts", () => fns);

import type { TenantMember, TenantRow } from "../index.ts";

import { AdminTenantsPage } from "./AdminTenantsPage.tsx";

const tenant = (over: Partial<TenantRow>): TenantRow => ({
	id: 1,
	name: "Clinic A",
	slug: "clinic-a",
	kind: "clinic",
	meta: null,
	createdAt: new Date("2026-11-01T10:00:00Z"),
	updatedAt: new Date("2026-11-01T10:00:00Z"),
	memberCount: 3,
	...over,
});

const member = (over: Partial<TenantMember>): TenantMember => ({
	id: 1,
	groupId: 1,
	memberKind: "user",
	memberId: "u1",
	role: "admin",
	createdAt: new Date("2026-11-01T10:00:00Z"),
	...over,
});

const TWO_TENANTS = [
	tenant({}),
	tenant({ id: 2, name: "Org B", slug: "org-b", kind: "org", memberCount: 0 }),
];

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	// mockResolvedValue persists across clearAllMocks — re-pin the default.
	fns.listTenantMembersFn.mockResolvedValue({ ok: true, data: [] });
});

/** Picks an option from a design-system Select (trigger is labelled). */
const choose = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
	await user.click(screen.getByLabelText(label));
	await user.click(await screen.findByRole("option", { name: option }));
};

describe("AdminTenantsPage", () => {
	it("renders the empty state", () => {
		render(<AdminTenantsPage tenants={[]} />);
		expect(screen.getByText("Tenants")).toBeTruthy();
		expect(screen.getByText("No tenants")).toBeTruthy();
	});

	it("renders tenant rows with member counts", () => {
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		expect(screen.getByText("clinic-a")).toBeTruthy();
		expect(screen.getByText("org-b")).toBeTruthy();
		expect(screen.getByText("org")).toBeTruthy();
		expect(screen.getByText("2 tenants across the platform.")).toBeTruthy();
	});

	it("filters rows case-insensitively by name or slug", async () => {
		const user = userEvent.setup();
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		await user.type(screen.getByLabelText("Search tenants"), "ORG-B");
		expect(screen.queryByText("clinic-a")).toBeNull();
		expect(screen.getByText("org-b")).toBeTruthy();
		expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
	});

	it("shows the no-match row when the filter empties the list", async () => {
		const user = userEvent.setup();
		render(<AdminTenantsPage tenants={[tenant({})]} />);
		await user.type(screen.getByLabelText("Search tenants"), "zzz");
		expect(screen.getByText("No tenants match the search.")).toBeTruthy();
		expect(screen.getByText("Showing 0 of 1")).toBeTruthy();
	});

	it("lists members inside the dialog and adds a user with a role", async () => {
		const user = userEvent.setup();
		fns.listTenantMembersFn.mockResolvedValue({
			ok: true,
			data: [
				member({ id: 1, memberId: "u1", role: "admin" }),
				member({ id: 2, memberId: "u2", role: null }),
				// Free-form role outside the built-in set stays visible.
				member({ id: 3, memberId: "u3", role: "lead" }),
			],
		});
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		expect(await screen.findByText("u1")).toBeTruthy();
		expect(screen.getByText("u3")).toBeTruthy();
		expect(fns.listTenantMembersFn).toHaveBeenCalledWith({ data: { tenantId: 1 } });

		const addForm = screen.getByRole("button", { name: "Add member" }).closest("form")!;
		// Empty member id → guard returns early.
		fireEvent.submit(addForm);
		expect(fns.addTenantMemberFn).not.toHaveBeenCalled();

		await choose(user, "Role", "admin");
		await user.type(screen.getByPlaceholderText("User id"), "u9");
		await user.click(screen.getByRole("button", { name: "Add member" }));
		await waitFor(() =>
			expect(fns.addTenantMemberFn).toHaveBeenCalledWith({
				data: { tenantId: 1, memberId: "u9", role: "admin" },
			}),
		);
	});

	it("changes a member role through the row select", async () => {
		const user = userEvent.setup();
		fns.listTenantMembersFn.mockResolvedValue({
			ok: true,
			data: [
				member({ id: 1, memberId: "u2", role: null }),
				// Free-form stored role: rendered as an extra option but
				// never writable — re-picking it is a no-op.
				member({ id: 2, memberId: "u3", role: "lead" }),
			],
		});
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		await screen.findByText("u2");

		// null role displays as "member"; picking the same value is a no-op.
		await choose(user, "Role u2", "member");
		expect(fns.setTenantMemberRoleFn).not.toHaveBeenCalled();

		await choose(user, "Role u2", "owner");
		await waitFor(() =>
			expect(fns.setTenantMemberRoleFn).toHaveBeenCalledWith({
				data: { tenantId: 1, memberId: "u2", role: "owner" },
			}),
		);

		// The stored "lead" role is display-only: re-selecting it never
		// reaches the server fn.
		await choose(user, "Role u3", "lead");
		expect(fns.setTenantMemberRoleFn).toHaveBeenCalledTimes(1);
	});

	it("removes a member through the destructive confirm dialog", async () => {
		const user = userEvent.setup();
		fns.listTenantMembersFn.mockResolvedValue({
			ok: true,
			data: [member({ id: 1, memberId: "u1", role: "admin" })],
		});
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		await screen.findByText("u1");

		const u1Row = screen.getByText("u1").closest("tr")!;
		await user.click(within(u1Row).getByRole("button", { name: "Remove" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText("Remove u1 from this tenant?")).toBeTruthy();
		await user.click(within(dialog).getByRole("button", { name: "Remove" }));
		await waitFor(() =>
			expect(fns.removeTenantMemberFn).toHaveBeenCalledWith({
				data: { tenantId: 1, memberId: "u1" },
			}),
		);

		// Cancel path: open again and dismiss.
		await user.click(
			within(screen.getByText("u1").closest("tr")!).getByRole("button", { name: "Remove" }),
		);
		const again = await screen.findByRole("alertdialog");
		await user.click(within(again).getByRole("button", { name: "Cancel" }));
		expect(fns.removeTenantMemberFn).toHaveBeenCalledTimes(1);
	});

	it("shows the empty and error states of the members dialog", async () => {
		const user = userEvent.setup();
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		expect(await screen.findByText("No members yet.")).toBeTruthy();
		cleanup();

		fns.listTenantMembersFn.mockResolvedValueOnce({ ok: false });
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		expect(await screen.findByText("Save failed")).toBeTruthy();
		expect(screen.getByText("No members yet.")).toBeTruthy();
	});

	it("surfaces mutation failures inside the dialog", async () => {
		const user = userEvent.setup();
		fns.addTenantMemberFn.mockResolvedValueOnce({ ok: false });
		fns.setTenantMemberRoleFn.mockResolvedValueOnce({ ok: false });
		fns.listTenantMembersFn.mockResolvedValue({
			ok: true,
			data: [member({ id: 1, memberId: "u1", role: "admin" })],
		});
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		await screen.findByText("u1");

		await user.type(screen.getByPlaceholderText("User id"), "u2");
		await user.click(screen.getByRole("button", { name: "Add member" }));
		expect(await screen.findByText("Save failed")).toBeTruthy();

		await choose(user, "Role u1", "member");
		expect(fns.setTenantMemberRoleFn).toHaveBeenCalled();
	});

	it("closes the members dialog from its close button", async () => {
		const user = userEvent.setup();
		render(<AdminTenantsPage tenants={TWO_TENANTS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		await screen.findByText("No members yet.");
		await user.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() => expect(screen.queryByText("Tenant members")).toBeNull());
	});
});
