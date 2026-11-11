// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate: async () => {} }),
}));
vi.mock("./fns.ts", () => ({
	addTenantMemberFn: async () => ({ ok: true, data: null }),
	listTenantMembersFn: async () => ({ ok: true, data: [] }),
	listTenantsFn: async () => ({ ok: true, data: [] }),
	removeTenantMemberFn: async () => ({ ok: true, data: null }),
	setTenantMemberRoleFn: async () => ({ ok: true, data: null }),
}));

import type { PanelPageContext } from "@ktb/kernel";

import type { TenantRow } from "./index.ts";
import { TenantsPlatformPage } from "./platform-page.tsx";

const ctx: PanelPageContext = { plugins: [], locale: "en" };

const rows: TenantRow[] = [
	{
		id: 1,
		name: "Clinic A",
		slug: "clinic-a",
		kind: "clinic",
		meta: null,
		createdAt: new Date("2026-11-01T10:00:00Z"),
		updatedAt: new Date("2026-11-01T10:00:00Z"),
		memberCount: 2,
	},
];

afterEach(cleanup);

describe("TenantsPlatformPage", () => {
	it("renders the empty console when the loader data is missing", () => {
		render(<TenantsPlatformPage data={undefined} ctx={ctx} />);
		expect(screen.getByText("Tenants")).toBeTruthy();
		expect(screen.getByText("No tenants")).toBeTruthy();
	});

	it("narrows loader data into the admin view", () => {
		render(<TenantsPlatformPage data={rows} ctx={ctx} />);
		expect(screen.getByText("Clinic A")).toBeTruthy();
		expect(screen.getByText("clinic-a")).toBeTruthy();
		expect(screen.getByText("1 tenant across the platform.")).toBeTruthy();
	});
});
