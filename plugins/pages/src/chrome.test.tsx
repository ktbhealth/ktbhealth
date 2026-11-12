// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
	const React = await import("react");
	return {
		Link: ({ to, children, ...props }: Record<string, unknown>) =>
			React.createElement("a", { href: String(to), ...props }, children as ReactNode),
	};
});

const navPagesFn = vi.fn<() => Promise<unknown>>();
vi.mock("./fns.ts", () => ({
	navPagesFn: () => navPagesFn(),
}));

import type { ChromeProps } from "@ktb/kernel";

import { CustomNavLinks } from "./chrome.tsx";

const props = (): ChromeProps => ({
	user: null,
	locale: "en",
	plugins: [],
	locales: ["en"],
	localeName: (l) => l,
	setLocale: vi.fn<(locale: string) => void>(),
	labels: {},
	signOut: vi.fn<() => Promise<void>>(async () => {}),
});

afterEach(() => {
	cleanup();
	navPagesFn.mockReset();
});

describe("CustomNavLinks", () => {
	it("renders a link per nav page", async () => {
		navPagesFn.mockResolvedValue([
			{ path: "/about", title: "About", sortOrder: 0 },
			{ path: "/team", title: "Team", sortOrder: 1 },
		]);
		const { container } = render(<CustomNavLinks {...props()} />);
		await waitFor(() => expect(screen.getByText("About")).toBeTruthy());
		const links = [...container.querySelectorAll("a")];
		expect(links.map((a) => a.getAttribute("href"))).toEqual(["/about", "/team"]);
		expect(screen.getByText("Team")).toBeTruthy();
	});

	it("renders nothing when the list is empty", async () => {
		navPagesFn.mockResolvedValue([]);
		const { container } = render(<CustomNavLinks {...props()} />);
		await waitFor(() => expect(navPagesFn).toHaveBeenCalled());
		expect(container.querySelector("a")).toBeNull();
	});

	it("renders nothing when the fetch fails", async () => {
		navPagesFn.mockRejectedValue(new Error("down"));
		const { container } = render(<CustomNavLinks {...props()} />);
		await waitFor(() => expect(navPagesFn).toHaveBeenCalled());
		await waitFor(() => expect(container.querySelector("a")).toBeNull());
	});

	it("ignores a late resolution after unmount", async () => {
		let resolve!: (rows: unknown) => void;
		navPagesFn.mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		const { unmount } = render(<CustomNavLinks {...props()} />);
		unmount();
		await act(async () => {
			resolve([{ path: "/late", title: "Late", sortOrder: 0 }]);
		});
		// The cancelled flag kept setPages from firing on the unmounted
		// component — nothing to assert beyond not crashing.
		expect(navPagesFn).toHaveBeenCalled();
	});

	it("ignores a late rejection after unmount", async () => {
		let reject!: (error: unknown) => void;
		navPagesFn.mockReturnValue(
			new Promise((_, r) => {
				reject = r;
			}),
		);
		const { unmount } = render(<CustomNavLinks {...props()} />);
		unmount();
		await act(async () => {
			reject(new Error("late"));
		});
		expect(navPagesFn).toHaveBeenCalled();
	});
});
