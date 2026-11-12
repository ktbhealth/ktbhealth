// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => {}));
const fns = vi.hoisted(() => ({
	createPageFn: vi.fn<(arg?: { data?: unknown }) => Promise<unknown>>(),
	updatePageFn: vi.fn<(arg?: { data?: unknown }) => Promise<unknown>>(),
	deletePageFn: vi.fn<(arg?: { data?: unknown }) => Promise<unknown>>(),
	navPagesFn: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate }),
	Link: ({ to, children, ...props }: Record<string, unknown>) => (
		<a href={String(to)} {...props}>
			{children as React.ReactNode}
		</a>
	),
}));
vi.mock("../fns.ts", () => fns);

import { PagesAdminPage, type AdminPageRow } from "./PagesAdminPage.tsx";

const row = (over: Partial<AdminPageRow> = {}): AdminPageRow => ({
	id: 1,
	path: "/about",
	title: "About",
	content: "body",
	published: true,
	showInNav: true,
	sortOrder: 2,
	...over,
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("PagesAdminPage", () => {
	it("renders rows with status, nav and order badges", () => {
		render(
			<PagesAdminPage
				pages={[
					row({}),
					row({ id: 2, path: "/draft", title: "Secret", published: false, showInNav: false }),
				]}
				locale="en"
			/>,
		);
		expect(screen.getByText("/about")).toBeTruthy();
		expect(screen.getByText("/draft")).toBeTruthy();
		expect(screen.getByText("Published")).toBeTruthy();
		expect(screen.getByText("Draft")).toBeTruthy();
		expect(screen.getByText("Shown")).toBeTruthy();
		expect(screen.getByText("Hidden")).toBeTruthy();
		// Published row offers a view link to its public path.
		expect(screen.getByLabelText("View").getAttribute("href")).toBe("/about");
	});

	it("shows the empty state", () => {
		render(<PagesAdminPage pages={[]} locale="en" />);
		expect(screen.getByText("No custom pages yet")).toBeTruthy();
	});

	it("localizes copy for other locales", () => {
		render(<PagesAdminPage pages={[]} locale="pt-BR" />);
		expect(screen.getByText("Páginas")).toBeTruthy();
		expect(screen.getByText("Nenhuma página personalizada ainda")).toBeTruthy();
	});

	it("creates a page through the dialog", async () => {
		const user = userEvent.setup();
		fns.createPageFn.mockResolvedValue(row({ id: 9 }));
		render(<PagesAdminPage pages={[]} locale="en" />);
		await user.click(screen.getByText("New page"));
		await user.type(screen.getByLabelText("Path"), "/new");
		await user.type(screen.getByLabelText("Title"), "New page title");
		await user.type(screen.getByLabelText("Content (Markdown)"), "# Hi");
		// First checkbox is "Published" (DOM order: published, showInNav).
		await user.click(screen.getAllByRole("checkbox")[0]!);
		await user.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() =>
			expect(fns.createPageFn).toHaveBeenCalledWith({
				data: {
					path: "/new",
					title: "New page title",
					content: "# Hi",
					published: true,
					showInNav: false,
					sortOrder: 0,
				},
			}),
		);
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("updates an existing page", async () => {
		const user = userEvent.setup();
		fns.updatePageFn.mockResolvedValue(row({ title: "Renamed" }));
		render(<PagesAdminPage pages={[row({})]} locale="en" />);
		await user.click(screen.getByLabelText("Edit"));
		const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
		expect(titleInput.value).toBe("About");
		await user.clear(titleInput);
		await user.type(titleInput, "Renamed");
		await user.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(fns.updatePageFn).toHaveBeenCalledWith({
				data: expect.objectContaining({ id: 1, title: "Renamed", path: "/about" }),
			}),
		);
	});

	it("surfaces a failure message when the fn returns null", async () => {
		const user = userEvent.setup();
		fns.createPageFn.mockResolvedValue(null);
		render(<PagesAdminPage pages={[]} locale="en" />);
		await user.click(screen.getByText("New page"));
		await user.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(screen.getByText(/Could not save/)).toBeTruthy());
		expect(invalidate).not.toHaveBeenCalled();
	});

	it("surfaces a failure message when the fn throws", async () => {
		const user = userEvent.setup();
		fns.createPageFn.mockRejectedValue(new Error("boom"));
		render(<PagesAdminPage pages={[]} locale="en" />);
		await user.click(screen.getByText("New page"));
		await user.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(screen.getByText(/Could not save/)).toBeTruthy());
	});

	it("deletes a page after confirmation", async () => {
		const user = userEvent.setup();
		fns.deletePageFn.mockResolvedValue(true);
		render(<PagesAdminPage pages={[row({})]} locale="en" />);
		await user.click(screen.getByLabelText("Delete"));
		expect(screen.getByText('Delete "/about"? This cannot be undone.')).toBeTruthy();
		await user.click(screen.getByText("Delete", { selector: "button" }));
		await waitFor(() => expect(fns.deletePageFn).toHaveBeenCalledWith({ data: { id: 1 } }));
		await waitFor(() => expect(invalidate).toHaveBeenCalled());
	});

	it("reports a failed delete without invalidating", async () => {
		const user = userEvent.setup();
		fns.deletePageFn.mockResolvedValue(false);
		render(<PagesAdminPage pages={[row({})]} locale="en" />);
		await user.click(screen.getByLabelText("Delete"));
		fireEvent.click(screen.getByText("Delete", { selector: "button" }));
		await waitFor(() => expect(screen.getByText(/Could not save/)).toBeTruthy());
	});

	it("surfaces a failure message when delete throws", async () => {
		const user = userEvent.setup();
		fns.deletePageFn.mockRejectedValue(new Error("boom"));
		render(<PagesAdminPage pages={[row({})]} locale="en" />);
		await user.click(screen.getByLabelText("Delete"));
		await user.click(screen.getByText("Delete", { selector: "button" }));
		await waitFor(() => expect(screen.getByText(/Could not save/)).toBeTruthy());
		expect(invalidate).not.toHaveBeenCalled();
	});

	it("edits sort order and the nav flag, then cancels the dialog", async () => {
		const user = userEvent.setup();
		fns.createPageFn.mockResolvedValue(row({ id: 9 }));
		render(<PagesAdminPage pages={[row({})]} locale="en" />);
		await user.click(screen.getByLabelText("Edit"));
		const order = screen.getByLabelText("Sort order") as HTMLInputElement;
		expect(order.value).toBe("2");
		await user.clear(order);
		await user.type(order, "7");
		// Second checkbox is "Show in navigation" (row starts checked).
		await user.click(screen.getAllByRole("checkbox")[1]!);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByLabelText("Path")).toBeNull());
		expect(fns.updatePageFn).not.toHaveBeenCalled();
		expect(fns.createPageFn).not.toHaveBeenCalled();
	});

	it("closes the form dialog on Escape", async () => {
		const user = userEvent.setup();
		render(<PagesAdminPage pages={[]} locale="en" />);
		await user.click(screen.getByText("New page"));
		expect(screen.getByLabelText("Path")).toBeTruthy();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByLabelText("Path")).toBeNull());
	});

	it("closes the delete confirm dialog via its cancel action", async () => {
		const user = userEvent.setup();
		render(<PagesAdminPage pages={[row({})]} locale="en" />);
		await user.click(screen.getByLabelText("Delete"));
		expect(screen.getByText(/cannot be undone/)).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByText(/cannot be undone/)).toBeNull());
		expect(fns.deletePageFn).not.toHaveBeenCalled();
	});
});
