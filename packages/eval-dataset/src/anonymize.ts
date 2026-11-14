/**
 * PHI scrubber for real partner transcripts (M4 governance gate).
 *
 * anonymize() strips identifying patterns BEFORE a transcript can be
 * persisted as eval material. It is deliberately IRREVERSIBLE — the
 * audit record carries counts per category, never the redacted values
 * or positions. If a category survives scrubbing, fail the sample:
 * better to drop real data than to leak PHI into a dataset.
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

const PATTERNS: readonly {
	category: PhiCategory;
	re: RegExp;
	token: string;
}[] = [
	// CPF: 123.456.789-00 or 12345678900 (word-bounded).
	{
		category: "cpf",
		re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g,
		token: "[CPF]",
	},
	// BR phones: (11) 91234-5678 | 11 91234-5678 | 9+8-digit runs.
	{
		category: "phone",
		re: /\b(?:\(?\d{2}\)?\s?)?9?\d{4}-?\d{4}\b/g,
		token: "[PHONE]",
	},
	{ category: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, token: "[EMAIL]" },
	// Date of birth phrasing — "nascido em 12/03/1985", "DN: 12-03-1985".
	{
		category: "date_of_birth",
		re: /\b(?:nascid[ao](?:\sem)?|data de nascimento[:\s]?|DN[:\s])\s*\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/gi,
		token: "[DOB]",
	},
];

/** Scrub one transcript — counts per category, values never retained. */
export function anonymize(text: string): AnonymizedText {
	const redactions: Redaction[] = [];
	let out = text;
	for (const { category, re, token } of PATTERNS) {
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
 * long digit run that survived is a red flag). Caller records the
 * decision; the sample is ingested only when non-null.
 */
export function gateTranscript(text: string): AnonymizedText | null {
	const clean = anonymize(text);
	if (/\b\d{8,}\b/.test(clean.text.replace(/\[\w+\]/g, ""))) {
		return null; // residual long number — likely an id/document
	}
	return clean;
}
