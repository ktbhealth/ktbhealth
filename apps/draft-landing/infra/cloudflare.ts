import * as Cloudflare from "@alchemy.run/cloudflare";
import type { Providers } from "@alchemy.run/cloudflare";
import type { Output } from "alchemy";
import * as Effect from "effect/Effect";
import type { DeployStaticSite } from "./static-site.ts";

export const cloudflareStaticSite: DeployStaticSite<
	Output<string | undefined>,
	Providers
> = (spec) =>
	Effect.gen(function* () {
		const site = yield* Cloudflare.Website.StaticSite(spec.name, {
			command: spec.command,
			outdir: spec.outdir,
		});
		return { url: site.url };
	});
