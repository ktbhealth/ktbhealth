/**
 * args.ts — strict argv parsing for the eval CLI (P-074 phase 4).
 *
 * Every command declares its positionals and flags up front; unknown
 * flags, missing values, and non-finite numerics are UsageErrors
 * (exit 2), never silently coerced — the M9 lesson: a bad `--min-n`
 * must not become a silently-disabled gate.
 */

type FlagKind = "string" | "int" | "number" | "boolean";

export interface ArgSpec {
	/** Positional argument names, in order. */
	readonly positionals?: readonly string[];
	/** Allowed `--flag` names → kind. `int`/`number` reject
	 * non-finite/garbage; `boolean` takes no value. */
	readonly flags?: Readonly<Record<string, FlagKind>>;
}

export interface ParsedArgs {
	readonly positional: Readonly<Record<string, string>>;
	readonly flags: Readonly<Record<string, string | number | boolean | undefined>>;
}

/** Bad argv — the CLI prints the message + usage hint, exits 2. */
export class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsageError";
	}
}

const USAGE = "usage: eval <command> [args] — see `eval --help`";

/** Parse `argv` (already stripped of `cmd`) against `spec`.
 * Supports `--name value`, `--name=value`, and bare boolean flags.
 * Throws UsageError on anything undeclared or malformed. */
export const parseArgs = (argv: readonly string[], spec: ArgSpec): ParsedArgs => {
	const positionals = spec.positionals ?? [];
	const flagSpec = spec.flags ?? {};
	const positional: Record<string, string> = {};
	const flags: Record<string, string | number | boolean | undefined> = {};
	const rest: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg.startsWith("--")) {
			const eq = arg.indexOf("=");
			const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
			const kind = flagSpec[name];
			if (kind === undefined) {
				throw new UsageError(`unknown flag --${name} (${USAGE})`);
			}
			if (kind === "boolean") {
				if (eq >= 0) {
					throw new UsageError(`--${name} is a boolean flag, got "=${arg.slice(eq + 1)}"`);
				}
				flags[name] = true;
				continue;
			}
			let raw: string;
			if (eq >= 0) {
				raw = arg.slice(eq + 1);
			} else {
				i++;
				const next = argv[i];
				if (next === undefined || next.startsWith("--")) {
					throw new UsageError(`--${name} requires a value (${USAGE})`);
				}
				raw = next;
			}
			if (kind === "int") {
				const n = Number(raw);
				if (!Number.isInteger(n)) {
					throw new UsageError(`--${name} must be an integer, got: ${raw}`);
				}
				flags[name] = n;
			} else if (kind === "number") {
				const n = Number(raw);
				if (!Number.isFinite(n)) {
					throw new UsageError(`--${name} must be a finite number, got: ${raw}`);
				}
				flags[name] = n;
			} else {
				flags[name] = raw;
			}
		} else if (arg.startsWith("-") && arg !== "-") {
			throw new UsageError(`unknown argument ${arg} (${USAGE})`);
		} else {
			rest.push(arg);
		}
	}

	if (rest.length > positionals.length) {
		throw new UsageError(`unexpected argument ${rest[positionals.length]} (${USAGE})`);
	}
	for (const [i, name] of positionals.entries()) {
		const v = rest[i];
		if (v === undefined) {
			throw new UsageError(`missing positional <${name}> (${USAGE})`);
		}
		positional[name] = v;
	}
	return { positional, flags };
};

/** Read a string flag with default; `undefined` when absent and no
 * default — callers decide whether absence is an error. */
export const strFlag = (args: ParsedArgs, name: string, def?: string): string | undefined => {
	const v = args.flags[name];
	if (v === undefined) return def;
	if (typeof v !== "string") throw new UsageError(`--${name} must be a string`);
	return v;
};

export const intFlag = (args: ParsedArgs, name: string, def: number, min?: number): number => {
	const v = args.flags[name];
	if (v === undefined) return def;
	if (typeof v !== "number" || !Number.isInteger(v)) {
		throw new UsageError(`--${name} must be an integer`);
	}
	if (min !== undefined && v < min) {
		throw new UsageError(`--${name} must be >= ${min}, got: ${v}`);
	}
	return v;
};

export const numFlag = (args: ParsedArgs, name: string, def: number): number => {
	const v = args.flags[name];
	if (v === undefined) return def;
	if (typeof v !== "number" || !Number.isFinite(v)) {
		throw new UsageError(`--${name} must be a finite number`);
	}
	return v;
};

export const boolFlag = (args: ParsedArgs, name: string): boolean => args.flags[name] === true;
