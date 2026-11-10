// E2E coverage for the consultation audio path (P-015/P-016):
//
//   POST /api/consultations/:id/audio  → R2 put + queue send + audio_status
//   queue consumer (src/server.ts)     → Workers AI whisper → server_transcript
//   GET  /api/consultations/:id/audio  → owner-only stream from R2
//   POST /api/transcribe               → synchronous whisper (multipart)
//
// What runs in local dev (wrangler.dev.jsonc): R2 and the queue are bound
// and the workerd queue consumer DOES dispatch locally — an upload flips
// audio_status queued → processing/failed inside a couple of seconds.
// What does NOT run: the AI binding (no local simulator; wrangler.dev.jsonc
// intentionally omits it). resolveAi() (src/lib/ai.ts) only stands in when
// AI_STUB=1 or AI_BASE_URL is set, and the playwright webServer sets
// neither — so the pipeline's terminal state in dev is the honest
// degradation: audio_status="failed" / audio_error="audio pipeline not
// configured", and /api/transcribe answers 503. The success path
// (transcript → server_transcript → correctedTranscript) is only
// exercisable with AI_STUB=1 (documented in wrangler.dev.jsonc) or a real
// deployment — not asserted here.
//
// DB side-effects are read straight from the local D1 sqlite file
// (.wrangler/state/v3/d1/…) via node:sqlite — the same file the workerd
// dev server persists to. This spec therefore only runs against the
// local dev server (skipped when PLAYWRIGHT_BASE_URL points elsewhere).

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";

import { expect, test, type APIRequestContext } from "@playwright/test";

const PASSWORD = "senha-forte-123";
const ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/** Smallest payload that clears every route check (non-empty audio/*). */
const AUDIO_BYTES = Buffer.concat([
	Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt "),
	Buffer.alloc(2048, 0x61),
]);

function uniqueCredentials() {
	const email = `e2e-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`;
	return { email, name: email.split("@")[0] };
}

/**
 * Sign up through better-auth's REST endpoint (the same one the login UI
 * posts to) — much cheaper than driving the form, and the session cookie
 * lands in this request context for the follow-up calls. Requires the
 * local captcha stub (CAPTCHA_STUB=1 in wrangler.dev.jsonc).
 */
