import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const headers = { current: new Headers() };
const flags = { noBucket: false, noQueue: false };
const ai = vi.hoisted(() => ({
	current: undefined as { run: (m: string, i: unknown) => Promise<unknown> } | undefined,
}));

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
import { Route as TranscribeRoute } from "./api-routes/transcribe.ts";

const handlersOf = (r: unknown) =>
	(r as { options: { server: { handlers: Record<string, (a: never) => Promise<Response>> } } })
		.options.server.handlers;

// In-plugin harness (P-033) — same shape as api-routes.test.ts: stub Auth
// port (cookie → session) over an in-memory D1 + the real
// PatientsLive/ConsultationsLive. The edge suites additionally toggle the
// host-published capabilities (audio bucket/queue/AI) through getters on
// the registered runtime, mirroring the old platform-module mocks.
const DDL = `
CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, email_verified INTEGER NOT NULL, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO "user" VALUES ('u-owner', 'Dra Export', 'export@x.com', 0, NULL, 0, 0);
INSERT INTO "user" VALUES ('u-other', 'Dra Other', 'other@x.com', 0, NULL, 0, 0);
CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL REFERENCES "user"(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, social_name TEXT, gender TEXT, birth_date TEXT, cpf TEXT, cns TEXT, passport TEXT, phone TEXT, email TEXT, preferred_language TEXT, address_line TEXT, address_number TEXT, address_complement TEXT, district TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT, mother_name TEXT, marital_status TEXT, race_color TEXT, nationality TEXT, emergency_contact_name TEXT, emergency_contact_relationship TEXT, emergency_contact_phone TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE consultations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES "user"(id), patient_id INTEGER REFERENCES patients(id), transcript TEXT NOT NULL, anamnesis TEXT, review TEXT, engine TEXT, source TEXT NOT NULL, status TEXT NOT NULL, bot_id TEXT, consent_at INTEGER, audio_key TEXT, audio_status TEXT NOT NULL DEFAULT 'none', audio_content_type TEXT, audio_size INTEGER, audio_error TEXT, server_transcript TEXT, corrected_transcript TEXT, enhancement_engine TEXT, created_at INTEGER NOT NULL);
`;

const USERS = new Map([
	["owner", { id: "u-owner", email: "export@x.com", name: "Dra Export" }],
	["other", { id: "u-other", email: "other@x.com", name: "Dra Other" }],
]);

/** Cookie "session=<key>" authenticates as USERS[key]; anything else is anonymous. */
const authStub = Auth.of({
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
// in-memory R2/Queue/AI doubles. Getters let a test hide a binding
// (503 paths) or swap the AI answer — same role the platform-module
// getters played in the host-side edge tests.
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

const audioQueue = {
	send: async (message: AudioJobMessage) => {
		audioQueueSent.push(message);
	},
};

const runtime = ManagedRuntime.make(services as Layer.Layer<unknown, never, never>);

const useSession = (key: string) => {
	headers.current = new Headers({ cookie: `session=${key}` });
};

beforeAll(() => {
	setServerRuntime({
		run: (effect) => runtime.runPromise(effect),
		runAs: (user, effect) =>
			runtime.runPromise(
				effect.pipe(Effect.provideService(Principal, { userId: user.id, email: user.email })),
			),
		get audio() {
			return flags.noBucket ? undefined : fakeBucket;
		},
		get audioQueue() {
			return flags.noQueue ? undefined : audioQueue;
		},
		get ai() {
			return ai.current;
		},
		getLocale: () => "en",
	});
	useSession("owner");
});

afterEach(() => {
	flags.noBucket = false;
	flags.noQueue = false;
	ai.current = undefined;
	vi.restoreAllMocks();
});

// ---------- /api/transcribe edge cases ----------

const transcribePost = () => {
	const form = new FormData();
	form.set("audio", new File([new Uint8Array([1, 2, 3])], "rec.webm", { type: "audio/webm" }));
	return handlersOf(TranscribeRoute).POST!({
		request: new Request("http://x/api/transcribe", { method: "POST", body: form }),
	} as never);
};

describe("/api/transcribe edge cases", () => {
	it("answers 503 when Workers AI is not bound", async () => {
		const res = await transcribePost();
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "transcription not configured" });
	});

	it("returns an empty text when the model answers without one", async () => {
		ai.current = {
			run: vi.fn<(model: string, inputs: unknown) => Promise<unknown>>(async () => ({})),
		};
		const res = await transcribePost();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ text: "" });
		// Base64 payload to the large-v3-turbo model — same shape the
		// queued pipeline uses (a number[] would serialize huge).
		expect(ai.current.run).toHaveBeenCalledWith("@cf/openai/whisper-large-v3-turbo", {
			audio: "AQID",
			language: "pt",
		});
	});

	it("returns the model's text", async () => {
		ai.current = { run: async () => ({ text: "olá mundo" }) };
		const res = await transcribePost();
		expect(await res.json()).toEqual({ text: "olá mundo" });
	});

	it("rejects an empty audio file", async () => {
		const form = new FormData();
		form.set("audio", new File([], "empty.webm", { type: "audio/webm" }));
		const res = await handlersOf(TranscribeRoute).POST!({
			request: new Request("http://x/api/transcribe", { method: "POST", body: form }),
		} as never);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "empty audio file" });
	});

	it("rejects uploads over the transcription ceiling", async () => {
		const form = new FormData();
		form.set(
			"audio",
			new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.webm", { type: "audio/webm" }),
		);
		const res = await handlersOf(TranscribeRoute).POST!({
			request: new Request("http://x/api/transcribe", { method: "POST", body: form }),
		} as never);
		expect(res.status).toBe(413);
		expect(await res.json()).toEqual({
			error: "audio too large for transcription (max 25MB)",
		});
	});

	it("rejects non-audio content types", async () => {
		const form = new FormData();
		form.set("audio", new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" }));
		const res = await handlersOf(TranscribeRoute).POST!({
			request: new Request("http://x/api/transcribe", { method: "POST", body: form }),
		} as never);
		expect(res.status).toBe(415);
		expect(await res.json()).toEqual({ error: "unsupported content type" });
	});
});

