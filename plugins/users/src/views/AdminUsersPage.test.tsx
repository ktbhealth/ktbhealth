// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate }),
}));

type FnMock = (arg: { data: unknown }) => Promise<{ ok: boolean; data?: unknown }>;
const fns = vi.hoisted(() => ({
	setUserSuspendedFn: vi.fn<FnMock>(async () => ({ ok: true, data: null })),
}));
vi.mock("../fns.ts", () => fns);

import type { AdminUserRow } from "../index.ts";

import { AdminUsersPage } from "./AdminUsersPage.tsx";

const row = (over: Partial<AdminUserRow>): AdminUserRow => ({
	id: "u1",
	name: "Dra",
	email: "d@x.com",
	emailVerified: true,
	image: null,
	banned: false,
	createdAt: new Date("2026-11-01T10:00:00Z"),
	updatedAt: new Date("2026-11-01T10:00:00Z"),
	patientCount: 3,
	consultationCount: 7,
	isAdmin: false,
	...over,
});

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	fns.setUserSuspendedFn.mockResolvedValue({ ok: true, data: null });
});

describe("AdminUsersPage", () => {
	it("renders the empty state", () => {
		render(<AdminUsersPage users={[]} />);
		expect(screen.getByText("Users")).toBeTruthy();
		expect(screen.getByText("No users")).toBeTruthy();
	});

	it("renders user rows with counts and admin flag", () => {
		render(
			<AdminUsersPage
				users={[row({}), row({ id: "u2", email: "a@x.com", isAdmin: true, patientCount: 0 })]}
			/>,
		);
		expect(screen.getByText("d@x.com")).toBeTruthy();
		expect(screen.getByText("a@x.com")).toBeTruthy();
		expect(screen.getByText("admin")).toBeTruthy();
		expect(screen.getAllByText("user").length).toBeGreaterThan(0);
		expect(screen.getByText("2 users across the platform.")).toBeTruthy();
	});

	it("shows whether each email is verified", () => {
		render(
			<AdminUsersPage
				users={[
					row({ id: "u1", emailVerified: true }),
					row({ id: "u2", email: "n@x.com", emailVerified: false }),
				]}
			/>,
		);
		expect(screen.getByText("yes")).toBeTruthy();
		expect(screen.getByText("no")).toBeTruthy();
	});

	it("uses the singular for a single user", () => {
		render(<AdminUsersPage users={[row({})]} />);
		expect(screen.getByText("1 user across the platform.")).toBeTruthy();
	});

	it("filters rows case-insensitively by name or email", async () => {
		const user = userEvent.setup();
		render(
			<AdminUsersPage users={[row({}), row({ id: "u2", name: "Bia", email: "bia@x.com" })]} />,
		);
		await user.type(screen.getByLabelText("Search users"), "BIA");
		expect(screen.queryByText("d@x.com")).toBeNull();
		expect(screen.getByText("bia@x.com")).toBeTruthy();
		expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
	});

	it("shows the no-match row when the filter empties the list", async () => {
		const user = userEvent.setup();
		render(<AdminUsersPage users={[row({})]} />);
		await user.type(screen.getByLabelText("Search users"), "zzz");
		expect(screen.getByText("No users match the search.")).toBeTruthy();
		expect(screen.getByText("Showing 0 of 1")).toBeTruthy();
	});

	it("marks suspended users and offers reactivate instead of suspend", () => {
		render(<AdminUsersPage users={[row({ banned: true })]} />);
		expect(screen.getByText("suspended")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
	});

	it("suspends a user through the confirm dialog", async () => {
		const user = userEvent.setup();
		render(<AdminUsersPage users={[row({})]} />);
		await user.click(screen.getByRole("button", { name: "Suspend" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText("Suspend user")).toBeTruthy();
		expect(fns.setUserSuspendedFn).not.toHaveBeenCalled();
		await user.click(within(dialog).getByRole("button", { name: "Suspend" }));
		await waitFor(() =>
			expect(fns.setUserSuspendedFn).toHaveBeenCalledWith({
				data: { userId: "u1", suspended: true },
			}),
		);
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("cancelling the suspend dialog does not call the fn", async () => {
		const user = userEvent.setup();
		render(<AdminUsersPage users={[row({})]} />);
		await user.click(screen.getByRole("button", { name: "Suspend" }));
		const dialog = await screen.findByRole("alertdialog");
		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		expect(fns.setUserSuspendedFn).not.toHaveBeenCalled();
	});

	it("reactivates a suspended user directly", async () => {
		const user = userEvent.setup();
		render(<AdminUsersPage users={[row({ banned: true })]} />);
		await user.click(screen.getByRole("button", { name: "Reactivate" }));
		await waitFor(() =>
			expect(fns.setUserSuspendedFn).toHaveBeenCalledWith({
				data: { userId: "u1", suspended: false },
			}),
		);
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("shows the save error when the fn is denied", async () => {
		const user = userEvent.setup();
		fns.setUserSuspendedFn.mockResolvedValueOnce({ ok: false });
		render(<AdminUsersPage users={[row({ banned: true })]} />);
		await user.click(screen.getByRole("button", { name: "Reactivate" }));
		await waitFor(() =>
			expect(screen.getByText("Could not update the user. Try again.")).toBeTruthy(),
		);
	});

	it("localizes the suspend copy", async () => {
		const user = userEvent.setup();
		render(<AdminUsersPage users={[row({})]} locale="pt-BR" />);
		await user.click(screen.getByRole("button", { name: "Suspender" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText("Suspender usuário")).toBeTruthy();
		expect(within(dialog).getByText(/Suspender d@x\.com/)).toBeTruthy();
	});
});
