import type { PatientMessages } from "../i18n.ts";

/** Host route GET /api/patients/:id/export — owner-only download per standard. */
export const exportLinks = (t: PatientMessages, id: number) =>
	[
		["fhir-r4", t.detail.exportFhir],
		["openehr", t.detail.exportOpenEhr],
	].map(([format, label]) => ({
		format: format!,
		label: label!,
		href: `/api/patients/${id}/export?format=${format}`,
	}));
