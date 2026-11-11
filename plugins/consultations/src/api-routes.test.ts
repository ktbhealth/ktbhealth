import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const headers = { current: new Headers() };

vi.mock("@tanstack/react-start/server", () => ({
	getRequestHeaders: () => headers.current,
}));

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { makeEventBus } from "@effect-server-utils/cqrs";
import { Auth } from "@ktb/auth";
import { Principal } from "@ktb/authz";
import { Db, makeDb } from "@ktb/db";
import { makeD1 } from "@ktb/db/testing";
import { fhirR4Exporter } from "@ktb/interop-fhir";
import { openEhrExporter } from "@ktb/interop-openehr";
import { makePlatformAdminGate, parsePlatformAdminEmails, PlatformAdmin } from "@ktb/platform";
import {
	PatientsCommandsLive,
	PatientsLive,
	PatientsQueriesLive,
	createPatient,
} from "@ktb/patients";
import { validatePatient } from "@ktb/patients/record";
import { setServerRuntime, type AudioJobMessage } from "@ktb/server-fns";

import { consultations as consultationsTable } from "./schema.ts";
import { ConsultationsLive, createConsultation } from "./index.ts";
import { Route as AudioRoute } from "./api-routes/consultations.$id.audio.ts";
import { Route as PdfRoute } from "./api-routes/consultations.$id.pdf.ts";
import { Route as ExportRoute } from "./api-routes/patients.$id.export.ts";
import { Route as TranscribeRoute } from "./api-routes/transcribe.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

