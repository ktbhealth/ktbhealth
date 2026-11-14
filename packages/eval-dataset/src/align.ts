/**
 * align.ts — segment↔gold alignment (M2).
 *
 * Maps each gold entity onto the ASR segment(s) whose text contains it
 * (after pt-BR normalization) — per-entity confidence becomes real
 * instead of a segment-average guess, and misses are attributable.
 * Pure: no I/O, no provider literals.
 */

import { normalize } from "./metrics.ts";
import type { AsrSegment, GoldEntity } from "./schema.ts";

export interface EntityAlignment {
	readonly entity: GoldEntity;
	/** Indexes into the segments array — empty when the entity text
	 * appears in no segment (dropped). */
	readonly segmentIndexes: readonly number[];
	/** Max segment confidence among matches — undefined when dropped
	 * OR when no matched segment carries a confidence. Unscored stays
	 * undefined: conflating it with 0 would read as "known-bad". */
	readonly confidence?: number;
	readonly matched: boolean;
}

export const alignEntities = (
	segments: readonly AsrSegment[],
	entities: readonly GoldEntity[],
): readonly EntityAlignment[] =>
	entities.map((entity) => {
		const needle = normalize(entity.value);
		// Same guards as metrics.ts checkEntities: an entity that
		// normalizes to nothing can never be verified (it must not
		// match every segment), and matching is token-boundary —
		// raw includes() would let "dor" hit inside "dormir".
		const hits =
			needle === ""
				? []
				: segments.flatMap((seg, i) => {
						const text = normalize(seg.text);
						const padded = text ? ` ${text} ` : "";
						return padded.includes(` ${needle} `) ? [i] : [];
					});
		const scored = hits
			.map((i) => segments[i]!.confidence)
			.filter((c): c is number => c !== undefined);
		const confidence = hits.length > 0 && scored.length > 0 ? Math.max(...scored) : undefined;
		return { entity, segmentIndexes: hits, confidence, matched: hits.length > 0 };
	});

/** Convenience: which entities did the ASR lose entirely? */
export const droppedEntities = (aligned: readonly EntityAlignment[]): readonly GoldEntity[] =>
	aligned.filter((a) => !a.matched).map((a) => a.entity);
