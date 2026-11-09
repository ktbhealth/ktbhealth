import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { Consultations } from "@ktb/consultations";
import { isExportFormat } from "@ktb/interop";
import { Patients } from "@ktb/patients";
import { getSessionUser, getServerRuntime, runAs } from "@ktb/server-fns";

/**
 * GET /api/patients/:id/export?format=fhir-r4|openehr — owner-only
 * download of the patient's record and consultations in an
 * interoperability standard (@ktb/interop adapters).
 *
 * The route module lives in this package and is mounted into the host's
 * virtual route tree by `consultationsRoutesPlugin`
 * (physical("/api", "src/api-routes")); it lives here rather than in the
 * patients plugin because it reads the Consultations service (patients
 * cannot depend on consultations — that would be a package cycle). The
 * standard-specific exporters stay host-side behind the @ktb/server-fns
 * runtime registry (P-033).
 */
export const Route = createFileRoute("/api/patients/$id/export")({
	server: {
		handlers: {
			GET: async ({ params, request }) => {
				const format = new URL(request.url).searchParams.get("format");
				if (!isExportFormat(format))
					return Response.json({ error: "format must be fhir-r4 or openehr" }, { status: 400 });

				const user = await getSessionUser();
				const id = Number.parseInt(params.id, 10);
				if (!user || !Number.isFinite(id))
					return Response.json({ error: "not found" }, { status: 404 });

				const exporter = getServerRuntime().recordExporters?.[format];
				if (!exporter) {
					return Response.json({ error: "export not configured" }, { status: 503 });
				}

				// Non-owner → service fails Forbidden → same 404 as missing.
				const record = await runAs(
					user,
					Effect.gen(function* () {
						const patients = yield* Patients;
						const patient = yield* patients
							.get(user.id, id)
							.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
						if (!patient) return null;
						const consultations = yield* Consultations;
						const summaries = yield* consultations.list(user.id, id);
						const details = yield* Effect.forEach(summaries, (s) =>
							consultations.get(s.id, user.id),
						);
						return { patient, consultations: details.filter((d) => d !== null) };
					}),
				);
				if (!record) return Response.json({ error: "not found" }, { status: 404 });

				const body = exporter.render({
					patient: record.patient,
					// Oldest first: the record reads as a timeline.
					consultations: [...record.consultations].sort(
						(a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
					),
					practitioner: { id: user.id, name: user.name ?? user.email, email: user.email },
					exportedAt: new Date(),
				});
				return new Response(body, {
					headers: {
						"content-type": `${exporter.mediaType}; charset=utf-8`,
						"content-disposition": `attachment; filename="patient-${record.patient.id}.${exporter.fileSuffix}"`,
						"cache-control": "private, no-store",
					},
				});
			},
		},
	},
});