// In-plugin harness (P-033): the routes reach the app runtime through
// @ktb/server-fns, so the test publishes its own ManagedRuntime — a stub
// Auth port (cookie → session) over an in-memory D1 + the real
// PatientsLive/ConsultationsLive. runAs mirrors @ktb/app-host: it binds
// the request Principal for the duration of the effect.
const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u-owner', 'Dra Export', 'export@x.com', 0, NULL, 0, 0);
INSERT INTO "user" VALUES ('u-other', 'Dra Other', 'other@x.com', 0, NULL, 0, 0);
INSERT INTO "user" VALUES ('u-plain', 'Plain Doc', 'plain@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER, tenant_id INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL, tenant_id INTEGER);
`;

/** "user" table name column is NOT NULL — unnamed practitioners are
 * modelled by a null SessionUser.name instead (see USERS below). */
const USERS = new Map([
	["owner", { id: "u-owner", email: "export@x.com", name: "Dra Export" }],
	["other", { id: "u-other", email: "other@x.com", name: "Dra Other" }],
	// "plain" has name: null on the session — the practitioner falls back
	// to email in exports (the user row itself keeps a display name).
	["plain", { id: "u-plain", email: "plain@x.com", name: null }],
]);

/** Cookie "session=<key>" authenticates as USERS[key]; anything else is anonymous. */
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
	Layer.succeed(PlatformAdmin, makePlatformAdminGate(parsePlatformAdminEmails("admin@x.com"))),
	makeEventBus(),
);

// ConsultationsLive dispatches `patients.ownerOf` / `patients.delete` and
// PatientsLive needs PlatformAdmin — same wiring as the app composition.
const patientsHandlers = Layer.mergeAll(PatientsQueriesLive, PatientsCommandsLive).pipe(
	Layer.provide(infra),
);
const services = Layer.mergeAll(
	infra,
	patientsHandlers,
	PatientsLive.pipe(Layer.provide(infra)),
	ConsultationsLive.pipe(Layer.provide(Layer.mergeAll(infra, patientsHandlers))),
);

// Host-published capabilities the routes reach through the registry:
// in-memory R2/Queue/AI doubles (same shapes as apps/web test env) plus
// the real interop exporters the host wires in platform.ts.
const audioBucketStore = new Map<string, { data: Uint8Array; contentType?: string }>();
const audioQueueSent: AudioJobMessage[] = [];

const fakeBucket = {
	put: async (
		key: string,
		value: ArrayBuffer | Uint8Array | ReadableStream,
		options?: { httpMetadata?: { contentType?: string } },
	) => {
		const data =
			value instanceof Uint8Array
				? value
				: value instanceof ArrayBuffer
					? new Uint8Array(value)
					: new Uint8Array(await new Response(value).arrayBuffer());
		audioBucketStore.set(key, { data, contentType: options?.httpMetadata?.contentType });
		return {};
	},
	get: async (key: string) => {
		const object = audioBucketStore.get(key);
		if (!object) return null;
		const { data, contentType } = object;
		const bytes = data.slice();
		return {
			key,
			size: bytes.byteLength,
			httpMetadata: { contentType },
			body: new Response(bytes).body!,
		};
	},
	delete: async (keys: string | string[]) => {
		for (const key of Array.isArray(keys) ? keys : [keys]) audioBucketStore.delete(key);
	},
};

const runtime = ManagedRuntime.make(services as Layer.Layer<unknown, never, never>);

beforeAll(() => {
	setServerRuntime({
		run: (effect) => runtime.runPromise(effect),
		runAs: (user, effect) =>
			runtime.runPromise(
				effect.pipe(Effect.provideService(Principal, { userId: user.id, email: user.email })),
			),
		audio: fakeBucket,
		audioQueue: {
			send: async (message: AudioJobMessage) => {
				audioQueueSent.push(message);
			},
		},
		ai: {
			run: async () => ({ text: "transcrição do servidor" }),
		},
		recordExporters: { "fhir-r4": fhirR4Exporter, openehr: openEhrExporter },
		getLocale: () => "en",
		audioTranscribeModel: "test-model",
	});
});

const useSession = (key: string) => {
	headers.current = new Headers({ cookie: `session=${key}` });
};

const sec = (content: string) => ({ content, confidence: "alta", evidence: [] });

describe("GET /api/transcribe", () => {
	const post = (body: BodyInit) =>
		handlersOf(TranscribeRoute).POST!({
			request: new Request("http://x/api/transcribe", { method: "POST", body }),
		} as never);

	it("rejects unauthenticated requests and missing audio", async () => {
		const saved = headers.current;
		headers.current = new Headers();
		try {
			const form = new FormData();
			form.set("audio", new File([new Uint8Array([1, 2, 3])], "a.wav"));
			expect((await post(form)).status).toBe(401);
		} finally {
			headers.current = saved;
		}

		useSession("owner");
		const empty = await post(new FormData());
		expect(empty.status).toBe(400);
	});

	it("returns the transcription text", async () => {
		useSession("owner");
		const form = new FormData();
		form.set("audio", new File([new Uint8Array([1, 2, 3])], "a.wav"));
		const res = await post(form);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ text: "transcrição do servidor" });
	});
});

describe("GET /api/consultations/:id/pdf", () => {
	const get = (id: string) => handlersOf(PdfRoute).GET!({ params: { id } } as never);

	it("rejects bad ids, anonymous callers and foreign consultations", async () => {
		useSession("owner");
		expect((await get("99999")).status).toBe(404);
		expect((await get("abc")).status).toBe(404);

		const saved = headers.current;
		headers.current = new Headers();
		expect((await get("1")).status).toBe(404);
		headers.current = saved;

		// Another user's consultation → service Forbidden → 404.
		const foreign = (await createConsultation(db, { userId: "u-owner", source: "mic" }))!;
		useSession("other");
		expect((await get(String(foreign))).status).toBe(404);
		useSession("owner");
		// Owner but no anamnesis yet → 409.
		expect((await get(String(foreign))).status).toBe(409);
	});

	it("serves the owner PDF and 409s without anamnesis", async () => {
		useSession("owner");
		const id = (await createConsultation(db, { userId: "u-owner", source: "mic" }))!;
		const noAnamnesis = await get(String(id));
		expect(noAnamnesis.status).toBe(409);

		const anamnesisSec = { content: "x", confidence: "alta", evidence: [] };
		await db
			.update(consultationsTable)
			.set({
				anamnesis: JSON.stringify({
					queixa_principal: anamnesisSec,
					hda: anamnesisSec,
					antecedentes: anamnesisSec,
					alergias: anamnesisSec,
					medicamentos_em_uso: anamnesisSec,
					exame_fisico: anamnesisSec,
					hipoteses: anamnesisSec,
					conduta: anamnesisSec,
				}),
			})
			.where(eq(consultationsTable.id, id));
		const pdf = await get(String(id));
		expect(pdf.status).toBe(200);
		expect(pdf.headers.get("content-type")).toBe("application/pdf");
		expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(100);
	});
});

describe("POST/GET /api/consultations/:id/audio", () => {
	const post = (id: number | string, body: BodyInit, contentType?: string) =>
		handlersOf(AudioRoute).POST!({
			request: new Request(`http://x/api/consultations/${id}/audio`, {
				method: "POST",
				headers: contentType ? { "content-type": contentType } : {},
				body,
			}),
			params: { id: String(id) },
		} as never);
	const get = (id: number | string) =>
		handlersOf(AudioRoute).GET!({ params: { id: String(id) } } as never);

	it("rejects unauthenticated upload and download", async () => {
		useSession("owner");
		const saved = headers.current;
		headers.current = new Headers();
		try {
			const up = await post(1, new Uint8Array([1]), "audio/webm");
			expect(up.status).toBe(401);
			expect((await get(1)).status).toBe(401);
		} finally {
			headers.current = saved;
		}
	});

	it("uploads raw audio to R2, links the row and enqueues the job", async () => {
		useSession("owner");
		const id = (await createConsultation(db, { userId: "u-owner", source: "browser" }))!;
		const bytes = new Uint8Array([9, 8, 7, 6]);
		const res = await post(id, bytes, "audio/webm");
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, audioStatus: "queued", audioSize: 4 });

		const rows = await db.select().from(consultationsTable).where(eq(consultationsTable.id, id));
		const row = rows[0]!;
		expect(row.audioStatus).toBe("queued");
		expect(row.audioKey).toMatch(new RegExp(`^audio/u-owner/${id}/.*\\.webm$`));
		expect(row.audioContentType).toBe("audio/webm");
		expect(row.audioSize).toBe(4);
		expect(audioBucketStore.has(row.audioKey!)).toBe(true);
		expect(audioQueueSent.at(-1)).toMatchObject({
			consultationId: id,
			audioKey: row.audioKey,
			userId: "u-owner",
			// Personal-scope row → explicit null tenant on the message.
			tenantId: null,
		});
	});

	it("accepts multipart audio file uploads", async () => {
		useSession("owner");
		const id = (await createConsultation(db, { userId: "u-owner", source: "browser" }))!;
		const form = new FormData();
		form.set("audio", new File([new Uint8Array([1, 2])], "rec.ogg", { type: "audio/ogg" }));
		const res = await handlersOf(AudioRoute).POST!({
			request: new Request(`http://x/api/consultations/${id}/audio`, {
				method: "POST",
				body: form,
			}),
			params: { id: String(id) },
		} as never);
		expect(res.status).toBe(200);
	});

	it("rejects bad ids, empty bodies and foreign consultations", async () => {
		useSession("owner");
		expect((await post("abc", new Uint8Array([1]), "audio/webm")).status).toBe(404);

		const id = (await createConsultation(db, { userId: "u-owner", source: "browser" }))!;
		expect((await post(id, new Uint8Array(0), "audio/webm")).status).toBe(400);

		const foreign = (await createConsultation(db, {
			userId: "u-other",
			source: "browser",
		}))!;
		expect((await post(foreign, new Uint8Array([1]), "audio/webm")).status).toBe(404);
	});

	it("streams stored audio back to the owner only", async () => {
		useSession("owner");
		const id = (await createConsultation(db, { userId: "u-owner", source: "browser" }))!;
		const bytes = new Uint8Array([5, 4, 3, 2, 1]);
		await post(id, bytes, "audio/webm");

		const res = await get(id);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("audio/webm");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);

		const foreign = (await createConsultation(db, {
			userId: "u-other",
			source: "browser",
		}))!;
		expect((await get(foreign)).status).toBe(404);

		const noAudio = (await createConsultation(db, { userId: "u-owner", source: "browser" }))!;
		expect((await get(noAudio)).status).toBe(404);
	});
});

