// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, ...props }: Record<string, unknown>) =>
			React.createElement("a", { ...props, href: String(to) }, props.children as never),
	};
});

// jsdom has no matchMedia; the ui sidebar's useIsMobile needs it.
window.matchMedia =
	window.matchMedia ??
	((query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList);

import type { PanelSidebarItem } from "@ktb/kernel";
import { UsersIcon } from "lucide-react";

import { PlatformConsoleShell } from "./PlatformConsoleShell.tsx";

const items: PanelSidebarItem[] = [
	{ to: "/platform", label: "Dashboard", exact: true },
	{ to: "/platform/users", label: "Users", icon: UsersIcon, group: "Access" },
	{ to: "/platform/groups", label: "Groups", group: "Access" },
];

const renderShell = (over: Partial<Parameters<typeof PlatformConsoleShell>[0]> = {}) =>
	render(
		<PlatformConsoleShell
			items={items}
			pathname="/platform/users"
			userEmail="admin@x.com"
			onSignOut={vi.fn()}
			{...over}
		>
			<div>page body</div>
		</PlatformConsoleShell>,
	);

afterEach(cleanup);

describe("PlatformConsoleShell", () => {
	it("renders grouped sidebar items and the matched breadcrumb leaf", () => {
		const { container } = renderShell();
		expect(screen.getByText("Dashboard")).toBeDefined();
		expect(screen.getByText("Access")).toBeDefined();
		expect(screen.getByText("Groups")).toBeDefined();
		expect(screen.getByText("page body")).toBeDefined();
		// "Users" appears twice: sidebar item + breadcrumb leaf label
		expect(screen.getAllByText("Users")).toHaveLength(2);
		expect(container.querySelector('a[href="/platform/users"]')).not.toBeNull();
	});

	it("uses 'overview' leaf on the console index", () => {
		renderShell({ pathname: "/platform" });
		expect(screen.getByText("overview")).toBeDefined();
	});

	it("falls back to the last path segment for unmatched routes", () => {
		renderShell({ pathname: "/platform/unknown-thing" });
		expect(screen.getByText("unknown-thing")).toBeDefined();
	});

	it("falls back to 'overview' when the path has no segments and matches nothing", () => {
		renderShell({ pathname: "/", items: [] });
		expect(screen.getByText("overview")).toBeDefined();
	});

	it("marks the active item and calls onSignOut", async () => {
		const onSignOut = vi.fn();
		const { container } = renderShell({ onSignOut });
		const usersLink = container.querySelector('a[href="/platform/users"]');
		expect(usersLink).not.toBeNull();
		expect(usersLink?.getAttribute("data-active")).not.toBeNull();
		await userEvent.click(screen.getByTitle("Sign out"));
		expect(onSignOut).toHaveBeenCalledOnce();
	});

	it("renders the user email and defaults to 'admin'", () => {
		const { unmount } = renderShell();
		expect(screen.getByText("admin@x.com")).toBeDefined();
		unmount();
		renderShell({ userEmail: undefined });
		expect(screen.getByText("admin")).toBeDefined();
	});
});
