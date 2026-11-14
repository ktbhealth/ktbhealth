import * as Effect from "effect/Effect";

import { anonymize, gateTranscript } from "./anonymize.ts";
import type { LocaleProfile } from "./locale.ts";
import { ptBR } from "./locales/pt-BR.ts";
import { AsrPort, PortError } from "./ports.ts";
import type { AsrResult, BlobMeta, SampleOrigin } from "./schema.ts";

/**
 * TranscriptPhiPolicy — the domain-owned PHI egress policy (P-074
 * hardening). ONE implementation, applied structurally by the
 * pipeline, not re-implemented per adapter:
 *
 * - TEXT that may egress (LlmPort.correct input, EvalPort judge
 *   state, TtsPort script) is always the SCRUBBED form: processSample
 *   gates the script and transcribeSample gates the ASR text before
 *   any port call, so whatever leaves is already de-identified.
 * - AUDIO cannot be scrubbed — voice is PHI. `guardAsrPort` wraps any
 *   AsrPort implementation and enforces provenance from the call's
 *   own `origin`/`blobMeta` opts: an egress-capable port
 *   (`egress !== false`) only ever receives verified-`synthetic`
 *   audio. Adapters keep their own checks as defense in depth for
 *   direct port callers that bypass the pipeline.
 *
 * Provenance is two-channel: the caller-declared `origin` (sample
 * manifest — a hint) and the blob's stored `blobMeta` (recorded at
 * putBlob/putBlobMeta time — the verified channel). The WORSE verdict
 * wins: stored `real_anonymized`/`unknown` refuses even when the
 * manifest claims `synthetic`.
 */

/** Origins whose content is unverified for egress — real patient
 * data, or rows/blobs that never declared provenance (`unknown`). */
export const untrustedOrigin = (origin: SampleOrigin | undefined): boolean =>
	origin === "real_anonymized" || origin === "unknown";

/** Merge the declared + stored provenance channels — the worse
 * verdict wins (`real_anonymized` > `unknown` > `synthetic`). */
const effectiveOrigin = (
	declared: SampleOrigin | undefined,
	stored: SampleOrigin | undefined,
): SampleOrigin | undefined =>
	declared === "real_anonymized" || stored === "real_anonymized"
		? "real_anonymized"
		: declared === "unknown" || stored === "unknown"
			? "unknown"
			: (declared ?? stored);

/**
 * The audio-egress decision, pure so it is testable without ports.
 * Returns the PortError to fail with, or null when egress is allowed.
 *
 * - `egress === false`: the adapter declares local-only — audio never
 *   leaves the perimeter, provenance is moot.
 * - `egress === true` OR undeclared: fail closed — undeclared is
 *   treated as egress-capable (adapters must opt INTO local-only).
 * - Allowed only when the effective provenance is `synthetic` —
 *   meaning BOTH channels agree or are absent. `blobMeta` null/
 *   undefined with a `synthetic` declaration is the documented
 *   no-record bypass (file:// blobs the store cannot see); the store
 *   adapters' `unknown` default makes genuinely unmarked blobs land
 *   on the `unknown` verdict instead.
 */
export const audioEgressError = (input: {
	readonly origin?: SampleOrigin;
	readonly blobMeta?: BlobMeta | null;
	readonly egress?: boolean;
}): PortError | null => {
	if (input.egress === false) return null;
	const stored = input.blobMeta == null ? undefined : input.blobMeta.origin;
	const effective = effectiveOrigin(input.origin, stored);
	if (effective === "synthetic") return null;
	return new PortError({
		port: "phi",
		message:
			`refusing audio egress to a non-local port: provenance ` +
			`"${effective ?? "undeclared"}" is not verified-synthetic ` +
			`(declared=${input.origin ?? "none"}, stored=${stored ?? "none"})`,
	});
};

type AsrService = AsrPort["Service"];

/**
 * Wrap an AsrPort implementation with the egress policy — the
 * structural enforcement point. The wrapper reads provenance from the
 * call opts the pipeline already resolves (sample.origin +
 * store.getBlobMeta) and fails BEFORE any bytes move when the port
 * egresses and provenance is not verified-synthetic. Works for ANY
 * AsrPort implementation — no per-adapter checks required.
 */
export const guardAsrPort = (asr: AsrService): AsrService => ({
	...(asr.egress !== undefined ? { egress: asr.egress } : {}),
	transcribe: (audio, opts) => {
		const denied = audioEgressError({
			origin: opts?.origin,
			blobMeta: opts?.blobMeta,
			egress: asr.egress,
		});
		return denied === null ? asr.transcribe(audio, opts) : Effect.fail(denied);
	},
});

/**
 * Scrub an ASR result for egress/persistence: the full text goes
 * through gateTranscript (null = residual identifiers → caller fails
 * closed); segment texts get the same patterns via anonymize
 * (best-effort — the full-text gate already ran, and anonymize never
 * fails). Returns null when the gate rejects.
 */
export const scrubAsrResult = (asr: AsrResult, profile: LocaleProfile = ptBR): AsrResult | null => {
	const gated = gateTranscript(asr.text, profile);
	if (gated === null) return null;
	return {
		...asr,
		text: gated.text,
		segments: asr.segments.map((s) => ({ ...s, text: anonymize(s.text, profile).text })),
	};
};
