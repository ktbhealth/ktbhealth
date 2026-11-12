import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	doctorAccessFn: vi.fn<() => Promise<"anonymous" | "no-doctor" | "doctor">>(),
}));

vi.mock("./fns.ts", () => ({ doctorAccessFn: mocks.doctorAccessFn }));

import { isRedirect } from "@tanstack/react-router";

import { requireDoctor } from "./guard.ts";

// redirect() returns a Response carrying the navigation options.
const redirectTarget = async () => {
	const caught = await requireDoctor().catch((e: unknown) => e);
	expect(isRedirect(caught)).toBe(true);
	return (caught as Response & { options: { to: string } }).options.to;
};

describe("requireDoctor", () => {
	it("passes for a user acting as a doctor", async () => {
		mocks.doctorAccessFn.mockResolvedValue("doctor");
		await expect(requireDoctor()).resolves.toBeUndefined();
	});

	it("redirects anonymous visitors to /login", async () => {
		mocks.doctorAccessFn.mockResolvedValue("anonymous");
		expect(await redirectTarget()).toBe("/login");
	});

	it("redirects accounts without a doctor profile to the chooser", async () => {
		mocks.doctorAccessFn.mockResolvedValue("no-doctor");
		expect(await redirectTarget()).toBe("/doctors/select");
	});
});
