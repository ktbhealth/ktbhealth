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
	/** Max segment confidence among matches — undefined when dropped. */
	readonly confidence?: number;
	readonly matched: boolean;
}

export const alignEntities = (
	segments: readonly AsrSegment[],
	entities: readonly GoldEntity[],
): readonly EntityAlignment[] =>
	entities.map((entity) => {
		const needle = normalize(entity.value);
		const hits = segments.flatMap((seg, i) => (normalize(seg.text).includes(needle) ? [i] : []));
		const confidence =
			hits.length > 0 ? Math.max(...hits.map((i) => segments[i]!.confidence ?? 0)) : undefined;
		return { entity, segmentIndexes: hits, confidence, matched: hits.length > 0 };
	});

/** Convenience: which entities did the ASR lose entirely? */
export const droppedEntities = (aligned: readonly EntityAlignment[]): readonly GoldEntity[] =>
	aligned.filter((a) => !a.matched).map((a) => a.entity);
