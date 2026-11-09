// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminGroupRow } from "../index.ts";

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

afterEach(cleanup);

describe("AdminGroupsPage", () => {
	it("renders the empty state", () => {
		render(<AdminGroupsPage groups={[]} />);
		expect(screen.getByText("Groups")).toBeTruthy();
		expect(screen.getByText("No groups")).toBeTruthy();
	});

	it("renders group rows with member counts", () => {
		render(
			<AdminGroupsPage
				groups={[
					group({}),
					group({ id: 2, name: "Org B", slug: "org-b", kind: "org", memberCount: 0 }),
				]}
			/>,
		);
		expect(screen.getByText("clinic-a")).toBeTruthy();
		expect(screen.getByText("org-b")).toBeTruthy();
		expect(screen.getByText("org")).toBeTruthy();
		expect(screen.getByText("2 groups across the platform.")).toBeTruthy();
	});
});
