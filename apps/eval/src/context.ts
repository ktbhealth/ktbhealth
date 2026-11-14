/**
 * context.ts — shared command context (P-074 phase 4).
 *
 * `repoRoot`/`evalsDir` are derived from this file's location
 * (apps/eval/src → repo root) so the CLI works from any cwd; tests
 * and callers may inject explicit dirs instead.
 */

import { fileURLToPath } from "node:url";

export interface CmdContext {
	readonly evalsDir: string;
	readonly repoRoot: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly fetchImpl?: typeof fetch;
}

export const repoRoot = (): string => fileURLToPath(new URL("../../../", import.meta.url));

export const defaultContext = (): CmdContext => {
	const root = repoRoot();
	return {
		repoRoot: root,
		evalsDir: `${root}evals`,
		env: process.env,
	};
};
