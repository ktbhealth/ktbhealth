import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle",
	schema: "./src/schema.ts",
	dialect: "sqlite",
	// Local browse DB for `db:studio` — materialized from migrations by
	// scripts/local-studio-db.mjs. Not used by generate/migrate.
	dbCredentials: { url: process.env.STUDIO_DB ?? ".studio.sqlite" },
});