async function signUp(request: APIRequestContext) {
	const { email, name } = uniqueCredentials();
	// Parallel specs hit better-auth concurrently; a transient 5xx (local
	// D1 write contention) gets one retry before failing the test.
	let res = await request.post("/api/auth/sign-up/email", {
		headers: { origin: ORIGIN },
		data: { email, password: PASSWORD, name },
	});
	if (!res.ok()) {
		res = await request.post("/api/auth/sign-up/email", {
			headers: { origin: ORIGIN },
			data: { email, password: PASSWORD, name },
		});
	}
	expect(res.ok(), `sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();
	const body = (await res.json()) as { user: { id: string } };
	return body.user.id;
}

/** Locate the single local D1 sqlite file the workerd dev server uses. */
function localD1File(): string | null {
	const dir = fileURLToPath(
		new URL("../../.wrangler/state/v3/d1/miniflare-D1DatabaseObject", import.meta.url),
	);
	try {
		const file = readdirSync(dir).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
		return file ? path.join(dir, file) : null;
	} catch {
		return null;
	}
}

/**
 * Open the dev D1 file read/write from the test runner. Returns null when
 * node:sqlite is unavailable (Node < 22.5) or the state file is missing —
 * callers skip in that case.
 */
async function openLocalD1(): Promise<DatabaseSync | null> {
	const file = localD1File();
	if (!file) return null;
	try {
		const { DatabaseSync } = await import("node:sqlite");
		const db = new DatabaseSync(file, { timeout: 10_000 });
		// Parallel specs + the workerd dev server write to the same D1
		// file; wait out brief lock contention instead of failing.
		db.exec("PRAGMA busy_timeout = 10000");
		return db;
	} catch {
		return null;
	}
}

/** Insert a minimal consultation row (mirrors createConsultation's defaults). */
function insertConsultation(db: DatabaseSync, userId: string): number {
	const result = db
		.prepare(
			`INSERT INTO consultations (user_id, transcript, source, status, audio_status, created_at)
			 VALUES (?, 'e2e audio fixture', 'browser', 'done', 'none', ?)`,
		)
		.run(userId, Math.floor(Date.now() / 1000));
	return Number(result.lastInsertRowid);
}

interface AudioRow {
	audioKey: string | null;
	audioStatus: string;
	audioError: string | null;
	audioSize: number | null;
	serverTranscript: string | null;
}

function audioRow(db: DatabaseSync, id: number): AudioRow | undefined {
	return db
		.prepare(
			`SELECT audio_key AS audioKey, audio_status AS audioStatus, audio_error AS audioError,
			        audio_size AS audioSize, server_transcript AS serverTranscript
			 FROM consultations WHERE id = ?`,
		)
		.get(id) as AudioRow | undefined;
}

test.describe("consultation audio pipeline", () => {
	// Cold dev-server transforms + queue consumer latency — same budget as auth.spec.
	test.describe.configure({ timeout: 90_000 });
	// Deployed environments have real bindings (and real Turnstile) — the
	// local-only assertions (D1 sqlite, captcha stub) don't apply there.
	test.skip(
		!!process.env.PLAYWRIGHT_BASE_URL,
		"requires the local workerd dev server (D1/R2/queues + captcha stub)",
	);

	test("rejects unauthenticated audio endpoints", async ({ request }) => {
		const upload = await request.post("/api/consultations/1/audio", {
			headers: { "content-type": "audio/wav" },
			data: AUDIO_BYTES,
		});
		expect(upload.status()).toBe(401);
		expect(await upload.json()).toEqual({ error: "unauthorized" });

		const download = await request.get("/api/consultations/1/audio");
		expect(download.status()).toBe(401);

		const transcribe = await request.post("/api/transcribe", {
			multipart: {
				audio: { name: "a.wav", mimeType: "audio/wav", buffer: AUDIO_BYTES },
			},
		});
		expect(transcribe.status()).toBe(401);
	});

	test("upload stores audio in R2 and the queue consumer fails honestly without AI", async ({
		request,
	}) => {
		const userId = await signUp(request);
		const db = await openLocalD1();
		if (db === null) {
			test.skip(true, "local workerd D1 state not found");
			return;
		}
		const consultationId = insertConsultation(db, userId);

		// Raw-body upload (same acceptance as the browser recorder path).
		const res = await request.post(`/api/consultations/${consultationId}/audio`, {
			headers: { "content-type": "audio/wav" },
			data: AUDIO_BYTES,
		});
		expect(res.status()).toBe(200);
		expect(await res.json()).toEqual({
			ok: true,
			audioStatus: "queued",
			audioSize: AUDIO_BYTES.byteLength,
		});

		// Queue dispatch is observable only through its DB side-effect: the
		// consumer flips stored → queued → failed("audio pipeline not
		// configured") because wrangler.dev.jsonc binds no AI.
		await expect
			.poll(() => audioRow(db, consultationId)?.audioStatus, { timeout: 20_000 })
			.toBe("failed");
		const row = audioRow(db, consultationId);
		expect(row?.audioKey).toMatch(/^audio\//);
		expect(row?.audioError).toContain("audio pipeline not configured");
		expect(row?.serverTranscript).toBeNull();

		// The R2 object survives the failed job — owner can still stream it.
		const audio = await request.get(`/api/consultations/${consultationId}/audio`);
		expect(audio.status()).toBe(200);
		expect(audio.headers()["content-type"]).toBe("audio/wav");
		expect(audio.headers()["cache-control"]).toBe("private, no-store");
		expect(audio.headers()["content-disposition"]).toContain("inline");
		expect(await audio.body()).toEqual(AUDIO_BYTES);
	});

	test("accepts multipart audio upload", async ({ request }) => {
		const userId = await signUp(request);
		const db = await openLocalD1();
		if (db === null) {
			test.skip(true, "local workerd D1 state not found");
			return;
		}
		const consultationId = insertConsultation(db, userId);

		const res = await request.post(`/api/consultations/${consultationId}/audio`, {
			multipart: {
				audio: { name: "session.wav", mimeType: "audio/wav", buffer: AUDIO_BYTES },
			},
		});
		expect(res.status()).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, audioSize: AUDIO_BYTES.byteLength });
		// attachAudio wrote the R2 link before the queue send.
		expect(audioRow(db, consultationId)?.audioKey).toMatch(/\.wav$/);
	});

	test("rejects invalid audio uploads", async ({ request }) => {
		const userId = await signUp(request);
		const db = await openLocalD1();
		if (db === null) {
			test.skip(true, "local workerd D1 state not found");
			return;
		}
		const consultationId = insertConsultation(db, userId);
		// Owned by somebody else — the service fails Forbidden → 404.
		const foreignId = insertConsultation(db, "not-the-session-user");

		const wrongType = await request.post(`/api/consultations/${consultationId}/audio`, {
			headers: { "content-type": "text/plain" },
			data: AUDIO_BYTES,
		});
		expect(wrongType.status()).toBe(415);

		const empty = await request.post(`/api/consultations/${consultationId}/audio`, {
			headers: { "content-type": "audio/wav" },
			data: "",
		});
		expect(empty.status()).toBe(400);

		const missing = await request.post("/api/consultations/999999/audio", {
			headers: { "content-type": "audio/wav" },
			data: AUDIO_BYTES,
		});
		expect(missing.status()).toBe(404);

		const foreign = await request.post(`/api/consultations/${foreignId}/audio`, {
			headers: { "content-type": "audio/wav" },
			data: AUDIO_BYTES,
		});
		expect(foreign.status()).toBe(404);
		// Rejected before any storage/DB write.
		expect(audioRow(db, foreignId)?.audioKey).toBeNull();
	});

	test("transcribe endpoint validates input and reports missing AI honestly", async ({
		request,
	}) => {
		await signUp(request);

		const noFile = await request.post("/api/transcribe", {
			multipart: { note: "no audio field" },
		});
		expect(noFile.status()).toBe(400);

		// Input validation precedes the AI check; with no AI binding bound
		// in dev the endpoint must answer 503, not crash or fake a result.
		const res = await request.post("/api/transcribe", {
			multipart: {
				audio: { name: "a.wav", mimeType: "audio/wav", buffer: AUDIO_BYTES },
			},
		});
		expect(res.status()).toBe(503);
		expect(await res.json()).toEqual({ error: "transcription not configured" });
	});
});