// ---------- /api/consultations/:id/pdf edge cases ----------

const sec = { content: "x", confidence: "alta", evidence: [] };
const ANAMNESIS = JSON.stringify({
	queixa_principal: sec,
	hda: sec,
	antecedentes: sec,
	alergias: sec,
	medicamentos_em_uso: sec,
	exame_fisico: sec,
	hipoteses: sec,
	conduta: sec,
});

const patientFor = async (owner: string) => {
	const fields = validatePatient({ name: "Ana Souza", birthDate: "1984", gender: "female" });
	if (!fields.ok) throw new Error("fixture");
	return (await createPatient(db, owner, fields.fields))!.id;
};

const consultationWith = async (patientId: number | null) => {
	const id = (await createConsultation(db, { userId: "u-owner", source: "mic" }))!;
	await db
		.update(consultationsTable)
		.set({ anamnesis: ANAMNESIS, patientId })
		.where(eq(consultationsTable.id, id));
	return id;
};

describe("anamnesis pdf with a linked patient", () => {
	const call = (id: number) => handlersOf(PdfRoute).GET!({ params: { id: String(id) } } as never);

	it("renders the PDF with the patient's summary when the patient is the owner's", async () => {
		const res = await call(await consultationWith(await patientFor("u-owner")));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
		expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
	});

	it("still renders (without patient details) when the linked patient belongs to someone else", async () => {
		const res = await call(await consultationWith(await patientFor("u-other")));
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/pdf");
	});

	it("renders for a consultation with no linked patient", async () => {
		const res = await call(await consultationWith(null));
		expect(res.status).toBe(200);
	});
});

// ---------- /api/consultations/:id/audio edge cases ----------

const newConsultation = async () =>
	(await createConsultation(db, { userId: "u-owner", source: "browser" }))!;

const audioPost = (id: number | string, body: BodyInit, contentType?: string) =>
	handlersOf(AudioRoute).POST!({
		request: new Request(`http://x/api/consultations/${id}/audio`, {
			method: "POST",
			headers: contentType ? { "content-type": contentType } : {},
			body,
		}),
		params: { id: String(id) },
	} as never);

const audioGet = (id: number | string) =>
	handlersOf(AudioRoute).GET!({ params: { id: String(id) } } as never);

const rowOf = async (id: number) =>
	(await db.select().from(consultationsTable).where(eq(consultationsTable.id, id)))[0]!;

