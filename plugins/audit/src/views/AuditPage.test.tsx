// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { AdminAuditRow } from "../index.ts";
import { AuditPage } from "./AuditPage.tsx";

const row = (over: Partial<AdminAuditRow>): AdminAuditRow => ({
	id: 1,
	actorUserId: "u1",
	actorEmail: "admin@x.com",
	action: "users.suspend",
	targetType: "user",
	targetId: "u9",
	detail: '{"suspended":true}',
	tenantId: null,
	createdAt: new Date("2026-11-01T10:00:00Z"),
	...over,
});

const TWO_ROWS = [
	row({}),
	row({
		id: 2,
		actorUserId: null,
		actorEmail: null,
		action: "groups.delete",
		targetType: "group",
		targetId: "4",
		detail: null,
		tenantId: 4,
	}),
];

afterEach(cleanup);

describe("AuditPage", () => {
	it("renders the empty state", () => {
		render(<AuditPage entries={[]} total={0} locale="en" />);
		expect(screen.getByText("Audit log")).toBeTruthy();
		expect(screen.getByText("No audit entries")).toBeTruthy();
	});

	it("renders rows with actor, action, target and tenant fallbacks", () => {
		render(<AuditPage entries={TWO_ROWS} total={2} locale="en" />);
		expect(screen.getByText("admin@x.com")).toBeTruthy();
		expect(screen.getByText("users.suspend")).toBeTruthy();
		expect(screen.getByText("user:u9")).toBeTruthy();
		// Second row: no actor → "system", no detail → no JSON button,
		// tenantId 4 → "#4".
		expect(screen.getByText("system")).toBeTruthy();
		expect(screen.getByText("groups.delete")).toBeTruthy();
		expect(screen.getByText("#4")).toBeTruthy();
		expect(screen.getAllByText("JSON")).toHaveLength(1);
		expect(screen.getByText("2 admin actions recorded.")).toBeTruthy();
	});

	it("shows the capped description when total exceeds the page", () => {
		render(<AuditPage entries={TWO_ROWS} total={9} locale="en" />);
		expect(screen.getByText("Latest 2 of 9 admin actions.")).toBeTruthy();
	});

	it("filters rows by the search box", () => {
		render(<AuditPage entries={TWO_ROWS} total={2} locale="en" />);
		fireEvent.change(screen.getByLabelText("Search audit entries"), {
			target: { value: "groups" },
		});
		expect(screen.queryByText("users.suspend")).toBeNull();
		expect(screen.getByText("groups.delete")).toBeTruthy();
		expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
	});

	it("shows the no-match row when filters exclude everything", () => {
		render(<AuditPage entries={TWO_ROWS} total={2} locale="en" />);
		fireEvent.change(screen.getByLabelText("Search audit entries"), {
			target: { value: "zzz-no-match" },
		});
		expect(screen.getByText("No entries match the filters.")).toBeTruthy();
	});

	it("filters by action group through the select", async () => {
		const user = userEvent.setup();
		render(<AuditPage entries={TWO_ROWS} total={2} locale="en" />);
		await user.click(screen.getByLabelText("All actions"));
		await user.click(await screen.findByRole("option", { name: "groups" }));
		expect(screen.queryByText("users.suspend")).toBeNull();
		expect(screen.getByText("groups.delete")).toBeTruthy();
	});

	it("opens the detail dialog with parsed JSON and closes it", async () => {
		const user = userEvent.setup();
		render(<AuditPage entries={TWO_ROWS} total={2} locale="en" />);
		await user.click(screen.getByText("JSON"));
		expect(screen.getByText("Audit entry")).toBeTruthy();
		expect(screen.getByText(/"suspended": true/)).toBeTruthy();
		// The dialog's built-in close control dismisses via onOpenChange.
		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(screen.queryByText("Audit entry")).toBeNull();
	});

	it("renders raw detail text when the payload is not JSON", async () => {
		const user = userEvent.setup();
		render(<AuditPage entries={[row({ detail: "not-json{{{" })]} total={1} locale="en" />);
		await user.click(screen.getByText("JSON"));
		expect(screen.getByText(/not-json/)).toBeTruthy();
	});

	it("localizes the console in pt-BR", () => {
		render(<AuditPage entries={TWO_ROWS} total={2} locale="pt-BR" />);
		expect(screen.getByText("Log de auditoria")).toBeTruthy();
		expect(screen.getByText(/2 ações de admin registradas/)).toBeTruthy();
	});

	it("handles string/invalid dates, dot-less actions and empty targets", () => {
		render(
			<AuditPage
				entries={[
					row({
						id: 3,
						action: "login",
						targetType: null,
						targetId: null,
						detail: null,
						// Serialized loader payloads carry ISO strings.
						createdAt: "2026-11-01T10:00:00Z" as unknown as Date,
					}),
					row({
						id: 4,
						action: "users.touch",
						targetType: "user",
						targetId: "",
						detail: null,
						createdAt: "not-a-date" as unknown as Date,
					}),
				]}
				total={2}
				locale="en"
			/>,
		);
		// Dot-less action groups under itself; empty targets render "—".
		expect(screen.getByText("login")).toBeTruthy();
		expect(screen.getByText("user")).toBeTruthy();
		expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
	});

	it("searches rows with null target ids", () => {
		render(
			<AuditPage
				entries={[
					row({
						id: 5,
						action: "rbac.role.delete",
						targetType: "role",
						targetId: null,
						detail: null,
					}),
					row({ id: 6, action: "users.suspend", targetId: "u9" }),
				]}
				total={2}
				locale="en"
			/>,
		);
		fireEvent.change(screen.getByLabelText("Search audit entries"), {
			target: { value: "rbac" },
		});
		expect(screen.queryByText("users.suspend")).toBeNull();
		expect(screen.getByText("rbac.role.delete")).toBeTruthy();
	});
});
