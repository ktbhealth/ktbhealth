import { Link } from "@tanstack/react-router";

import type { ChromeProps } from "@ktb/kernel";

/**
 * "New consultation" CTA contributed to `app.header.actions` (P-060).
 * The label comes from the host-injected `labels.newConsultation` —
 * plugins cannot import the host's i18n runtime — with an English
 * fallback for hosts that don't fill the key. Hidden for a patient
 * account (`user.patientOnly`), which has no doctor side to record for.
 */
export function NewConsultationLink({ user, labels }: ChromeProps) {
	if (user?.patientOnly === true) return null;
	return (
		<Link
			to="/consultations/new"
			className="ml-1 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/80"
		>
			{labels.newConsultation ?? "+ New consultation"}
		</Link>
	);
}
