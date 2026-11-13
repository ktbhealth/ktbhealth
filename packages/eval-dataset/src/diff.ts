import * as Data from "effect/Data";

import type { EditList, EditOp } from "./schema.ts";

export type { EditList, EditOp };

/**
 * Reversible edit lists — the auditable-diff contract between pipeline
 * stages. The LLM cleanup returns `EditList`, never a rewritten blob:
 * every edit stores the removed text, so any stage transition can be
 * rolled back and re-judged.
 */

/** An op claimed to remove text that does not match the base — the
 * edit list is corrupt or targets a different stage's text. Never
 * apply silently. */
export class EditApplyError extends Data.TaggedError("EditApplyError")<{
	readonly at: number;
	readonly expected: string;
	readonly actual: string;
}> {}

export const emptyEditList: EditList = { ops: [] };

const applyOne = (out: string, op: EditOp): string => {
	const actual = out.slice(op.at, op.at + op.remove.length);
	if (actual !== op.remove) {
		throw new EditApplyError({ at: op.at, expected: op.remove, actual });
	}
	return out.slice(0, op.at) + op.insert + out.slice(op.at + op.remove.length);
};

/** Apply ops right-to-left — earlier `at` offsets stay valid. Throws
 * `EditApplyError` when an op's `remove` does not match the base.
 * Ops sharing the same `at` apply in input order — producers must
 * emit non-overlapping ops (diffTexts does). */
export const applyEdits = (base: string, ops: readonly EditOp[]): string => {
	let out = base;
	for (const op of [...ops].sort((a, b) => b.at - a.at)) {
		out = applyOne(out, op);
	}
	return out;
};

/** Swap remove/insert — inverting requires no re-diff. */
export const invertEdits = (ops: readonly EditOp[]): readonly EditOp[] =>
	ops.map((op) => ({ ...op, remove: op.insert, insert: op.remove }));

/** Roll back a previously applied edit list. Inverse ops apply
 * left-to-right because forward application moved later offsets. */
export const revertEdits = (edited: string, ops: readonly EditOp[]): string => {
	let out = edited;
	for (const op of [...invertEdits(ops)].sort((a, b) => a.at - b.at)) {
		out = applyOne(out, op);
	}
	return out;
};

// ---------- word-level diff → edit list ----------

interface Token {
	readonly text: string;
	readonly at: number;
}

const tokenize = (s: string): Token[] => {
	const out: Token[] = [];
	const re = /\S+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s)) !== null) out.push({ text: m[0], at: m.index });
	return out;
};

const END = -1;

/** DP-cell budget for diffTexts — 4M cells ≈ 32MB of numbers. Past
 * this, fall back to a single whole-range replace op. */
const MAX_DP_CELLS = 4_000_000;

/**
 * Char-span diff via word-level LCS over the changed core — common
 * prefix/suffix tokens are trimmed first so the DP table stays small
 * (long consults only pay for the differing middle, not O(n·m) over
 * the whole text). Each maximal changed run becomes one `EditOp`;
 * `kind` is "fix" — WHY an edit exists is the producer's call.
 */
export const diffTexts = (base: string, target: string): EditList => {
	const a = tokenize(base);
	const b = tokenize(target);
	// Trim shared head/tail tokens — identical regions need no table.
	let head = 0;
	while (head < a.length && head < b.length && a[head]!.text === b[head]!.text) head++;
	let aEnd = a.length - 1;
	let bEnd = b.length - 1;
	while (aEnd >= head && bEnd >= head && a[aEnd]!.text === b[bEnd]!.text) {
		aEnd--;
		bEnd--;
	}

	const ops: EditOp[] = [];
	if (head === a.length && head === b.length) return { ops };

	// LCS over the differing cores a[head..aEnd] × b[head..bEnd].
	const an = aEnd - head + 1;
	const bn = bEnd - head + 1;

	// Memory guard: the DP table is an×bn cells — two divergent long
	// transcripts would blow the low-RAM budget. Over the cap, emit one
	// whole-range replace (still valid, still reversible).
	if (an * bn > MAX_DP_CELLS) {
		ops.push({ at: 0, remove: base, insert: target, kind: "fix" });
		return { ops };
	}
	const dp: number[][] = Array.from({ length: an + 1 }, () => new Array<number>(bn + 1).fill(0));
	for (let i = an - 1; i >= 0; i--) {
		for (let j = bn - 1; j >= 0; j--) {
			dp[i]![j] =
				a[head + i]!.text === b[head + j]!.text
					? dp[i + 1]![j + 1]! + 1
					: Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
		}
	}
	let i = 0;
	let j = 0;
	while (i < an && j < bn) {
		if (a[head + i]!.text === b[head + j]!.text) {
			i++;
			j++;
			continue;
		}
		const delStart = i;
		const insStart = j;
		while (i < an && a[head + i]!.text !== b[head + j]!.text && dp[i + 1]![j]! >= dp[i]![j + 1]!)
			i++;
		while (j < bn && (i >= an || a[head + i]!.text !== b[head + j]!.text)) j++;
		pushOp(ops, base, target, a, b, head + delStart, head + i, head + insStart, head + j);
	}
	if (i < an) {
		pushOp(ops, base, target, a, b, head + i, aEnd + 1, END, END);
	}
	if (j < bn) {
		pushOp(ops, base, target, a, b, head + i, head + i, head + j, bEnd + 1);
	}
	return { ops };
};

/**
 * Emit one op covering base tokens [aFrom,aTo) replaced by target
 * tokens [bFrom,bTo). The removed slice runs to the next kept token's
 * offset so it swallows inter-token whitespace; mid-text inserts get
 * their trailing space from the target slice, while a pure insert at
 * the end takes one leading space.
 */
const pushOp = (
	ops: EditOp[],
	base: string,
	target: string,
	a: readonly Token[],
	b: readonly Token[],
	aFrom: number,
	aTo: number,
	bFrom: number,
	bTo: number,
): void => {
	let at = aFrom < a.length ? a[aFrom]!.at : base.length;
	const removeEnd = aTo < a.length ? a[aTo]!.at : base.length;
	// Deleting to the end: swallow the space before the removed run so
	// "a b c" → "a b" drops " c", not just "c". When the op also inserts,
	// the space moves into the insert instead.
	const swallowsLeadingSpace = aTo >= a.length && at > 0 && /\s/.test(base[at - 1]!);
	if (swallowsLeadingSpace) at--;
	let insert =
		bFrom !== END && bFrom < b.length
			? target.slice(b[bFrom]!.at, bTo < b.length ? b[bTo]!.at : target.length)
			: "";
	if (
		((swallowsLeadingSpace && aFrom !== aTo) || (aFrom === aTo && at === base.length)) &&
		insert &&
		!/^\s/.test(insert)
	) {
		insert = ` ${insert}`;
	}
	ops.push({ at, remove: base.slice(at, removeEnd), insert, kind: "fix" });
};
