import type { Persona } from "./schema.ts";

/**
 * Persona matrix — the axes the dataset varies over. Each sample is
 * one cell: region (speech register/accent cue for the TTS + script
 * generator) × age band × register (education/social class proxy) ×
 * specialty. Literals are English — generators map them to pt-BR
 * content; they never leak provider ids or rendered text.
 */

export interface PersonaMatrix {
	readonly regions: readonly string[];
	readonly ageBands: readonly string[];
	readonly registers: readonly string[];
	readonly specialties: readonly string[];
}

/** Default matrix — covers the diversity axes the eval must
 * prove: regional accent/register, life stage, clinical domain. */
export const DEFAULT_MATRIX: PersonaMatrix = {
	regions: ["southeast", "south", "northeast", "north", "central_west"],
	ageBands: ["child", "adult", "elderly"],
	registers: ["formal", "colloquial"],
	specialties: [
		"general_practice",
		"pediatrics",
		"gynecology",
		"geriatrics",
		"cardiology",
		"psychiatry",
	],
};

/** Every cell of the matrix — cartesian product, stable order
 * (region outer → specialty inner). */
export const expandPersonaMatrix = (matrix: PersonaMatrix): Persona[] =>
	matrix.regions.flatMap((region) =>
		matrix.ageBands.flatMap((ageBand) =>
			matrix.registers.flatMap((register) =>
				matrix.specialties.map((specialty) => ({ region, ageBand, register, specialty })),
			),
		),
	);

/** Deterministic sub-sample for quick runs: every `step`-th cell of
 * the expansion, offset by `start`. Stable across runs — same params,
 * same personas. */
export const sampleMatrix = (matrix: PersonaMatrix, step: number, start = 0): Persona[] => {
	const all = expandPersonaMatrix(matrix);
	return all.filter((_, i) => (i - start) % Math.max(1, step) === 0);
};
