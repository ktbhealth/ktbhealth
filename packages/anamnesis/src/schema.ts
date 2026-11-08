import { Schema } from "effect";

import type { Anamnesis } from "./types.ts";

/**
 * Runtime contracts for the anamnesis wire format. Types in types.ts stay
 * the canonical TS shapes; these schemas validate anything crossing a
 * trust boundary: LLM output, server-fn payloads, stored JSON.
 * Section keys stay pt-BR — they are the persisted document schema.
 */

export const ConfidenceSchema = Schema.Literals(["alta", "media", "baixa"]);

export const AnamnesisSectionSchema = Schema.Struct({
	content: Schema.String,
	confidence: ConfidenceSchema,
	evidence: Schema.Array(Schema.String),
});

const section = AnamnesisSectionSchema;

export const AnamnesisSchema = Schema.Struct({
	queixa_principal: section,
	hda: section,
	antecedentes: section,
	alergias: section,
	medicamentos_em_uso: section,
	exame_fisico: section,
	hipoteses: section,
	conduta: section,
	// Optional: pre-history documents omit the key and still decode.
	historico: Schema.optionalKey(section),
});

// ---------- decoders ----------
// Return annotations double as compile-time checks that Schema.Type
// stays assignable to the canonical interfaces in types.ts.

export const decodeAnamnesis: (u: unknown) => Anamnesis = Schema.decodeUnknownSync(AnamnesisSchema);

/** Tolerant decode for stored/optional JSON: None instead of throwing. */
export const decodeAnamnesisOption = Schema.decodeUnknownOption(AnamnesisSchema);
