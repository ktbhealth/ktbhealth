import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import { deployStaticSite } from "@ktb/infra";

export default Alchemy.Stack(
	"ktb-landing",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const site = yield* deployStaticSite({
			name: "draft-landing",
			command: "bun run build",
			outdir: "dist/client",
		});

		return { url: site.url };
	}),
);
