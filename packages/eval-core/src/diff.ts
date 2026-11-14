import * as Data from "effect/Data";

import type { EditList, EditOp } from "./schema.ts";

export type { EditList, EditOp };

/**
 * Reversible edit lists — the auditable-diff contract between pipeline
 * stages. The LLM cleanup returns `EditList`, never a rewritten blob:
 * every edit stores the removed text, so a stage transition can be
 * verified (and, with the inverse ops, rolled back).
 *
 * Producers are the generative ports (LlmPort.correct); this module
 * owns APPLICATION. The word-level diff/invert helpers that used to
 * live here (`diffTexts`, `invertEdits`, `revertEdits`,
 * `emptyEditList`) had no callers and were removed — re-add a
 * producer only when a stage actually needs to synthesize an
 * EditList locally.
 */

/** An op claimed to remove text that does not match the base — the
 * edit list is corrupt or targets a different stage's text. Never
 * apply silently. */
export class EditApplyError extends Data.TaggedError("EditApplyError")<{
	readonly at: number;
	readonly expected: string;
	readonly actual: string;
}> {}

const applyOne = (out: string, op: EditOp): string => {
	const actual = out.slice(op.at, op.at + op.remove.length);
	if (actual !== op.remove) {
		throw new EditApplyError({ at: op.at, expected: op.remove, actual });
	}
	return out.slice(0, op.at) + op.insert + out.slice(op.at + op.remove.length);
};

/** Apply ops right-to-left — earlier `at` offsets stay valid. Throws
 * `EditApplyError` when an op's `remove` does not match the base.
 * Ops sharing the same `at` apply in input order — producers
 * must emit non-overlapping ops. */
export const applyEdits = (base: string, ops: readonly EditOp[]): string => {
	let out = base;
	for (const op of [...ops].sort((a, b) => b.at - a.at)) {
		out = applyOne(out, op);
	}
	return out;
};
