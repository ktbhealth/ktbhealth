import { Effect } from "effect";

import { Consultations } from "@ktb/consultations";
import { createPluginApiRoute, getDoctorUser, getServerRuntime, runAs } from "@ktb/server-fns";

/**
 * POST /api/consultations/:id/audio — store the session recording in R2
 * and enqueue the async transcription job (P-015/P-016).
 *
 * Body: raw audio bytes (audio/webm | audio/ogg | audio/mp4 | …) or a
 * multipart form with an "audio" file. Owner-only; the consultation must
 * belong to the session user.
 *
 * GET /api/consultations/:id/audio — stream the stored audio back
 * (owner-only, private/no-store; never a public bucket URL).
 *
 * The route module lives in this package and is mounted into the host's
 * virtual route tree by `consultationsRoutesPlugin`
 * (physical("/api", "src/api-routes")); the session/runtime boundary is
 * @ktb/server-fns — the R2 bucket and queue arrive through the runtime
 * registry, so no host imports or env reads are needed (P-033).
 */

/**
 * Bound worker memory: the body is buffered fully before the R2 put.
 * Capped at the Whisper transcription ceiling (25MB — same as
 * MAX_AUDIO_BYTES in apps/web/src/lib/audio-jobs.ts) so nothing stored
 * here can end up untranscribable in the queue pipeline.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
	"audio/webm": "webm",
	"audio/ogg": "ogg",
	"audio/mp4": "m4a",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/flac": "flac",
};

const fetchOwned = (id: number, userId: string) =>
	runAs(
		{ id: userId },
		Effect.gen(function* () {
			const consultations = yield* Consultations;
			return yield* consultations
				.get(id, userId)
				.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
		}),
	);

export const Route = createPluginApiRoute("consultations.routes")("/api/consultations/$id/audio")({
	server: {
		handlers: {
			POST: async ({ request, params }) => {
				const user = await getDoctorUser();
				const id = Number.parseInt(params.id, 10);
				if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
				if (!Number.isFinite(id)) return Response.json({ error: "not found" }, { status: 404 });
				const { audio: audioBucket, audioQueue } = getServerRuntime();
				if (!audioBucket || !audioQueue) {
					return Response.json({ error: "audio storage not configured" }, { status: 503 });
				}

				const detail = await fetchOwned(id, user.id);
				if (!detail) return Response.json({ error: "not found" }, { status: 404 });

				// Raw body or multipart "audio" file — same acceptance as /api/transcribe.
				let bytes: ArrayBuffer;
				let contentType = request.headers.get("content-type") ?? "";
				const isMultipart = contentType.startsWith("multipart/form-data");
				if (isMultipart) {
					const form = await request.formData();
					const file = form.get("audio");
					if (!(file instanceof File)) {
						return Response.json({ error: "missing audio file" }, { status: 400 });
					}
					contentType = file.type || contentType;
					bytes = await file.arrayBuffer();
				} else {
					bytes = await request.arrayBuffer();
					if (bytes.byteLength === 0) {
						return Response.json({ error: "empty audio body" }, { status: 400 });
					}
				}
				if (bytes.byteLength > MAX_UPLOAD_BYTES) {
					return Response.json(
						{ error: "audio too large for transcription (max 25MB)" },
						{ status: 413 },
					);
				}
				const mediaType = contentType.split(";")[0]!.trim().toLowerCase();
				if (
					mediaType &&
					!mediaType.startsWith("audio/") &&
					mediaType !== "application/octet-stream"
				) {
					return Response.json({ error: "unsupported content type" }, { status: 415 });
				}

				const ext = EXT_BY_TYPE[mediaType] ?? "bin";
				const audioKey = `audio/${user.id}/${id}/${crypto.randomUUID()}.${ext}`;
				await audioBucket.put(audioKey, bytes, {
					httpMetadata: { contentType: mediaType || "application/octet-stream" },
				});

				// Link first (status "stored"), then enqueue; a queue failure
				// leaves the object stored but unprocessed — honest status.
				await runAs(
					{ id: user.id },
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						yield* consultations.attachAudio(user.id, {
							consultationId: id,
							audioKey,
							contentType: mediaType || undefined,
							size: bytes.byteLength,
						});
					}),
				);

				try {
					// tenantId travels on the message so the queue consumer
					// can re-bind tenant scope (P-053 phase D). The fetched
					// row's tenant_id is authoritative — it matches what
					// attachAudio stamped under the bound Tenant.
					await audioQueue.send({
						consultationId: id,
						audioKey,
						userId: user.id,
						tenantId: detail.tenantId,
					});
				} catch {
					return Response.json(
						{ error: "audio stored but transcription queue unavailable" },
						{ status: 502 },
					);
				}
				await runAs(
					{ id: user.id },
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						yield* consultations.updateAudioStatus(user.id, id, "queued");
					}),
				);

				return Response.json({
					ok: true,
					audioStatus: "queued",
					audioSize: bytes.byteLength,
				});
			},
			GET: async ({ params }) => {
				const user = await getDoctorUser();
				const id = Number.parseInt(params.id, 10);
				if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
				if (!Number.isFinite(id)) return Response.json({ error: "not found" }, { status: 404 });
				const { audio: audioBucket } = getServerRuntime();
				if (!audioBucket) {
					return Response.json({ error: "audio storage not configured" }, { status: 503 });
				}

				const detail = await fetchOwned(id, user.id);
				if (!detail?.audioKey) return Response.json({ error: "not found" }, { status: 404 });

				const object = await audioBucket.get(detail.audioKey);
				if (!object) return Response.json({ error: "not found" }, { status: 404 });

				return new Response(object.body, {
					headers: {
						"content-type":
							detail.audioContentType ??
							object.httpMetadata?.contentType ??
							"application/octet-stream",
						"content-length": String(object.size),
						"cache-control": "private, no-store",
						"content-disposition": `inline; filename="consultation-${id}-audio"`,
					},
				});
			},
		},
	},
});
