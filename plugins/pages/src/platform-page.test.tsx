// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate: async () => {} }),
	Link: ({ to, children, ...props }: Record<string, unknown>) => (
		<a href={String(to)} {...props}>
			{children as React.ReactNode}
		</a>
	),
}));

vi.mock("./fns.ts", () => ({
	createPageFn: vi.fn<(arg?: { data?: unknown }) => Promise<unknown>>(),
	updatePageFn: vi.fn<(arg?: { data?: unknown }) => Promise<unknown>>(),
	deletePageFn: vi.fn<(arg?: { data?: unknown }) => Promise<unknown>>(),
	navPagesFn: vi.fn<() => Promise<unknown>>(),
}));

import type { PanelPageContext } from "@ktb/kernel";

import { PagesAdminConsolePage } from "./platform-page.tsx";

const ctx: PanelPageContext = { plugins: [], locale: "en" };

const row = (over: Record<string, unknown> = {}) => ({
	id: 1,
	path: "/about",
	title: "About",
	content: "body",
	published: true,
	showInNav: false,
	sortOrder: 0,
	createdAt: new Date(),
	updatedAt: new Date(),
	...over,
});

afterEach(cleanup);

describe("PagesAdminConsolePage", () => {
	it("renders the empty console when loader data is missing", () => {
		render(<PagesAdminConsolePage data={undefined} ctx={ctx} />);
		expect(screen.getByText("Pages")).toBeTruthy();
		expect(screen.getByText("No custom pages yet")).toBeTruthy();
	});

	it("narrows loader rows into the admin view", () => {
		render(<PagesAdminConsolePage data={[row({})]} ctx={ctx} />);
		expect(screen.getByText("/about")).toBeTruthy();
		expect(screen.getByText("About")).toBeTruthy();
		expect(screen.getByText("Published")).toBeTruthy();
	});

	it("drops malformed rows and survives non-array data", () => {
		render(<PagesAdminConsolePage data={[row({}), { nope: true }, "x", null]} ctx={ctx} />);
		expect(screen.getAllByText("/about")).toHaveLength(1);
		cleanup();
		render(<PagesAdminConsolePage data="garbage" ctx={ctx} />);
		expect(screen.getByText("No custom pages yet")).toBeTruthy();
	});
});
