import { Schema } from "effect";

import type { Anamnesis, AnamnesisReview } from "./types.ts";

/**
 * Runtime contracts for the anamnese wire format. Types in types.ts stay
 * the canonical TS shapes; these schemas validate anything crossing a
 * trust boundary: LLM output, server-fn payloads, stored JSON.
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
});

export const AnamnesisSectionKeySchema = Schema.Literals([
	"queixa_principal",
	"hda",
	"antecedentes",
	"alergias",
	"medicamentos_em_uso",
	"exame_fisico",
	"hipoteses",
	"conduta",
]);

export const ReviewGapSchema = Schema.Struct({
	secao: AnamnesisSectionKeySchema,
	o_que_falta: Schema.String,
	pergunta_sugerida: Schema.String,
	motivo: Schema.String,
});

export const ReviewHypothesisSchema = Schema.Struct({
	diagnostico: Schema.String,
	probabilidade: ConfidenceSchema,
	raciocinio: Schema.String,
	evidence: Schema.Array(Schema.String),
	investigar: Schema.Array(Schema.String),
});

export const AnamnesisReviewSchema = Schema.Struct({
	lacunas: Schema.Array(ReviewGapSchema),
	hipoteses: Schema.Array(ReviewHypothesisSchema),
	sinais_de_alerta: Schema.Array(Schema.String),
	inconsistencias: Schema.Array(Schema.String),
});

// ---------- decoders ----------
// Return annotations double as compile-time checks that Schema.Type
// stays assignable to the canonical interfaces in types.ts.

export const decodeAnamnesis: (u: unknown) => Anamnesis = Schema.decodeUnknownSync(AnamnesisSchema);
export const decodeAnamnesisReview: (u: unknown) => AnamnesisReview =
	Schema.decodeUnknownSync(AnamnesisReviewSchema);

/** Tolerant decode for stored/optional JSON: None instead of throwing. */
export const decodeAnamnesisOption = Schema.decodeUnknownOption(AnamnesisSchema);
export const decodeAnamnesisReviewOption = Schema.decodeUnknownOption(AnamnesisReviewSchema);
