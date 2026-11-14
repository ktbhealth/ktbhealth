import { describe, expect, it } from "vitest";

import {
	actingAs,
	DOCTOR_PROFILE_COOKIE,
	DoctorDelegations,
	DoctorProfiles,
	profileIdFromHeaders,
	resolveDoctorProfile,
	type DoctorProfile,
} from "./profiles.ts";

const cookie = (value: string) => new Headers({ cookie: value });

describe("profile ports", () => {
	it("declare stable service keys", () => {
		expect(DoctorProfiles.key).toBe("@ktb/auth/DoctorProfiles");
		expect(DoctorDelegations.key).toBe("@ktb/auth/DoctorDelegations");
	});
});

describe("profileIdFromHeaders", () => {
	it("reads the selected id among other cookies", () => {
		const headers = cookie(`ktb-locale=pt-BR; ${DOCTOR_PROFILE_COOKIE}=12; other=7`);
		expect(profileIdFromHeaders(headers, DOCTOR_PROFILE_COOKIE)).toBe(12);
	});

	it("is null without the cookie", () => {
		expect(profileIdFromHeaders(new Headers(), DOCTOR_PROFILE_COOKIE)).toBeNull();
		expect(profileIdFromHeaders(cookie("flag; other=1"), DOCTOR_PROFILE_COOKIE)).toBeNull();
		// A name that merely ends with the cookie name is a different cookie.
		expect(profileIdFromHeaders(cookie("x_ktb_doctor=3"), DOCTOR_PROFILE_COOKIE)).toBeNull();
	});

	it("rejects values that are not positive integers", () => {
		for (const value of ["", "0", "-1", "1.5", "abc", "1 OR 1=1"]) {
			expect(profileIdFromHeaders(cookie(`ktb_doctor=${value}`), DOCTOR_PROFILE_COOKIE)).toBeNull();
		}
	});
});

describe("actingAs", () => {
	const user = { id: "sec", email: "sec@ktb.test", name: "Sec" };
	const doctor: DoctorProfile = {
		doctorId: 1,
		userId: "doc",
		email: "doc@ktb.test",
		displayName: "Dra",
		role: "secretary",
	};

	it("acts as the signed-in user when no profile applies", () => {
		expect(actingAs(user, null)).toEqual({
			...user,
			actorId: "sec",
			doctor: { name: "Sec", email: "sec@ktb.test" },
		});
	});

	it("scopes to the doctor while keeping the actor's identity", () => {
		expect(actingAs(user, doctor)).toEqual({
			id: "doc",
			email: "sec@ktb.test",
			name: "Sec",
			actorId: "sec",
			doctor: { name: "Dra", email: "doc@ktb.test" },
		});
	});
});

describe("resolveDoctorProfile", () => {
	const profile = (doctorId: number, role: DoctorProfile["role"]): DoctorProfile => ({
		doctorId,
		userId: `doc-${doctorId}`,
		email: `doc-${doctorId}@ktb.test`,
		displayName: `Doctor ${doctorId}`,
		role,
	});
	const own = profile(1, "owner");
	const a = profile(2, "secretary");
	const b = profile(3, "secretary");

	it("acts as the selected profile when the user holds it", () => {
		expect(resolveDoctorProfile([own, a], 2)).toBe(a);
	});

	it("defaults to the user's own profile", () => {
		expect(resolveDoctorProfile([own, a, b], null)).toBe(own);
		expect(resolveDoctorProfile([own, a], 99)).toBe(own);
	});

	it("defaults to the only delegated profile", () => {
		expect(resolveDoctorProfile([a], null)).toBe(a);
	});

	it("is null without a profile or while a choice is pending", () => {
		expect(resolveDoctorProfile([], 1)).toBeNull();
		expect(resolveDoctorProfile([a, b], null)).toBeNull();
		expect(resolveDoctorProfile([a, b], 99)).toBeNull();
	});
});
