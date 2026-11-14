import { afterEach, describe, expect, it, vi } from "vitest";

const cookies = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn() }));
vi.mock("@tanstack/react-start/server", () => ({
	setCookie: cookies.set,
	deleteCookie: cookies.delete,
}));

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Auth, DoctorProfiles, type DoctorProfile } from "@ktb/auth";

import {
	ensureDoctorUser,
	getDoctorAccess,
	getDoctorContext,
	getDoctorUser,
	resetServerRuntime,
	setDoctorSelection,
	setServerRuntime,
} from "./index.ts";

const sec = { id: "sec", email: "sec@ktb.test", name: "Sec" };
const delegated: DoctorProfile = {
	doctorId: 7,
	userId: "doc",
	email: "doc@ktb.test",
	displayName: "Dra",
	role: "secretary",
};
const self = { ...sec, actorId: "sec", doctor: { name: "Sec", email: "sec@ktb.test" } };
const asDoctor = {
	id: "doc",
	email: "sec@ktb.test",
	name: "Sec",
	actorId: "sec",
	doctor: { name: "Dra", email: "doc@ktb.test" },
};

/** Directory lookups performed, by user id — proves when no lookup happens. */
let lookups: string[] = [];
/** Invite claims performed, by user id. */
let claims: string[] = [];

const AuthStub = (user: typeof sec | null) =>
	Layer.succeed(
		Auth,
		Auth.of({
			getSession: async () =>
				user === null ? null : { user, sessionId: "s1", expiresAt: new Date(0) },
			setUserBanned: async () => {},
		}),
	);

const DirectoriesStub = Layer.succeed(DoctorProfiles, {
	listFor: (userId) =>
		Effect.sync(() => {
			lookups.push(userId);
			return userId === "sec" ? [delegated] : [];
		}),
	claimInvites: (userId) =>
		Effect.sync(() => {
			claims.push(userId);
			return 0;
		}),
});

const boot = (layer: Layer.Layer<never>) => {
	lookups = [];
	claims = [];
	const run = <A, E>(effect: Effect.Effect<A, E, unknown>): Promise<A> =>
		Effect.runPromise(Effect.provide(effect as Effect.Effect<A, E, never>, layer));
	setServerRuntime({
		run,
		runAs: (_user, effect) => run(effect),
		getLocale: () => "en",
		audioTranscribeModel: "test-model",
	});
};
const signedIn = (user: typeof sec | null = sec) =>
	boot(Layer.mergeAll(AuthStub(user), DirectoriesStub) as Layer.Layer<never>);

const cookie = (value: string) => new Headers({ cookie: value });

afterEach(() => resetServerRuntime());

describe("getDoctorUser", () => {
	it("is null for anonymous requests", async () => {
		signedIn(null);
		expect(await getDoctorUser(cookie("ktb_doctor=7"))).toBeNull();
		await expect(ensureDoctorUser(new Headers())).rejects.toMatchObject({
			message: "unauthenticated",
			status: 401,
		});
	});

	it("acts as the only delegated doctor without a selector", async () => {
		signedIn();
		expect(await getDoctorUser(new Headers())).toEqual(asDoctor);
	});

	it("acts as the selected doctor when the directory confirms the delegation", async () => {
		signedIn();
		expect(await ensureDoctorUser(cookie("ktb_doctor=7"))).toEqual(asDoctor);
		expect(lookups).toEqual(["sec"]);
	});

	it("ignores a selector pointing at a profile the user does not hold", async () => {
		signedIn();
		expect(await getDoctorUser(cookie("ktb_doctor=99"))).toEqual(asDoctor);
	});

	it("is null — and 403 when required — for an account with no doctor profile", async () => {
		signedIn({ id: "nobody", email: "nobody@ktb.test", name: "Nobody" });
		expect(await getDoctorUser(cookie("ktb_doctor=7"))).toBeNull();
		await expect(ensureDoctorUser(cookie("ktb_doctor=7"))).rejects.toMatchObject({
			name: "NotADoctorError",
			message: "forbidden",
			status: 403,
		});
	});

	it("acts as the signed-in user when no directory is deployed", async () => {
		boot(AuthStub(sec) as Layer.Layer<never>);
		expect(await getDoctorUser(cookie("ktb_doctor=7"))).toEqual(self);
	});
});

describe("getDoctorAccess", () => {
	it("tells anonymous visitors, non-doctors and doctors apart", async () => {
		signedIn(null);
		expect(await getDoctorAccess(new Headers())).toBe("anonymous");
		signedIn({ id: "nobody", email: "nobody@ktb.test", name: "Nobody" });
		expect(await getDoctorAccess(new Headers())).toBe("no-doctor");
		signedIn();
		expect(await getDoctorAccess(new Headers())).toBe("doctor");
	});
});

describe("getDoctorContext", () => {
	it("is null for anonymous requests", async () => {
		signedIn(null);
		expect(await getDoctorContext(new Headers())).toBeNull();
	});

	it("lists the profiles and the active one without claiming invites", async () => {
		signedIn();
		expect(await getDoctorContext(new Headers())).toEqual({
			user: sec,
			profiles: [delegated],
			active: delegated,
		});
		expect(claims).toEqual([]);
	});

	it("claims invites first on entry points", async () => {
		signedIn();
		await getDoctorContext(new Headers(), { claimInvites: true });
		expect(claims).toEqual(["sec"]);
	});

	it("has no profiles when no directory is deployed", async () => {
		boot(AuthStub(sec) as Layer.Layer<never>);
		expect(await getDoctorContext(new Headers(), { claimInvites: true })).toEqual({
			user: sec,
			profiles: [],
			active: null,
		});
	});
});

describe("setDoctorSelection", () => {
	it("stores the chosen profile in a long-lived selector cookie", async () => {
		await setDoctorSelection(7);
		expect(cookies.set).toHaveBeenCalledWith("ktb_doctor", "7", {
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			secure: true,
			maxAge: 31536000,
		});
	});

	it("clears the selection", async () => {
		await setDoctorSelection(null);
		expect(cookies.delete).toHaveBeenCalledWith("ktb_doctor", { path: "/" });
	});
});
