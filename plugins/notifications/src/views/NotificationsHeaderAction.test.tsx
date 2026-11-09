// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	NotificationsActionsContext,
	NotificationsDataContext,
	type ConsoleNotification,
	type NotificationsActions,
} from "../context.ts";
import { NotificationsHeaderAction } from "./NotificationsHeaderAction.tsx";

const seeded: ConsoleNotification[] = [
	{ id: "1", title: "Patient created", description: "Ana", read: false, meta: "patient.created" },
	{ id: "2", title: "Consultation started", read: true },
];

class MockEventSource {
	static instances: MockEventSource[] = [];
	onmessage: ((event: { data: string }) => void) | null = null;
	closed = false;
	constructor(public readonly url: string) {
		MockEventSource.instances.push(this);
	}
	close() {
		this.closed = true;
	}
}

const renderAction = (
	value: readonly ConsoleNotification[] = seeded,
	actions: NotificationsActions | null = null,
) =>
	render(
		<NotificationsDataContext.Provider value={value}>
			<NotificationsActionsContext.Provider value={actions}>
				<NotificationsHeaderAction />
			</NotificationsActionsContext.Provider>
		</NotificationsDataContext.Provider>,
	);

afterEach(() => {
	cleanup();
	MockEventSource.instances = [];
	vi.unstubAllGlobals();
});

