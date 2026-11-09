// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminUserRow } from "../index.ts";

import { AdminUsersPage } from "./AdminUsersPage.tsx";

const user = (over: Partial<AdminUserRow>): AdminUserRow => ({
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
				users={[user({}), user({ id: "u2", email: "a@x.com", isAdmin: true, patientCount: 0 })]}
			/>,
		);
		expect(screen.getByText("d@x.com")).toBeTruthy();
		expect(screen.getByText("a@x.com")).toBeTruthy();
		expect(screen.getByText("admin")).toBeTruthy();
		expect(screen.getAllByText("user").length).toBeGreaterThan(0);
		expect(screen.getByText("2 users across the platform.")).toBeTruthy();
	});
});
