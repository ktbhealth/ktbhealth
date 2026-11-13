import { Effect } from "effect";

import { Consultations } from "@ktb/consultations";
import { Patients } from "@ktb/patients";
import { recordSummary } from "@ktb/patients/record";
import { createPluginApiRoute, getSessionUser, runAs } from "@ktb/server-fns";

/**
 * GET /api/consultations/:id/pdf — owner-only download of the anamnesis PDF.
 *
 * The route module lives in this package and is mounted into the host's
 * virtual route tree by `consultationsRoutesPlugin`
 * (physical("/api", "src/api-routes")); the session/runtime boundary is
 * @ktb/server-fns, so no host imports are needed (P-033).
 */
export const Route = createPluginApiRoute("consultations.routes")("/api/consultations/$id/pdf")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const user = await getSessionUser();
				const id = Number.parseInt(params.id, 10);
				if (!user || !Number.isFinite(id))
					return Response.json({ error: "not found" }, { status: 404 });

				// Non-owner → service fails Forbidden → same 404 as missing.
				const { detail, patient } = await runAs(
					user,
					Effect.gen(function* () {
						const consultations = yield* Consultations;
						const detail = yield* consultations
							.get(id, user.id)
							.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
						if (!detail?.patientId) return { detail, patient: null };
						const patients = yield* Patients;
						const patient = yield* patients
							.get(user.id, detail.patientId)
							.pipe(Effect.catchTag("Forbidden", () => Effect.succeed(null)));
						return { detail, patient };
					}),
				);
				if (!detail) return Response.json({ error: "not found" }, { status: 404 });
				if (!detail.anamnesis)
					return Response.json({ error: "consultation has no saved anamnesis" }, { status: 409 });

				// Lazy: this module sits in the client route tree, so a static
				// import would bundle pdfkit (Node lib) into the browser and
				// crash hydration on every page.
				const { renderAnamnesisPdf } = await import("@ktb/export-pdf");
				const pdf = await renderAnamnesisPdf({
					consultationId: detail.id,
					createdAt: detail.createdAt,
					patientName: detail.patientName,
					patientDetails: patient ? recordSummary(patient) : null,
					doctorName: user.name,
					consentAt: detail.consentAt,
					anamnesis: detail.anamnesis,
				});
				return new Response(new Uint8Array(pdf), {
					headers: {
						"content-type": "application/pdf",
						"content-disposition": `attachment; filename="anamnesis-consultation-${detail.id}.pdf"`,
						"cache-control": "private, no-store",
					},
				});
			},
		},
	},
});
