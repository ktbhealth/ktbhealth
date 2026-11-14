import { defineConfig } from "drizzle-kit";

// Local dev only: points Drizzle Studio at the workerd/miniflare D1
// sqlite file (`bun run dev`). The `dev:node` DB is apps/web/data/app.db.
export default defineConfig({
	schema: "./src/schema.ts",
	dialect: "sqlite",
	dbCredentials: {
		url: "file:../../apps/web/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite",
	},
});
