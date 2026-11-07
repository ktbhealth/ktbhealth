import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { deployD1, deployWorker } from "@ktb/infra";

export default Alchemy.Stack(
	"ktb-web",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const { db } = yield* deployD1({
			name: "db",
			migrationsDir: "../../packages/db/drizzle",
		});

		const ai = yield* Cloudflare.Workers.AI().pipe(Effect.provide(Cloudflare.Workers.AIBinding));

		const site = yield* deployWorker({
			name: "web",
			command: "bun run build",
			outdir: "dist/client",
			main: "@tanstack/react-start/server-entry",
			bindings: { DB: db, AI: ai },
			compatibilityFlags: ["nodejs_compat"],
		});

		return { url: site.url };
	}),
);
