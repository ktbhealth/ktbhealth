import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { makeEventBus } from "@effect-server-utils/cqrs";
import { Auth } from "@ktb/auth";
import { Principal } from "@ktb/authz";
import {
	attachAudioRecord,
	ConsultationsLive,
	completeAudioJob,
	createConsultation,
	failAudioJob,
} from "@ktb/consultations";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { PatientsCommandsLive, PatientsQueriesLive } from "@ktb/patients";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import { resetServerRuntime, setServerRuntime, type AudioQueueSender } from "@ktb/server-fns";

import { retryAudioJobFn } from "./fns.ts";

// Same in-plugin harness as api-jobs.test.ts: the fn reaches the app
// runtime through @ktb/server-fns, so the test publishes its own
// ManagedRuntime — stub Auth over an in-memory D1 + the real
// ConsultationsLive. runAs binds the request Principal (userId +
// email) for the duration of the effect.
const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u-admin', 'Admin Ops', 'platform-admin@ktb.test', 0, NULL, 0, 0);
INSERT INTO "user" VALUES ('u-ops', 'Dra Ops', 'ops-user@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER, tenant_id INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL, tenant_id INTEGER);
`;

const USERS = new Map([
	["admin", { id: "u-admin", email: "platform-admin@ktb.test", name: "Admin Ops" }],
	["user", { id: "u-ops", email: "ops-user@x.com", name: "Dra Ops" }],
]);

const authStub = Auth.of({
	setUserBanned: async () => {},
	getSession: async (h: Headers) => {
		const key = /session=([^;]+)/.exec(h.get("cookie") ?? "")?.[1];
		const user = key ? USERS.get(key) : undefined;
		if (!user) return null;
		return {
			user,
			sessionId: `sess-${key}`,
			expiresAt: new Date(Date.now() + 3_600_000),
		};
	},
});

const db = makeDb(makeD1(DDL));

const infra = Layer.mergeAll(
	Layer.succeed(Db, db),
	Layer.succeed(Auth, authStub),
	Layer.succeed(
		PlatformAdmin,
		makePlatformAdminGate(parsePlatformAdminEmails("platform-admin@ktb.test")),
	),
	makeEventBus(),
);

const patientsHandlers = Layer.mergeAll(PatientsQueriesLive, PatientsCommandsLive).pipe(
	Layer.provide(infra),
);

const runtime = ManagedRuntime.make(
	Layer.mergeAll(
		infra,
		patientsHandlers,
		ConsultationsLive.pipe(Layer.provide(Layer.mergeAll(infra, patientsHandlers))),
	) as Layer.Layer<unknown, never, never>,
);

const sent: unknown[] = [];
let queueFails = false;
const audioQueue: AudioQueueSender = {
	send: (message) => {
		if (queueFails) return Promise.reject(new Error("queue down"));
		sent.push(message);
		return Promise.resolve({});
	},
};

beforeAll(() => {
	setServerRuntime({
		run: (effect) => runtime.runPromise(effect),
		runAs: (user, effect) =>
			runtime.runPromise(
				effect.pipe(Effect.provideService(Principal, { userId: user.id, email: user.email })),
			),
		getLocale: () => "en",
		audioTranscribeModel: "test-model",
		audioQueue,
	});
});

afterAll(async () => {
	resetServerRuntime();
	await runtime.dispose();
});

const useSession = (key: string | null) => {
	headers.current = key === null ? new Headers() : new Headers({ cookie: `session=${key}` });
};

const audioStatusOf = async (id: number) =>
	(
		await db.query.consultations.findFirst({
			where: (t, { eq }) => eq(t.id, id),
		})
	)?.audioStatus;

describe("retryAudioJobFn", () => {
	it("rejects anonymous callers", async () => {
		useSession(null);
		await expect(retryAudioJobFn({ data: { consultationId: 1 } })).rejects.toThrow(
			"unauthenticated",
		);
	});

	it("denies non-admin principals", async () => {
		useSession("user");
		const res = await retryAudioJobFn({ data: { consultationId: 1 } });
		expect(res).toEqual({ ok: false, reason: "not-found" });
	});

	it("reports not-found for a missing consultation and a row without audio", async () => {
		useSession("admin");
		expect(await retryAudioJobFn({ data: { consultationId: 424242 } })).toEqual({
			ok: false,
			reason: "not-found",
		});
		const noAudio = (await createConsultation(db, { userId: "u-ops", source: "browser" }))!;
		expect(await retryAudioJobFn({ data: { consultationId: noAudio } })).toEqual({
			ok: false,
			reason: "not-found",
		});
	});

	it("refuses non-retryable statuses", async () => {
		useSession("admin");
		const id = (await createConsultation(db, { userId: "u-ops", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "k-done", size: 1 });
		await completeAudioJob(db, id, "done transcript");
		expect(await retryAudioJobFn({ data: { consultationId: id } })).toEqual({
			ok: false,
			reason: "not-retryable",
		});
	});

	it("re-enqueues a failed job with tenant propagation and flips it to queued", async () => {
		useSession("admin");
		const id = (await createConsultation(db, { userId: "u-ops", source: "browser" }, 7))!;
		await attachAudioRecord(db, id, { audioKey: "k-retry", size: 10 });
		await failAudioJob(db, id, "transcription failed: boom");
		const before = sent.length;
		const res = await retryAudioJobFn({ data: { consultationId: id } });
		expect(res).toEqual({ ok: true });
		expect(sent.length).toBe(before + 1);
		expect(sent.at(-1)).toEqual({
			consultationId: id,
			audioKey: "k-retry",
			userId: "u-ops",
			tenantId: 7,
		});
		expect(await audioStatusOf(id)).toBe("queued");
	});

	it("re-enqueues a stored job (upload landed, enqueue previously failed)", async () => {
		useSession("admin");
		const id = (await createConsultation(db, { userId: "u-ops", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "k-stored", size: 5 });
		const res = await retryAudioJobFn({ data: { consultationId: id } });
		expect(res).toEqual({ ok: true });
		expect(sent.at(-1)).toMatchObject({ consultationId: id, audioKey: "k-stored" });
		expect(await audioStatusOf(id)).toBe("queued");
	});

	it("reports unavailable when the queue binding is missing", async () => {
		useSession("admin");
		const id = (await createConsultation(db, { userId: "u-ops", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "k-noqueue", size: 1 });
		await failAudioJob(db, id, "boom");
		// Swap the registry entry for a runtime without audioQueue.
		resetServerRuntime();
		setServerRuntime({
			run: (effect) => runtime.runPromise(effect),
			runAs: (user, effect) =>
				runtime.runPromise(
					effect.pipe(Effect.provideService(Principal, { userId: user.id, email: user.email })),
				),
			getLocale: () => "en",
			audioTranscribeModel: "test-model",
		});
		try {
			expect(await retryAudioJobFn({ data: { consultationId: id } })).toEqual({
				ok: false,
				reason: "unavailable",
			});
			expect(await audioStatusOf(id)).toBe("failed");
		} finally {
			setServerRuntime({
				run: (effect) => runtime.runPromise(effect),
				runAs: (user, effect) =>
					runtime.runPromise(
						effect.pipe(Effect.provideService(Principal, { userId: user.id, email: user.email })),
					),
				getLocale: () => "en",
				audioTranscribeModel: "test-model",
				audioQueue,
			});
		}
	});

	it("reports enqueue-failed and keeps the failed status when send() rejects", async () => {
		useSession("admin");
		const id = (await createConsultation(db, { userId: "u-ops", source: "browser" }))!;
		await attachAudioRecord(db, id, { audioKey: "k-queuefail", size: 1 });
		await failAudioJob(db, id, "boom");
		queueFails = true;
		try {
			expect(await retryAudioJobFn({ data: { consultationId: id } })).toEqual({
				ok: false,
				reason: "enqueue-failed",
			});
			expect(await audioStatusOf(id)).toBe("failed");
		} finally {
			queueFails = false;
		}
	});
});
