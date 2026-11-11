// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate: async () => {} }),
}));
vi.mock("./fns.ts", () => ({
	assignSubjectFn: async () => ({ ok: true, data: null }),
	createRoleFn: async () => ({ ok: true, data: null }),
	deleteRoleFn: async () => ({ ok: true, data: null }),
	revokeRolePermissionFn: async () => ({ ok: true, data: null }),
	setRolePermissionFn: async () => ({ ok: true, data: null }),
	unassignSubjectFn: async () => ({ ok: true, data: null }),
}));

import type { PanelPageContext } from "@ktb/kernel";

import type { AdminRbacPageData } from "./index.ts";
import { RbacPlatformPage } from "./platform-page.tsx";

const ctx: PanelPageContext = { plugins: [], locale: "en" };

const pageData: AdminRbacPageData = {
	roles: [
		{
			id: 1,
			name: "auditor",
			description: null,
			meta: null,
			createdAt: new Date("2026-11-01T10:00:00Z"),
		},
	],
	details: [
		{
			role: {
				id: 1,
				name: "auditor",
				description: null,
				meta: null,
				createdAt: new Date("2026-11-01T10:00:00Z"),
			},
			permissions: [],
		},
	],
	assignments: [],
	catalog: [],
};

afterEach(cleanup);

describe("RbacPlatformPage", () => {
	it("renders the empty console when the loader data is missing", () => {
		render(<RbacPlatformPage data={undefined} ctx={ctx} />);
		expect(screen.getByText("Roles & permissions")).toBeTruthy();
		expect(screen.getByText("No roles yet.")).toBeTruthy();
	});

	it("narrows loader data into the admin view", () => {
		render(<RbacPlatformPage data={pageData} ctx={ctx} />);
		expect(screen.getAllByText("auditor").length).toBeGreaterThan(0);
	});
});
