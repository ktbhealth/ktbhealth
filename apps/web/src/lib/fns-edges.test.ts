import { afterEach, describe, expect, it, vi } from "vitest";

// Edge paths of fns.ts that the signed-in integration tests (fns.test.ts)
// cannot reach through the real services: Forbidden mapping on the
// notification mutations, a patients.create that yields nothing, and the
// loose-input branches of the wire validators.
const hoisted = vi.hoisted(() => ({
	user: { id: "u1", email: "a@x.com", name: "A" } as {
		id: string;
		email: string;
		name: string;
	} | null,
	overrides: {} as { notifications?: unknown; patients?: unknown },
}));

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => new Headers(),
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
vi.mock("#/lib/auth.ts", () => ({
	getSessionUser: async () => hoisted.user,
	ensureSessionUser: async () => {
		if (!hoisted.user) throw new Error("unauthenticated");
		return hoisted.user;
	},
}));
// Plugin-owned fns (@ktb/patients/fns, @ktb/consultations/fns) reach the
// session and the app runtime through @ktb/server-fns, not #/lib/auth.ts —
// mirror the same hoisted user and service overrides on that boundary.
vi.mock("@ktb/server-fns", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@ktb/server-fns")>();
	const Effect = await import("effect/Effect");
	const { Notifications } = await import("@ktb/notifications");
	const { Patients } = await import("@ktb/patients");
	const withOverrides = (effect: any) => {
		let e = effect;
		if (hoisted.overrides.notifications) {
			e = e.pipe(Effect.provideService(Notifications, hoisted.overrides.notifications as never));
		}
		if (hoisted.overrides.patients) {
			e = e.pipe(Effect.provideService(Patients, hoisted.overrides.patients as never));
		}
		return e;
	};
	return {
		...actual,
		getSessionUser: async () => hoisted.user,
		ensureSessionUser: async () => {
			if (!hoisted.user) throw new Error("unauthenticated");
			return hoisted.user;
		},
		runAs: (user: never, effect: any) => actual.runAs(user, withOverrides(effect)),
	};
});
vi.mock("#/lib/platform.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("#/lib/platform.ts")>();
	const Effect = await import("effect/Effect");
	const { Notifications } = await import("@ktb/notifications");
	const { Patients } = await import("@ktb/patients");
	return {
		...actual,
		// Same principal binding as production, plus optional service fakes.
		runAs: (user: never, effect: any) => {
			let e = effect;
			if (hoisted.overrides.notifications) {
				e = e.pipe(Effect.provideService(Notifications, hoisted.overrides.notifications as never));
			}
			if (hoisted.overrides.patients) {
				e = e.pipe(Effect.provideService(Patients, hoisted.overrides.patients as never));
			}
			return actual.runAs(user, e);
		},
	};
});

import * as Effect from "effect/Effect";
import type { PanelPage } from "@ktb/kernel";
import { platformPages } from "./platform-pages.ts";
import {
	localeFn as patientsLocaleFn,
	sessionUserFn as patientsSessionUserFn,
} from "@ktb/patients/fns";
import {
	createPatientFn,
	extractAnamnesisFn,
	markAllMyNotificationsReadFn,
	markMyNotificationsReadFn,
	platformPageDataFn,
	updatePatientFn,
} from "./fns.ts";

afterEach(() => {
	hoisted.overrides = {};
	hoisted.user = { id: "u1", email: "a@x.com", name: "A" };
});

// Structurally a @ktb/authz Forbidden (catchTag matches on `_tag`); the
// package is not a dependency of apps/web.
const forbidden = (path: string) => ({ _tag: "Forbidden" as const, path });

describe("plugin session/locale fns", () => {
	it("patients sessionUserFn mirrors the bound session", async () => {
		expect(await patientsSessionUserFn()).toEqual(hoisted.user);
		hoisted.user = null;
		expect(await patientsSessionUserFn()).toBeNull();
	});

	it("patients localeFn returns the active locale", async () => {
		expect(typeof (await patientsLocaleFn())).toBe("string");
	});
});

describe("notification mutations map Forbidden to false", () => {
	it("markMyNotificationsReadFn", async () => {
		hoisted.overrides.notifications = {
			markRead: () => Effect.fail(forbidden("notifications.markRead")),
		};
		expect(await markMyNotificationsReadFn({ data: [1] })).toBe(false);
	});

	it("markAllMyNotificationsReadFn", async () => {
		hoisted.overrides.notifications = {
			markAllRead: () => Effect.fail(forbidden("notifications.markAllRead")),
		};
		expect(await markAllMyNotificationsReadFn()).toBe(false);
	});
});

describe("createPatientFn", () => {
	it("reports a generic failure when the service creates nothing", async () => {
		hoisted.overrides.patients = { create: () => Effect.succeed(null) };
		const res = await createPatientFn({ data: { name: "Ana", birthDate: "1984-03-05" } });
		expect(res).toEqual({ ok: false, errors: {} });
	});
});

describe("platformPageDataFn", () => {
	it("answers notfound for a path no plugin registered", async () => {
		expect(await platformPageDataFn({ data: "/platform/nope" })).toEqual({ status: "notfound" });
	});

	it("answers ok with null data for a page without a loader", async () => {
		const page = {
			id: "test.noloader",
			path: "/platform/test-noloader",
		} as unknown as PanelPage;
		const pages = platformPages as unknown as Map<string, PanelPage>;
		pages.set(page.path, page);
		try {
			expect(await platformPageDataFn({ data: page.path })).toEqual({ status: "ok", data: null });
		} finally {
			pages.delete(page.path);
		}
	});
});

describe("wire validators", () => {
	it("reject non-object input", async () => {
		await expect(extractAnamnesisFn({ data: "not-an-object" } as never)).rejects.toThrow();
		await expect(extractAnamnesisFn({ data: null } as never)).rejects.toThrow();
	});

	it("drop a non-finite numeric patientId instead of rejecting it", async () => {
		const out = await extractAnamnesisFn({
			data: { transcript: "Paciente com dor de cabeça há três dias.", patientId: Number.NaN },
		} as never);
		expect(out).toBeDefined();
	});

	it("updatePatientFn rejects a payload that is not an object", async () => {
		await expect(updatePatientFn({ data: null } as never)).rejects.toThrow();
	});
});
