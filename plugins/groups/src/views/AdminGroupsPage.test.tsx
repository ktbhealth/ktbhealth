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
	addGroupMemberFn: vi.fn<FnMock>(async () => ({ ok: true })),
	createGroupFn: vi.fn<FnMock>(async () => ({ ok: true })),
	deleteGroupFn: vi.fn<FnMock>(async () => ({ ok: true })),
	listGroupMembersFn: vi.fn<FnMock>(async () => ({ ok: true, data: [] })),
	removeGroupMemberFn: vi.fn<FnMock>(async () => ({ ok: true })),
}));
vi.mock("../fns.ts", () => fns);

import type { AdminGroupRow, GroupMember } from "../index.ts";

import { AdminGroupsPage } from "./AdminGroupsPage.tsx";

const group = (over: Partial<AdminGroupRow>): AdminGroupRow => ({
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

const member = (over: Partial<GroupMember>): GroupMember => ({
	id: 1,
	groupId: 1,
	memberKind: "user",
	memberId: "u1",
	role: "admin",
	createdAt: new Date("2026-11-01T10:00:00Z"),
	...over,
});

const TWO_GROUPS = [
	group({}),
	group({ id: 2, name: "Org B", slug: "org-b", kind: "org", memberCount: 0 }),
];

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	// mockResolvedValue persists across clearAllMocks — re-pin the default.
	fns.listGroupMembersFn.mockResolvedValue({ ok: true, data: [] });
});

/** Picks an option from a design-system Select (trigger is labelled). */
const choose = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string) => {
	await user.click(screen.getByLabelText(label));
	await user.click(await screen.findByRole("option", { name: option }));
};

const openCreate = async (user: ReturnType<typeof userEvent.setup>) => {
	await user.click(screen.getByRole("button", { name: "New group" }));
	return screen.findByText("Create group");
};

