// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DoctorSelectPage, type DoctorProfileItem, type DoctorSelectApi } from "./index.ts";

const own: DoctorProfileItem = { doctorId: 1, displayName: "Dra. Ana", role: "owner" };
const delegated: DoctorProfileItem = { doctorId: 2, displayName: "Dr. Leo", role: "secretary" };

const setup = (
	profiles: DoctorProfileItem[],
	overrides: Partial<DoctorSelectApi> = {},
	activeDoctorId: number | null = 1,
) => {
	const api: DoctorSelectApi = {
		select: vi.fn<DoctorSelectApi["select"]>(async () => ({ ok: true })),
		...overrides,
	};
	const onDone = vi.fn<() => void>();
	render(
		<DoctorSelectPage
			profiles={profiles}
			activeDoctorId={activeDoctorId}
			locale="en"
			api={api}
			onDone={onDone}
		/>,
	);
	return { api, onDone };
};

const click = (name: string, index = 0) =>
	act(async () => {
		fireEvent.click(screen.getAllByRole("button", { name })[index]!);
	});

afterEach(cleanup);

describe("DoctorSelectPage", () => {
	it("lists the profiles with their role and marks the current one", () => {
		setup([own, delegated]);
		expect(screen.getByText("Dra. Ana")).toBeTruthy();
		expect(screen.getByText("My profile")).toBeTruthy();
		expect(screen.getByText("Dr. Leo")).toBeTruthy();
		expect(screen.getByText("Secretary")).toBeTruthy();
		expect(screen.getAllByText("Current")).toHaveLength(1);
	});

	it("selects a profile and leaves the chooser", async () => {
		const { api, onDone } = setup([own, delegated]);
		await click("Use this profile", 1);
		expect(api.select).toHaveBeenCalledWith(2);
		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
	});

	it("stays and reports when the selection is refused or fails", async () => {
		const select = vi
			.fn<DoctorSelectApi["select"]>()
			.mockResolvedValueOnce({ ok: false })
			.mockRejectedValueOnce(new Error("network"));
		const { onDone } = setup([own, delegated], { select });
		await click("Use this profile");
		await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
		await click("Use this profile");
		await waitFor(() => expect(select).toHaveBeenCalledTimes(2));
		expect(screen.getByText(/Something went wrong/)).toBeTruthy();
		expect(onDone).not.toHaveBeenCalled();
	});

	it("never offers to create a doctor profile", () => {
		setup([delegated], {}, null);
		expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
		expect(screen.getAllByRole("button")).toHaveLength(1);
	});

	it("locks the choices while a selection is in flight", async () => {
		let release: (value: { ok: boolean }) => void = () => {};
		const select = () => new Promise<{ ok: boolean }>((resolve) => (release = resolve));
		const { onDone } = setup([own, delegated], { select });
		await click("Use this profile");
		for (const button of screen.getAllByRole("button")) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
		}
		await act(async () => release({ ok: true }));
		expect(onDone).toHaveBeenCalledTimes(1);
	});
});
