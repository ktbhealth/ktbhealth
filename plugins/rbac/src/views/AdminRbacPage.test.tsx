// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate: async () => {} }),
}));
vi.mock("../fns.ts", () => ({
	assignSubjectFn: async () => ({ ok: true, data: null }),
	createRoleFn: async () => ({ ok: true, data: null }),
	deleteRoleFn: async () => ({ ok: true, data: null }),
	revokeRolePermissionFn: async () => ({ ok: true, data: null }),
	setRolePermissionFn: async () => ({ ok: true, data: null }),
	unassignSubjectFn: async () => ({ ok: true, data: null }),
}));

import type { AdminRbacPageData } from "../index.ts";

import { AdminRbacPage } from "./AdminRbacPage.tsx";

const empty: AdminRbacPageData = { roles: [], details: [], assignments: [], catalog: [] };

afterEach(cleanup);

describe("AdminRbacPage", () => {
	it("renders the empty state", () => {
		render(<AdminRbacPage data={empty} />);
		expect(screen.getByText("Roles & permissions")).toBeTruthy();
		expect(screen.getByText("No roles yet.")).toBeTruthy();
	});

	it("renders roles, matrix grants and assignments", () => {
		render(
			<AdminRbacPage
				data={{
					roles: [
						{
							id: 1,
							name: "auditor",
							description: "Read-only",
							meta: null,
							createdAt: new Date("2026-11-01T10:00:00Z"),
						},
					],
					details: [
						{
							role: {
								id: 1,
								name: "auditor",
								description: "Read-only",
								meta: null,
								createdAt: new Date("2026-11-01T10:00:00Z"),
							},
							permissions: [
								{ id: 1, roleId: 1, resource: "patient", action: "read", effect: "allow" },
								{ id: 2, roleId: 1, resource: "patient", action: "delete", effect: "deny" },
							],
						},
					],
					assignments: [
						{
							id: 5,
							subjectKind: "user",
							subjectId: "u1",
							roleId: 1,
							roleName: "auditor",
							tenantId: "clinic-1",
							grantedBy: "admin@x.com",
							expiresAt: null,
							createdAt: new Date("2026-11-01T10:00:00Z"),
						},
					],
					catalog: [
						{ key: "patient.read", resource: "patient", action: "read" },
						{ key: "patient.delete", resource: "patient", action: "delete" },
					],
				}}
			/>,
		);
		expect(screen.getAllByText("auditor").length).toBeGreaterThan(0);
		expect(screen.getByText("patient.read")).toBeTruthy();
		expect(screen.getByText("patient.delete")).toBeTruthy();
		expect(screen.getByText("allow")).toBeTruthy();
		expect(screen.getByText("deny")).toBeTruthy();
		expect(screen.getByText("u1")).toBeTruthy();
		expect(screen.getByText("clinic-1")).toBeTruthy();
		expect(screen.getByText("never")).toBeTruthy();
	});
});
