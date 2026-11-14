import { beforeAll, describe, expect, it, vi } from "vitest";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));
vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => {
		let validate: ((x: unknown) => unknown) | undefined;
		const chain = {
			validator: (v: (x: unknown) => unknown) => {
				validate = v;
				return chain;
			},
			handler: (h: (arg?: { data?: unknown }) => unknown) => async (arg?: { data?: unknown }) =>
				h(arg === undefined ? {} : { ...arg, data: validate ? validate(arg.data) : arg.data }),
		};
		return chain;
	},
}));

import { doctors, user } from "@ktb/db/schema";
import { eq } from "drizzle-orm";

import { auth, db } from "./platform.ts";
import { createPatientFn, listPatientsFn } from "./fns.ts";

// End-to-end doctor scope: clinical data is reached through the doctor
// profile a request acts as, selected by the `ktb_doctor` cookie and
// re-validated against the profile directory on every request.

async function signIn(email: string) {
	await auth.api.signUpEmail({ body: { email, password: "senha-forte-123", name: email } });
	const res = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "senha-forte-123" }),
		}),
	);
	const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
	return { id: row!.id, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]! };
}

const as = (cookie: string, doctorId?: number) => {
	headers.current = new Headers({
		cookie: doctorId === undefined ? cookie : `${cookie}; ktb_doctor=${doctorId}`,
	});
};

const patientNames = async () => (await listPatientsFn()).map((p) => p.name).sort();

describe("acting as a doctor", () => {
	let doctor: Awaited<ReturnType<typeof signIn>>;
	let stranger: Awaited<ReturnType<typeof signIn>>;
	let doctorId: number;

	beforeAll(async () => {
		doctor = await signIn("acting-doctor@x.com");
		stranger = await signIn("acting-stranger@x.com");
		const [profile] = await db
			.insert(doctors)
			.values({ userId: doctor.id, displayName: "Dra. Acting" })
			.returning();
		doctorId = profile!.id;
		as(doctor.cookie);
		await createPatientFn({ data: { name: "Paciente Um", birthDate: "1984-03-05" } });
	});

	it("the doctor may select their own profile", async () => {
		as(doctor.cookie, doctorId);
		expect(await patientNames()).toEqual(["Paciente Um"]);
	});

	it("an account with no doctor profile sees nothing and cannot write", async () => {
		as(stranger.cookie);
		expect(await patientNames()).toEqual([]);
		await expect(
			createPatientFn({ data: { name: "Intruso", birthDate: "1990-01-01" } }),
		).rejects.toMatchObject({ message: "forbidden", status: 403 });
	});

	it("a forged selector grants nothing", async () => {
		as(stranger.cookie, doctorId);
		expect(await patientNames()).toEqual([]);
	});
});
