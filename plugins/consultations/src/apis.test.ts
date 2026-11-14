import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	patientLinksFn: vi.fn(),
	invitePatientFn: vi.fn(),
}));

vi.mock("@ktb/patient-access/fns", () => mocks);
vi.mock("@ktb/patients/fns", () => ({ createPatientFn: vi.fn(), listPatientsFn: vi.fn() }));
vi.mock("./fns.ts", () => ({
	attachAnamnesisFn: vi.fn(),
	extractAnamnesisFn: vi.fn(),
	getConsultationFn: vi.fn(),
	getLiveConsultationFn: vi.fn(),
	recordConsentFn: vi.fn(),
	saveConsultationFn: vi.fn(),
}));

import { newConsultationApi, validateNewConsultationSearch } from "./apis.ts";

const patient = { id: 1, name: "Maria", email: "maria@ktb.test" };
const link = (status: string) => ({ id: 7, email: "maria@ktb.test", status });

beforeEach(() => vi.clearAllMocks());

describe("newConsultationApi.patientAccess", () => {
	const standing = () => newConsultationApi.patientAccess!({ data: 1 });

	it("reports the record's email and no access for a patient with no links", async () => {
		mocks.patientLinksFn.mockResolvedValue({ patient, links: [] });
		await expect(standing()).resolves.toEqual({ email: "maria@ktb.test", hasAccess: false });
		expect(mocks.patientLinksFn).toHaveBeenCalledWith({ data: 1 });
	});

	it.each(["active", "invited"])("counts an %s link as access", async (status) => {
		mocks.patientLinksFn.mockResolvedValue({ patient, links: [link("pending"), link(status)] });
		await expect(standing()).resolves.toMatchObject({ hasAccess: true });
	});

	it("does not count a CPF match still awaiting the doctor's approval", async () => {
		mocks.patientLinksFn.mockResolvedValue({
			patient: { ...patient, email: null },
			links: [link("pending")],
		});
		await expect(standing()).resolves.toEqual({ email: null, hasAccess: false });
	});

	it("is null for a patient the acting doctor may not see", async () => {
		mocks.patientLinksFn.mockResolvedValue(null);
		await expect(standing()).resolves.toBeNull();
	});
});

describe("newConsultationApi.invitePatient", () => {
	const invite = () =>
		newConsultationApi.invitePatient!({ data: { patientId: 1, email: "maria@ktb.test" } });

	it("invites the patient themself and reports whether the email went out", async () => {
		mocks.invitePatientFn.mockResolvedValue({ ok: true, link: link("invited"), emailed: true });
		await expect(invite()).resolves.toEqual({ ok: true, emailed: true });
		expect(mocks.invitePatientFn).toHaveBeenCalledWith({
			data: { patientId: 1, email: "maria@ktb.test", relation: "self" },
		});
		mocks.invitePatientFn.mockResolvedValue({ ok: true, link: link("invited"), emailed: false });
		await expect(invite()).resolves.toEqual({ ok: true, emailed: false });
	});

	it("passes a refusal through", async () => {
		mocks.invitePatientFn.mockResolvedValue({ ok: false, error: "invalid_email" });
		await expect(invite()).resolves.toEqual({ ok: false, error: "invalid_email" });
	});
});

describe("validateNewConsultationSearch", () => {
	it("keeps a positive integer patientId and drops anything else", () => {
		expect(validateNewConsultationSearch({ patientId: "4" })).toEqual({ patientId: 4 });
		expect(validateNewConsultationSearch({ patientId: "x" })).toEqual({});
		expect(validateNewConsultationSearch({ patientId: 0 })).toEqual({});
		expect(validateNewConsultationSearch({})).toEqual({});
	});
});
