#!/usr/bin/env bun
/**
 * local-studio-db — materialize `.studio.sqlite` from the Drizzle
 * migrations so `drizzle-kit studio` has a real database to browse.
 * Rebuilds only when a migration is newer than the file.
 */
import Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(PKG, ".studio.sqlite");
const DRIZZLE = join(PKG, "drizzle");

const files = readdirSync(DRIZZLE)
	.filter((f) => f.endsWith(".sql"))
	.sort();
const newest = Math.max(...files.map((f) => statSync(join(DRIZZLE, f)).mtimeMs));

let usable = false;
if (existsSync(DB) && statSync(DB).mtimeMs >= newest) {
	try {
		const probe = new Database(DB, { readonly: true });
		usable =
			probe
				.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
				.get().n > 0;
		probe.close();
	} catch {
		usable = false;
	}
}
if (usable) {
	console.log(`.studio.sqlite is up to date (${files.length} migrations)`);
	process.exit(0);
}

rmSync(DB, { force: true });
const db = new Database(DB);
for (const f of files) db.exec(readFileSync(join(DRIZZLE, f), "utf8"));
db.close();
console.log(`applied ${files.length} migrations → ${DB}`);
