import type { LocaleProfile } from "./locale.ts";
import { ptBR } from "./locales/pt-BR.ts";

/**
 * PHI scrubber for real partner transcripts (M4 governance gate).
 *
 * anonymize() strips identifying patterns BEFORE a transcript can be
 * persisted as eval material. It is deliberately IRREVERSIBLE — the
 * audit record carries counts per category, never the redacted values
 * or positions. Neither function fails anything by itself: they
 * return audit counts (anonymize) or null on residual identifiers
 * (gateTranscript); the CALLER decides to drop the sample — see
 * processSample in pipeline.ts, which fails closed on a null gate.
 *
 * The patterns themselves are LOCALE data — CPF/BR-phone/DOB phrasing
 * live in the pt-BR profile (`locales/pt-BR.ts`); pass another
 * LocaleProfile to scrub a different jurisdiction's identifiers.
 *
 * Residual-PHI policy (explicit, reviewed): bare dates "12/03/1985"
 * PASS — they carry clinical meaning (dose timing, follow-up) and
 * alone are weak identifiers; DOB is only scrubbed when phrased as
 * such ("nascido em", "DN:"). CEP "12345-678" and free-form names/
 * addresses are NOT yet covered — before real partner ingestion the
 * partner contract must state which residual categories are
 * acceptable, and this table must grow to match.
 */

export type PhiCategory = "cpf" | "phone" | "email" | "date_of_birth";

export interface Redaction {
	category: PhiCategory;
	count: number;
}

export interface AnonymizedText {
	text: string;
	redactions: Redaction[];
	/** True when at least one PHI category was scrubbed — audit flag. */
	scrubbed: boolean;
}

/** Scrub one transcript — counts per category, values never retained.
 * `profile` selects the locale's PHI patterns; default pt-BR. */
export function anonymize(text: string, profile: LocaleProfile = ptBR): AnonymizedText {
	const redactions: Redaction[] = [];
	let out = text;
	for (const { category, re, token } of profile.piiPatterns) {
		const fresh = new RegExp(re.source, re.flags);
		let count = 0;
		out = out.replace(fresh, () => {
			count += 1;
			return token;
		});
		if (count > 0) redactions.push({ category, count });
	}
	return { text: out, redactions, scrubbed: redactions.length > 0 };
}

/**
 * Gate a real transcript for dataset ingestion — returns null when the
 * scrubbed text still carries PHI-shaped leftovers (heuristic: any
 * long digit run that survived is a red flag — the pattern is
 * locale data, `profile.residualIdRe`). On success returns the
 * AnonymizedText audit record (counts only, never values). This
 * function never throws and never fails the sample itself — a null
 * return is the caller's signal to drop it.
 */
export function gateTranscript(text: string, profile: LocaleProfile = ptBR): AnonymizedText | null {
	const clean = anonymize(text, profile);
	if (profile.residualIdRe.test(clean.text.replace(/\[\w+\]/g, ""))) {
		return null; // residual long number — likely an id/document
	}
	return clean;
}