describe("audio upload edge cases", () => {
	it("answers 503 when the bucket or the queue is not configured", async () => {
		const id = await newConsultation();
		flags.noBucket = true;
		expect((await audioPost(id, new Uint8Array([1]), "audio/webm")).status).toBe(503);
		flags.noBucket = false;
		flags.noQueue = true;
		const res = await audioPost(id, new Uint8Array([1]), "audio/webm");
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "audio storage not configured" });
	});

	it("rejects a multipart form without an audio file", async () => {
		const id = await newConsultation();
		const form = new FormData();
		form.set("audio", "not-a-file");
		const res = await audioPost(id, form);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "missing audio file" });
	});

	it("rejects a multipart file without a media type (falls back to the form content type)", async () => {
		const id = await newConsultation();
		// Some runtimes hand back a File with an empty type; make that explicit.
		const form = new FormData();
		form.set("audio", new File([new Uint8Array([1, 2])], "rec", { type: "" }));
		const request = new Request(`http://x/api/consultations/${id}/audio`, {
			method: "POST",
			headers: { "content-type": "multipart/form-data; boundary=b" },
		});
		request.formData = async () => form;
		const res = await handlersOf(AudioRoute).POST!({
			request,
			params: { id: String(id) },
		} as never);
		expect(res.status).toBe(415);
	});

	it("rejects non-audio content types", async () => {
		const id = await newConsultation();
		const res = await audioPost(id, "hello", "text/plain");
		expect(res.status).toBe(415);
		expect(await res.json()).toEqual({ error: "unsupported content type" });
	});

	it("rejects uploads over the transcription ceiling", async () => {
		const id = await newConsultation();
		const res = await audioPost(id, new Uint8Array(25 * 1024 * 1024 + 1), "audio/webm");
		expect(res.status).toBe(413);
		expect(await res.json()).toEqual({
			error: "audio too large for transcription (max 25MB)",
		});
	});

	it("stores a body without a content type as an opaque .bin object", async () => {
		const id = await newConsultation();
		const res = await audioPost(id, new Uint8Array([1, 2, 3]));
		expect(res.status).toBe(200);
		const row = await rowOf(id);
		expect(row.audioKey).toMatch(/\.bin$/);
		expect(row.audioContentType).toBeNull();
		expect(audioBucketStore.get(row.audioKey!)?.contentType).toBe("application/octet-stream");
	});

	it("accepts application/octet-stream and unknown audio types", async () => {
		const a = await newConsultation();
		expect((await audioPost(a, new Uint8Array([1]), "application/octet-stream")).status).toBe(200);
		const b = await newConsultation();
		expect((await audioPost(b, new Uint8Array([1]), "audio/aac")).status).toBe(200);
		expect((await rowOf(b)).audioKey).toMatch(/\.bin$/);
	});

	it("reports 502 when the audio is stored but the queue is down", async () => {
		const id = await newConsultation();
		vi.spyOn(audioQueue, "send").mockRejectedValueOnce(new Error("queue down"));
		const res = await audioPost(id, new Uint8Array([1]), "audio/webm");
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			error: "audio stored but transcription queue unavailable",
		});
		expect((await rowOf(id)).audioStatus).toBe("stored");
	});
});

describe("audio download edge cases", () => {
	const withAudio = async (stored?: { contentType?: string }, rowType: string | null = null) => {
		const id = await newConsultation();
		const audioKey = `audio/u-owner/${id}/fixture.bin`;
		if (stored) audioBucketStore.set(audioKey, { data: new Uint8Array([7, 7]), ...stored });
		await db
			.update(consultationsTable)
			.set({ audioKey, audioContentType: rowType })
			.where(eq(consultationsTable.id, id));
		return id;
	};

	it("answers 503 when the bucket is not configured", async () => {
		const id = await newConsultation();
		flags.noBucket = true;
		expect((await audioGet(id)).status).toBe(503);
	});

	it("answers 404 for a non-numeric id", async () => {
		expect((await audioGet("abc")).status).toBe(404);
	});

	it("answers 404 when the row points at a missing object", async () => {
		const id = await withAudio(undefined);
		expect((await audioGet(id)).status).toBe(404);
	});

	it("falls back to the stored object's content type, then to octet-stream", async () => {
		const typed = await withAudio({ contentType: "audio/ogg" });
		expect((await audioGet(typed)).headers.get("content-type")).toBe("audio/ogg");
		const untyped = await withAudio({});
		expect((await audioGet(untyped)).headers.get("content-type")).toBe("application/octet-stream");
	});

	it("prefers the content type recorded on the row", async () => {
		const id = await withAudio({ contentType: "audio/ogg" }, "audio/mp4");
		expect((await audioGet(id)).headers.get("content-type")).toBe("audio/mp4");
	});
});