describe("GET /api/patients/:id/export", () => {
	let patientId = 0;

	const call = (id: string, format: string | null) =>
		handlersOf(ExportRoute).GET!({
			params: { id },
			request: new Request(
				`http://localhost:3000/api/patients/${id}/export${format ? `?format=${format}` : ""}`,
			),
		} as never);

	beforeAll(async () => {
		useSession("owner");
		const fields = validatePatient({ name: "Ana Souza", birthDate: "1984", gender: "female" });
		if (!fields.ok) throw new Error("fixture");
		patientId = (await createPatient(db, "u-owner", fields.fields))!.id;
		// Two consultations, inserted newest-first: the export orders them oldest-first.
		for (const [at, complaint] of [
			["2026-11-06T10:00:00Z", "Retorno"],
			["2026-11-05T10:00:00Z", "Cefaleia"],
		] as const) {
			const id = await createConsultation(db, { userId: "u-owner", source: "browser" });
			await db
				.update(consultationsTable)
				.set({
					patientId,
					createdAt: new Date(at),
					transcript: `Transcrição: ${complaint}`,
					engine: "heuristic",
					anamnesis: JSON.stringify({
						queixa_principal: sec(complaint),
						hda: sec("x"),
						antecedentes: sec(""),
						alergias: sec(""),
						medicamentos_em_uso: sec(""),
						exame_fisico: sec(""),
						hipoteses: sec(""),
						conduta: sec(""),
					}),
				})
				.where(eq(consultationsTable.id, id!));
		}
	});

	it("rejects a missing or unknown format", async () => {
		useSession("owner");
		expect((await call(String(patientId), null)).status).toBe(400);
		expect((await call(String(patientId), "hl7v2")).status).toBe(400);
	});

	it("answers 404 for anonymous callers, bad ids, missing and foreign patients", async () => {
		const saved = headers.current;
		headers.current = new Headers();
		expect((await call(String(patientId), "fhir-r4")).status).toBe(404);
		headers.current = saved;

		useSession("owner");
		expect((await call("abc", "fhir-r4")).status).toBe(404);
		expect((await call("99999", "fhir-r4")).status).toBe(404);

		useSession("other");
		expect((await call(String(patientId), "openehr")).status).toBe(404);
		useSession("owner");
	});

	it("downloads the record as a FHIR R4 Bundle", async () => {
		useSession("owner");
		const res = await call(String(patientId), "fhir-r4");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/fhir+json; charset=utf-8");
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="patient-${patientId}.fhir-r4.json"`,
		);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const bundle: any = await res.json();
		expect(bundle.resourceType).toBe("Bundle");
		const types = bundle.entry.map((e: any) => e.resource.resourceType);
		expect(types.filter((t: string) => t === "Composition")).toHaveLength(2);
		const complaints = bundle.entry
			.filter((e: any) => e.resource.resourceType === "Composition")
			.map((e: any) => e.resource.section[0].text.div);
		expect(complaints[0]).toContain("Cefaleia");
		expect(complaints[1]).toContain("Retorno");
		const practitioner = bundle.entry.find((e: any) => e.resource.resourceType === "Practitioner");
		expect(practitioner.resource.name).toEqual([{ text: "Dra Export" }]);
	});

	it("names an unnamed practitioner by email", async () => {
		useSession("plain");
		const fields = validatePatient({ name: "Sem Nome", birthDate: "1990" });
		if (!fields.ok) throw new Error("fixture");
		const pid = (await createPatient(db, "u-plain", fields.fields))!.id;
		const res = await call(String(pid), "fhir-r4");
		expect(res.status).toBe(200);
		const bundle: any = await res.json();
		const practitioner = bundle.entry.find((e: any) => e.resource.resourceType === "Practitioner");
		expect(practitioner.resource.name).toEqual([{ text: "plain@x.com" }]);
		useSession("owner");
	});

	it("downloads the record as an openEHR EXTRACT", async () => {
		useSession("owner");
		const res = await call(String(patientId), "openehr");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
		expect(res.headers.get("content-disposition")).toBe(
			`attachment; filename="patient-${patientId}.openehr.json"`,
		);
		const extract: any = await res.json();
		expect(extract._type).toBe("EXTRACT");
		const kinds = extract.chapters[0].items.map((i: any) => i.item._type);
		expect(kinds).toEqual([
			"X_VERSIONED_PARTY",
			"X_VERSIONED_EHR_STATUS",
			"X_VERSIONED_COMPOSITION",
			"X_VERSIONED_COMPOSITION",
		]);
	});
});