describe("NotificationsHeaderAction", () => {
	it("renders the seeded feed with an unread badge and no EventSource", () => {
		vi.stubGlobal("EventSource", undefined);
		renderAction();
		const button = screen.getByRole("button", { name: "Notifications" });
		// 1 unread of 2 seeded.
		expect(button.textContent).toContain("1");
	});

	it("merges live EventSource frames, deduped by id, and updates the badge", async () => {
		vi.stubGlobal("EventSource", MockEventSource);
		const user = userEvent.setup();
		renderAction();

		expect(MockEventSource.instances).toHaveLength(1);
		expect(MockEventSource.instances[0]!.url).toBe("/api/notifications");
		const source = MockEventSource.instances[0]!;

		// Backlog replay of an already-seeded row: replaces in place, no
		// dupe — and flips it to read, dropping the badge to 0.
		act(() => {
			source.onmessage!({
				data: JSON.stringify({ id: "1", title: "Patient created", read: true }),
			});
		});
		expect(screen.getByRole("button", { name: "Notifications" }).textContent).not.toContain("1");
		// Live arrival: unread → badge shows 1.
		act(() => {
			source.onmessage!({
				data: JSON.stringify({ id: "3", title: "Live ping", read: false }),
			});
		});

		const button = screen.getByRole("button", { name: "Notifications" });
		expect(button.textContent).toContain("1");

		await user.click(button);
		expect(await screen.findByText("Live ping")).toBeTruthy();
		// Seeded row updated to read — exactly one row per id.
		expect(screen.getAllByText("Patient created")).toHaveLength(1);
	});

	it("closes the EventSource on unmount", () => {
		vi.stubGlobal("EventSource", MockEventSource);
		const { unmount } = renderAction();
		const source = MockEventSource.instances[0]!;
		unmount();
		expect(source.closed).toBe(true);
	});

	it("marks a single notification read on row click and drops the badge", async () => {
		vi.stubGlobal("EventSource", undefined);
		const markRead = vi.fn<NotificationsActions["markRead"]>(async () => true);
		const user = userEvent.setup();
		renderAction(seeded, {
			markRead,
			markAllRead: vi.fn<NotificationsActions["markAllRead"]>(async () => true),
		});

		await user.click(screen.getByRole("button", { name: "Notifications" }));
		await user.click(await screen.findByRole("button", { name: 'Mark "Patient created" as read' }));
		expect(markRead).toHaveBeenCalledWith([1]);
		// Unread row flipped to read → badge clears.
		expect(
			(await screen.findByRole("button", { name: "Notifications" })).textContent,
		).not.toContain("1");
		// Read rows are no longer clickable.
		expect(
			screen.queryByRole("button", { name: 'Mark "Consultation started" as read' }),
		).toBeNull();
	});

	it("marks all notifications read from the header action", async () => {
		vi.stubGlobal("EventSource", undefined);
		const markAllRead = vi.fn<NotificationsActions["markAllRead"]>(async () => true);
		const user = userEvent.setup();
		renderAction(seeded, {
			markRead: vi.fn<NotificationsActions["markRead"]>(async () => true),
			markAllRead,
		});

		await user.click(screen.getByRole("button", { name: "Notifications" }));
		await user.click(await screen.findByRole("button", { name: "Mark all read" }));
		expect(markAllRead).toHaveBeenCalledOnce();
		expect(
			(await screen.findByRole("button", { name: "Notifications" })).textContent,
		).not.toContain("1");
	});

	it("keeps rows non-interactive and hides mark-all when no actions are wired", async () => {
		vi.stubGlobal("EventSource", undefined);
		const user = userEvent.setup();
		renderAction(seeded, null);

		await user.click(screen.getByRole("button", { name: "Notifications" }));
		expect(await screen.findByText("Patient created")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Mark all read/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /as read/ })).toBeNull();
	});

	it("keeps arrival order for non-numeric ids from the live stream", async () => {
		vi.stubGlobal("EventSource", MockEventSource);
		const user = userEvent.setup();
		renderAction();
		act(() => {
			MockEventSource.instances[0]!.onmessage!({
				data: JSON.stringify({ id: "abc", title: "Odd one", read: false }),
			});
		});
		await user.click(screen.getByRole("button", { name: "Notifications" }));
		expect(await screen.findByText("Odd one")).toBeTruthy();
		// 1 seeded unread + the live unread.
		expect(screen.getByRole("button", { name: "Notifications" }).textContent).toContain("2");
	});

	it("ignores clicks on rows whose id is not numeric", async () => {
		vi.stubGlobal("EventSource", undefined);
		const markRead = vi.fn<NotificationsActions["markRead"]>(async () => true);
		const user = userEvent.setup();
		renderAction([{ id: "abc", title: "Odd", read: false }], {
			markRead,
			markAllRead: vi.fn<NotificationsActions["markAllRead"]>(async () => true),
		});
		await user.click(screen.getByRole("button", { name: "Notifications" }));
		await user.click(await screen.findByRole("button", { name: 'Mark "Odd" as read' }));
		expect(markRead).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Notifications" }).textContent).toContain("1");
	});

	it("leaves rows unread when the host reports mark-read failed", async () => {
		vi.stubGlobal("EventSource", undefined);
		const markRead = vi.fn<NotificationsActions["markRead"]>(async () => false);
		const user = userEvent.setup();
		renderAction(seeded, {
			markRead,
			markAllRead: vi.fn<NotificationsActions["markAllRead"]>(async () => true),
		});
		await user.click(screen.getByRole("button", { name: "Notifications" }));
		await user.click(await screen.findByRole("button", { name: 'Mark "Patient created" as read' }));
		await vi.waitFor(() => expect(markRead).toHaveBeenCalledWith([1]));
		expect(screen.getByRole("button", { name: "Notifications" }).textContent).toContain("1");
		expect(screen.getByRole("button", { name: 'Mark "Patient created" as read' })).toBeTruthy();
	});

	it("leaves rows unread when the host reports mark-all failed", async () => {
		vi.stubGlobal("EventSource", undefined);
		const markAllRead = vi.fn<NotificationsActions["markAllRead"]>(async () => false);
		const user = userEvent.setup();
		renderAction(seeded, {
			markRead: vi.fn<NotificationsActions["markRead"]>(async () => true),
			markAllRead,
		});
		await user.click(screen.getByRole("button", { name: "Notifications" }));
		await user.click(await screen.findByRole("button", { name: "Mark all read" }));
		await vi.waitFor(() => expect(markAllRead).toHaveBeenCalledOnce());
		expect(screen.getByRole("button", { name: "Notifications" }).textContent).toContain("1");
	});

	it("shows an empty state when there are no notifications", async () => {
		vi.stubGlobal("EventSource", undefined);
		const user = userEvent.setup();
		renderAction([], null);
		await user.click(screen.getByRole("button", { name: "Notifications" }));
		expect(await screen.findByText("No notifications")).toBeTruthy();
	});
});
