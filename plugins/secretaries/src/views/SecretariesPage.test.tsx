// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SecretariesPage, type SecretariesApi, type SecretaryListItem } from "./index.ts";

const active: SecretaryListItem = { id: 1, email: "ana@ktb.test", status: "active" };
const invited: SecretaryListItem = { id: 2, email: "leo@ktb.test", status: "invited" };

const setup = (secretaries: SecretaryListItem[], overrides: Partial<SecretariesApi> = {}) => {
	const api: SecretariesApi = {
		invite: vi.fn<SecretariesApi["invite"]>(async () => ({ ok: true })),
		revoke: vi.fn<SecretariesApi["revoke"]>(async () => ({ ok: true })),
		...overrides,
	};
	const onChanged = vi.fn<() => void>();
	render(<SecretariesPage secretaries={secretaries} locale="en" api={api} onChanged={onChanged} />);
	return { api, onChanged };
};

const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const submitInvite = (value: string) =>
	act(async () => {
		fireEvent.change(email(), { target: { value } });
		fireEvent.submit(email().closest("form")!);
	});

afterEach(cleanup);

describe("SecretariesPage", () => {
	it("shows the empty state without secretaries", () => {
		setup([]);
		expect(screen.getByText("No secretaries yet")).toBeTruthy();
	});

	it("lists secretaries with their status", () => {
		setup([active, invited]);
		expect(screen.getByText("ana@ktb.test")).toBeTruthy();
		expect(screen.getByText("Active")).toBeTruthy();
		expect(screen.getByText("leo@ktb.test")).toBeTruthy();
		expect(screen.getByText("Invited")).toBeTruthy();
	});

	it("invites by email, clears the field and refreshes", async () => {
		const { api, onChanged } = setup([]);
		await submitInvite("new@ktb.test");
		expect(api.invite).toHaveBeenCalledWith("new@ktb.test");
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
		expect(email().value).toBe("");
	});

	it("ignores an empty address", async () => {
		const { api } = setup([]);
		await submitInvite("   ");
		expect(api.invite).not.toHaveBeenCalled();
	});

	it("shows the rejection reason and keeps the typed address", async () => {
		const { onChanged } = setup([], {
			invite: async () => ({ ok: false, error: "self" }),
		});
		await submitInvite("me@ktb.test");
		await waitFor(() => expect(screen.getByText("You cannot invite your own email.")).toBeTruthy());
		expect(email().value).toBe("me@ktb.test");
		expect(onChanged).not.toHaveBeenCalled();
	});

	it("reports a generic failure when the invite call throws", async () => {
		setup([], { invite: async () => Promise.reject(new Error("network")) });
		await submitInvite("new@ktb.test");
		await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
	});

	it("ignores a second invite while one is in flight", async () => {
		let release: (value: { ok: true }) => void = () => {};
		const invite = vi.fn<SecretariesApi["invite"]>(
			() => new Promise<{ ok: true }>((resolve) => (release = resolve)),
		);
		const { onChanged } = setup([], { invite });
		await submitInvite("new@ktb.test");
		expect(screen.getByRole("button", { name: "Please wait…" })).toBeTruthy();
		await act(async () => {
			fireEvent.submit(email().closest("form")!);
		});
		expect(invite).toHaveBeenCalledTimes(1);
		await act(async () => release({ ok: true }));
		expect(onChanged).toHaveBeenCalledTimes(1);
	});

	it("removes access and refreshes", async () => {
		const { api, onChanged } = setup([active, invited]);
		await act(async () => {
			fireEvent.click(screen.getAllByRole("button", { name: "Remove access" })[1]!);
		});
		expect(api.revoke).toHaveBeenCalledWith(2);
		await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
	});

	it("reports a failed or refused removal", async () => {
		const revoke = vi
			.fn<SecretariesApi["revoke"]>()
			.mockResolvedValueOnce({ ok: false })
			.mockRejectedValueOnce(new Error("network"));
		const { onChanged } = setup([active], { revoke });
		const remove = () =>
			act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
			});
		await remove();
		await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
		await remove();
		await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
		expect(screen.getByText(/Something went wrong/)).toBeTruthy();
		expect(onChanged).not.toHaveBeenCalled();
	});
});
