// Copies drizzle-kit output (drizzle/*.sql) into alchemy-migrations/ as a
// flat .sql layout that @alchemy.run/sql accepts (drizzle v0 journal layout
// is rejected). Run after `drizzle-kit generate`.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "drizzle");
const dest = join(root, "alchemy-migrations");

mkdirSync(dest, { recursive: true });
for (const f of readdirSync(dest)) rmSync(join(dest, f));
for (const f of readdirSync(src).filter((f) => f.endsWith(".sql"))) {
	copyFileSync(join(src, f), join(dest, f));
}
console.log(`synced ${readdirSync(dest).length} migration(s) -> ${dest}`);
