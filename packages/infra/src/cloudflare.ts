import * as Cloudflare from "@alchemy.run/cloudflare";
import type { Providers } from "@alchemy.run/cloudflare";
import type { Output } from "alchemy";
import * as Effect from "effect/Effect";
import type { DeployD1, DeployStaticSite, DeployWorker } from "./ports.ts";

export const cloudflareStaticSite: DeployStaticSite<
	Output<string | undefined>,
	Providers
> = Effect.fnUntraced(function* (spec) {
	const site = yield* Cloudflare.Website.StaticSite(spec.name, {
		command: spec.command,
		outdir: spec.outdir,
	});
	return { url: site.url };
});

export const cloudflareWorker: DeployWorker<
	Output<string | undefined>,
	Providers
> = Effect.fnUntraced(function* (spec) {
	const site = yield* Cloudflare.Website.StaticSite(spec.name, {
		command: spec.command,
		outdir: spec.outdir,
		main: spec.main,
		env: spec.bindings as Cloudflare.Workers.WorkerBindingProps | undefined,
		compatibility: spec.compatibilityFlags?.length
			? { flags: [...spec.compatibilityFlags] }
			: undefined,
	});
	return { url: site.url };
});

export const cloudflareD1: DeployD1<Cloudflare.D1.Database, Providers> = Effect.fnUntraced(
	function* (spec) {
		const db = yield* Cloudflare.D1.Database(spec.name, {
			migrations: spec.migrationsDir,
		});
		return { db };
	},
);
