// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminUserRow } from "../index.ts";

import { AdminUsersPage } from "./AdminUsersPage.tsx";

const row = (over: Partial<AdminUserRow>): AdminUserRow => ({
	id: "u1",
	name: "Dra",
	email: "d@x.com",
	emailVerified: true,
	image: null,
	createdAt: new Date("2026-11-01T10:00:00Z"),
	updatedAt: new Date("2026-11-01T10:00:00Z"),
	patientCount: 3,
	consultationCount: 7,
	isAdmin: false,
	...over,
});

afterEach(cleanup);

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
});
