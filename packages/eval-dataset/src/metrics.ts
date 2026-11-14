/**
 * Lexical + calibration metrics — the cheap half of the eval (no model
 * calls). WER/CER against the gold script; confidence bucketing for
 * precision-first auto-accept calibration. Clinical entity verdicts
 * come from the EvalPort; `checkEntities` is the text-only fast path.
 */

import type { ConfSegment, EntityVerdict, GoldEntity } from "./schema.ts";

export type { ConfSegment };
/** Gold-annotated entity — schema-owned so manifests can persist it. */
export type ExpectedEntity = GoldEntity;

export interface NormalizeOpts {
	readonly lowercase?: boolean;
	readonly stripPunct?: boolean;
	readonly expandNumbers?: boolean;
	/** Fold diacritics ("cabeça"→"cabeca") — pt-BR ASR routinely drops
	 * accents; folding keeps accent slips out of WER/entity checks. */
	readonly foldAccents?: boolean;
	/** Strip speaker labels ("Doctor:", "Paciente:"…) — scripts carry
	 * them, ASR output doesn't; comparing labeled gold to unlabeled
	 * hyp inflates WER by construction. */
	readonly stripSpeakers?: boolean;
}

/** The pinned normalization profile — version this when it changes;
 * reports must name the profile, not just the number. */
export const NORMALIZATION_PROFILE = "ptbr-v1";

const DEFAULT_OPTS: Required<NormalizeOpts> = {
	lowercase: true,
	stripPunct: true,
	expandNumbers: true,
	foldAccents: true,
	stripSpeakers: true,
};

const UNITS = [
	"zero",
	"um",
	"dois",
	"três",
	"quatro",
	"cinco",
	"seis",
	"sete",
	"oito",
	"nove",
	"dez",
	"onze",
	"doze",
	"treze",
	"quatorze",
	"quinze",
	"dezesseis",
	"dezessete",
	"dezoito",
	"dezenove",
];
const TENS = [
	"",
	"",
	"vinte",
	"trinta",
	"quarenta",
	"cinquenta",
	"sessenta",
	"setenta",
	"oitenta",
	"noventa",
];
const HUNDREDS = [
	"",
	"cento",
	"duzentos",
	"trezentos",
	"quatrocentos",
	"quinhentos",
	"seiscentos",
	"setecentos",
	"oitocentos",
	"novecentos",
];

/** pt-BR number words 0–9999 — "50"→"cinquenta" (a dose), never
 * "cinco zero". Approximation is fine: ref and hyp normalize the
 * same way. */
const numberToWords = (n: number): string => {
	if (n < 20) return UNITS[n]!;
	if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? ` e ${UNITS[n % 10]}` : "");
	if (n === 100) return "cem";
	if (n < 1000) {
		const rest = n % 100;
		return HUNDREDS[Math.floor(n / 100)]! + (rest ? ` e ${numberToWords(rest)}` : "");
	}
	if (n < 10000) {
		const rest = n % 1000;
		const head = n === 1000 ? "mil" : `${numberToWords(Math.floor(n / 1000))} mil`;
		return head + (rest ? ` ${rest < 100 ? "e " : ""}${numberToWords(rest)}` : "");
	}
	return String(n);
};

const expandNumbers = (s: string): string =>
	s.replace(/\d+/g, (n) => ` ${numberToWords(Number.parseInt(n, 10))} `);

// Case-insensitive + tolerant of "Dr."-style abbreviations; runs after
// lowercasing in the default profile but must also work when callers
// disable `lowercase`.
const SPEAKER_RE = /\b(doctor|patient|médico|medico|paciente|doutor|doutora|dr|dra)\.?\s*:/gi;

export const normalize = (s: string, opts: NormalizeOpts = {}): string => {
	const o = { ...DEFAULT_OPTS, ...opts };
	let out = s.normalize("NFC");
	if (o.lowercase) out = out.toLowerCase();
	if (o.foldAccents) out = out.normalize("NFD").replace(/\p{M}/gu, "");
	if (o.stripSpeakers) out = out.replace(SPEAKER_RE, " ");
	// Decimal guard BEFORE punctuation strip: "2,5 mg" must not
	// collapse to "25 mg" — that is a dosage error the metric would
	// invent. Digit[.,]digit → " vírgula ". ASR emits both separators
	// ("2,5" pt-BR gold, "2.5" engine output) — guard both or the same
	// dose scores differently per formatting. Known v1 gap: pt-BR
	// thousands ("1.000,00") still mangles; revisit with the unit-alias
	// work noted in BENCHMARK.md.
	if (o.expandNumbers) {
		out = out.replace(/(\d)[.,](\d)/g, "$1 virgula $2");
		out = expandNumbers(out);
	}
	if (o.stripPunct) out = out.replace(/[^\p{L}\p{N}\s]/gu, " ");
	return out.replace(/\s+/g, " ").trim();
};

/** Levenshtein over an element sequence — two rows, O(min(n,m)) memory. */
const editDistance = (a: readonly string[], b: readonly string[]): number => {
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	let prev = new Array<number>(short.length + 1).fill(0).map((_, i) => i);
	for (let j = 1; j <= long.length; j++) {
		const cur = new Array<number>(short.length + 1).fill(0);
		cur[0] = j;
		for (let i = 1; i <= short.length; i++) {
			cur[i] = Math.min(
				prev[i]! + 1,
				cur[i - 1]! + 1,
				prev[i - 1]! + (short[i - 1] === long[j - 1] ? 0 : 1),
			);
		}
		prev = cur;
	}
	return prev[short.length]!;
};