describe("AdminGroupsPage", () => {
	it("renders the empty state", () => {
		render(<AdminGroupsPage groups={[]} />);
		expect(screen.getByText("Groups")).toBeTruthy();
		expect(screen.getByText("No groups")).toBeTruthy();
	});

	it("renders group rows with member counts", () => {
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		expect(screen.getByText("clinic-a")).toBeTruthy();
		expect(screen.getByText("org-b")).toBeTruthy();
		expect(screen.getByText("org")).toBeTruthy();
		expect(screen.getByText("2 groups across the platform.")).toBeTruthy();
	});

	it("filters rows case-insensitively by name or slug", async () => {
		const user = userEvent.setup();
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await user.type(screen.getByLabelText("Search groups"), "ORG-B");
		expect(screen.queryByText("clinic-a")).toBeNull();
		expect(screen.getByText("org-b")).toBeTruthy();
		expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
	});

	it("shows the no-match row when the filter empties the list", async () => {
		const user = userEvent.setup();
		render(<AdminGroupsPage groups={[group({})]} />);
		await user.type(screen.getByLabelText("Search groups"), "zzz");
		expect(screen.getByText("No groups match the search.")).toBeTruthy();
		expect(screen.getByText("Showing 0 of 1")).toBeTruthy();
	});

	it("creates a group, enforcing required fields and sending meta", async () => {
		const user = userEvent.setup();
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await openCreate(user);

		const submit = () => screen.getByRole("button", { name: "Create" });
		// Nothing filled → guard returns early.
		fireEvent.submit(submit().closest("form")!);
		expect(fns.createGroupFn).not.toHaveBeenCalled();
		// Name only → slug guard; name+slug → kind guard.
		await user.type(screen.getByPlaceholderText("Group name"), "Cohort");
		await user.click(submit());
		expect(fns.createGroupFn).not.toHaveBeenCalled();
		await user.type(screen.getByPlaceholderText("group-slug"), "cohort-1");
		await user.click(submit());
		expect(fns.createGroupFn).not.toHaveBeenCalled();

		await user.type(screen.getByPlaceholderText("clinic, org, cohort…"), "cohort");
		// user.type parses `{` as a key descriptor — set meta via change.
		fireEvent.change(screen.getByPlaceholderText("Optional JSON payload"), {
			target: { value: '{"k":1}' },
		});
		await user.click(submit());
		await waitFor(() =>
			expect(fns.createGroupFn).toHaveBeenCalledWith({
				data: { name: "Cohort", slug: "cohort-1", kind: "cohort", meta: '{"k":1}' },
			}),
		);
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
		// Success closes the dialog and resets the form.
		await waitFor(() => expect(screen.queryByText("Create group")).toBeNull());
	});

	it("sends null meta when the optional field is blank and keeps the dialog on failure", async () => {
		const user = userEvent.setup();
		fns.createGroupFn.mockResolvedValueOnce({ ok: false });
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await openCreate(user);
		await user.type(screen.getByPlaceholderText("Group name"), "Failing");
		await user.type(screen.getByPlaceholderText("group-slug"), "failing");
		await user.type(screen.getByPlaceholderText("clinic, org, cohort…"), "custom");
		await user.click(screen.getByRole("button", { name: "Create" }));
		expect(fns.createGroupFn).toHaveBeenCalledWith({
			data: { name: "Failing", slug: "failing", kind: "custom", meta: null },
		});
		expect(await screen.findByText("Save failed")).toBeTruthy();
		// ok:false → the dialog stays open; Cancel closes it.
		expect(screen.getByText("Create group")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByText("Create group")).toBeNull());
	});

	it("lists members, adds and removes them inside the members dialog", async () => {
		const user = userEvent.setup();
		fns.listGroupMembersFn.mockResolvedValue({
			ok: true,
			data: [
				member({ id: 1, memberKind: "user", memberId: "u1", role: "admin" }),
				member({ id: 2, memberKind: "patient", memberId: "p1", role: null }),
			],
		});
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		expect(await screen.findByText("u1")).toBeTruthy();
		expect(screen.getByText("p1")).toBeTruthy();
		expect(fns.listGroupMembersFn).toHaveBeenCalledWith({ data: { groupId: 1 } });

		const addForm = screen.getByRole("button", { name: "Add member" }).closest("form")!;
		// Empty member id → guard returns early.
		fireEvent.submit(addForm);
		expect(fns.addGroupMemberFn).not.toHaveBeenCalled();

		// Switch kind to group, add with a role.
		await choose(user, "Member kind", "group");
		await user.type(screen.getByPlaceholderText("Member id"), "g-9");
		await user.type(screen.getByPlaceholderText("Role (optional)"), "lead");
		await user.click(screen.getByRole("button", { name: "Add member" }));
		await waitFor(() =>
			expect(fns.addGroupMemberFn).toHaveBeenLastCalledWith({
				data: { groupId: 1, memberKind: "group", memberId: "g-9", role: "lead" },
			}),
		);
		// Blank role → null.
		await user.type(screen.getByPlaceholderText("Member id"), "u2");
		await user.click(screen.getByRole("button", { name: "Add member" }));
		await waitFor(() =>
			expect(fns.addGroupMemberFn).toHaveBeenLastCalledWith({
				data: { groupId: 1, memberKind: "group", memberId: "u2", role: null },
			}),
		);

		// Remove u1 through the confirm dialog, then cancel the next one.
		const u1Row = screen.getByText("u1").closest("tr")!;
		await user.click(within(u1Row).getByRole("button", { name: "Remove" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText("Remove u1 from this group?")).toBeTruthy();
		await user.click(within(dialog).getByRole("button", { name: "Remove" }));
		await waitFor(() =>
			expect(fns.removeGroupMemberFn).toHaveBeenCalledWith({
				data: { groupId: 1, memberKind: "user", memberId: "u1" },
			}),
		);

		await user.click(
			within(screen.getByText("u1").closest("tr")!).getByRole("button", { name: "Remove" }),
		);
		const again = await screen.findByRole("alertdialog");
		await user.click(within(again).getByRole("button", { name: "Cancel" }));
		expect(fns.removeGroupMemberFn).toHaveBeenCalledTimes(1);

		// Initial load + one refresh per mutation.
		expect(fns.listGroupMembersFn.mock.calls.length).toBeGreaterThanOrEqual(4);
	});

	it("shows the empty and error states of the members dialog", async () => {
		const user = userEvent.setup();
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		expect(await screen.findByText("No members yet.")).toBeTruthy();
		cleanup();

		fns.listGroupMembersFn.mockResolvedValueOnce({ ok: false });
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		expect(await screen.findByText("Save failed")).toBeTruthy();
		expect(screen.getByText("No members yet.")).toBeTruthy();
	});

	it("surfaces add-member failures inside the dialog", async () => {
		const user = userEvent.setup();
		fns.addGroupMemberFn.mockResolvedValueOnce({ ok: false });
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		await screen.findByText("No members yet.");
		await user.type(screen.getByPlaceholderText("Member id"), "u2");
		await user.click(screen.getByRole("button", { name: "Add member" }));
		expect(await screen.findByText("Save failed")).toBeTruthy();
	});

	it("closes the members dialog from its close button", async () => {
		const user = userEvent.setup();
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await user.click(screen.getAllByRole("button", { name: "Members" })[0]!);
		await screen.findByText("No members yet.");
		await user.click(screen.getByRole("button", { name: "Close" }));
		await waitFor(() => expect(screen.queryByText("Group members")).toBeNull());
	});

	it("deletes a group through the destructive confirm dialog", async () => {
		const user = userEvent.setup();
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await user.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText(/Delete “Clinic A”/)).toBeTruthy();
		await user.click(within(dialog).getByRole("button", { name: "Delete" }));
		await waitFor(() => expect(fns.deleteGroupFn).toHaveBeenCalledWith({ data: { id: 1 } }));
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("cancels deletion and surfaces delete failures", async () => {
		const user = userEvent.setup();
		render(<AdminGroupsPage groups={TWO_GROUPS} />);
		await user.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(fns.deleteGroupFn).not.toHaveBeenCalled();

		fns.deleteGroupFn.mockResolvedValueOnce({ ok: false });
		await user.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
		const again = await screen.findByRole("alertdialog");
		await user.click(within(again).getByRole("button", { name: "Delete" }));
		expect(await screen.findByText("Save failed")).toBeTruthy();
	});
});
