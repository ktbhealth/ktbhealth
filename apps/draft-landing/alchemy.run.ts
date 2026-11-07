import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { deployStaticSite } from "./infra/index.ts";

export default Alchemy.Stack(
	"ktb",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const site = yield* deployStaticSite({
			name: "draft-landing",
			command: "pnpm build",
			outdir: "dist/client",
		});

		return { url: site.url };
	}),
);
