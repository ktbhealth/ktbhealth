import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

/**
 * Minimal `.dev.vars` loader for the `dev:node` path (workerd/miniflare
 * reads the same file natively under `dev`). The file is dotenv-style:
 * `KEY=value` lines written by scripts/dev-secrets.mjs as
 * `KEY=<JSON.stringify(value)>`, plus comments/blank lines and single- or
 * double-quoted values by hand.
 *
 * Semantics follow 12-factor: real environment variables win — a key
 * already present in process.env is never overwritten. Values are never
 * logged; callers may log key names only.
 */

const unquote = (raw: string): string => {
	const value = raw.trim();
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		try {
			return JSON.parse(value) as string;
		} catch {
			return value.slice(1, -1);
		}
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, "\\");
	}
	return value;
};

/** Parse dotenv-style content into a key/value map (later wins). */
export const parseDevVars = (content: string): Record<string, string> => {
	const vars: Record<string, string> = {};
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		if (key === "" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
		vars[key] = unquote(trimmed.slice(eq + 1));
	}
	return vars;
};

/**
 * Merge `.dev.vars` into process.env without overriding existing vars.
 * Returns the names of keys that were applied (safe to log — never
 * values). Missing file or unreadable file is a no-op.
 */
export const loadDevVars = (file: string): string[] => {
	if (!existsSync(file)) return [];
	let vars: Record<string, string>;
	try {
		vars = parseDevVars(readFileSync(file, "utf8"));
	} catch {
		return [];
	}
	const applied: string[] = [];
	for (const [key, value] of Object.entries(vars)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
			applied.push(key);
		}
	}
	return applied;
};