const words = (s: string): string[] => (s ? s.split(" ") : []);

/** Word error rate — normalized unless opts disable it. */
export const wer = (ref: string, hyp: string, opts: NormalizeOpts = {}): number => {
	const r = words(normalize(ref, opts));
	if (r.length === 0) return words(normalize(hyp, opts)).length === 0 ? 0 : 1;
	return editDistance(r, words(normalize(hyp, opts))) / r.length;
};

/** Character error rate — Array.from for code points (spread trips
 * no-misused-spread; CER counts code points, not graphemes). */
export const cer = (ref: string, hyp: string, opts: NormalizeOpts = {}): number => {
	const r = Array.from(normalize(ref, opts));
	if (r.length === 0) return Array.from(normalize(hyp, opts)).length === 0 ? 0 : 1;
	return editDistance(r, Array.from(normalize(hyp, opts))) / r.length;
};

// ---------- clinical entities (text-only fast path) ----------

/**
 * Cheap presence check — the floor for runs without an EvalPort.
 * Verdicts are tagged `source: "text_floor"` so reports never blend
 * them with judge answers. Negations are NEVER "correct" from the
 * floor: presence of the phrase isn't proof of polarity.
 */
export const checkEntities = (
	entities: readonly ExpectedEntity[],
	hyp: string,
): EntityVerdict[] => {
	const h = normalize(hyp);
	// Space-padded token match: substring search would let "dor" match
	// inside "dormir" — a false "correct" on a clinical entity is the
	// worst silent error this platform can produce.
	const padded = h ? ` ${h} ` : "";
	return entities.map((e) => {
		const needle = normalize(e.value);
		// An entity that normalizes to nothing can never be verified —
		// it is not "present".
		const present = needle !== "" && padded.includes(` ${needle} `);
		const status = !present
			? ("dropped" as const)
			: e.category === "negation"
				? ("unverified" as const)
				: ("correct" as const);
		return {
			category: e.category,
			entity: e.value,
			status,
			source: "text_floor" as const,
		};
	});
};

// ---------- confidence calibration ----------

export interface ConfBucket {
	readonly lo: number;
	readonly hi: number;
	readonly count: number;
	readonly correct: number;
	/** correct / count — auto-accept precision inside the bucket. */
	readonly precision: number;
}

/**
 * Bucket segments by confidence; `size` is the bucket width
 * (default 0.05). Segments without a confidence land in a `null`-keyed
 * bucket appended last (lo=hi=-1).
 */
export const bucketByConfidence = (segments: readonly ConfSegment[], size = 0.05): ConfBucket[] => {
	// Integer bucket index — avoids float noise in `lo` (0.7 vs
	// 0.7000000000000001) and keeps threshold output clean.
	const buckets = new Map<number, { count: number; correct: number }>();
	let unscored = { count: 0, correct: 0 };
	// +1e-9 before floor: 0.7/0.1 is 6.9999… in fp and would land one
	// bucket low.
	// Clamp at 0: a negative confidence would otherwise floor into a
	// negative bucket index rendered as a normal low band.
	const idxOf = (c: number) =>
		Math.max(0, Math.min(Math.floor((c + 1e-9) / size), Math.round(1 / size) - 1));
	for (const s of segments) {
		if (s.confidence === undefined) {
			unscored = {
				count: unscored.count + 1,
				correct: unscored.correct + (s.correct ? 1 : 0),
			};
			continue;
		}
		const idx = idxOf(s.confidence);
		const b = buckets.get(idx) ?? { count: 0, correct: 0 };
		b.count++;
		if (s.correct) b.correct++;
		buckets.set(idx, b);
	}
	const round = (n: number) => Math.round(n * 1e9) / 1e9;
	const out: ConfBucket[] = [...buckets.entries()]
		.sort(([a], [b]) => a - b)
		.map(([idx, b]) => ({
			lo: round(idx * size),
			hi: round((idx + 1) * size),
			count: b.count,
			correct: b.correct,
			precision: b.correct / b.count,
		}));
	if (unscored.count > 0) {
		out.push({
			lo: -1,
			hi: -1,
			count: unscored.count,
			correct: unscored.correct,
			precision: unscored.correct / unscored.count,
		});
	}
	return out;
};

/**
 * Precision-first auto-accept threshold: the lowest cutoff where every
 * bucket at-or-above is itself ≥ target. A bad marginal band stops the
 * descent — accepting it would let weak segments ride the average.
 * Cumulative precision at the cutoff is then ≥ target automatically
 * (a weighted mean of bands each ≥ target). Returns 1 (accept nothing
 * blindly) when no cutoff qualifies.
 *
 * Distinct from `decideAutoAccept` in accept.ts: that gate is a
 * pooled precision floor over ALL confSegments and deliberately
 * ignores per-segment confidence at this stage; this function is the
 * per-segment threshold notion — see accept.ts for the boundary.
 */
export const recommendThreshold = (
	segments: readonly ConfSegment[],
	targetPrecision = 0.99,
	size = 0.05,
): number => {
	const buckets = bucketByConfidence(segments, size).filter((b) => b.lo >= 0);
	let candidate: number | null = null;
	for (let i = buckets.length - 1; i >= 0; i--) {
		const b = buckets[i]!;
		if (b.precision < targetPrecision) break;
		candidate = b.lo;
	}
	return candidate ?? 1;
};
