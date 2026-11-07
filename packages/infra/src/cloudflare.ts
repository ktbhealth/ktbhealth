import * as Cloudflare from "@alchemy.run/cloudflare";
import type { Providers } from "@alchemy.run/cloudflare";
import * as Effect from "effect/Effect";
import type { DeployD1, DeployStaticSite, DeployWorker } from "./ports.ts";

/** Repo workflow: bun is the package manager; override per spec if needed. */
const BUILD_COMMAND = "bun run build";

export const cloudflareStaticSite: DeployStaticSite<Providers> = Effect.fnUntraced(
	function* (spec) {
		const site = yield* Cloudflare.Website.StaticSite(spec.name, {
			command: spec.command ?? BUILD_COMMAND,
			outdir: spec.outdir,
		});
		return { url: site.url };
	},
);

export const cloudflareWorker: DeployWorker<Providers> = Effect.fnUntraced(function* (spec) {
	const site = yield* Cloudflare.Website.StaticSite(spec.name, {
		command: spec.command ?? BUILD_COMMAND,
		outdir: spec.outdir,
		main: spec.main,
		env: spec.bindings as Cloudflare.Workers.WorkerBindingProps | undefined,
		compatibility: spec.compatibilityFlags?.length
			? { flags: [...spec.compatibilityFlags] }
			: undefined,
	});
	return { url: site.url };
});

export const cloudflareD1: DeployD1<Providers> = Effect.fnUntraced(function* (spec) {
	const db = yield* Cloudflare.D1.Database(spec.name, {
		migrations: spec.migrationsDir,
	});
	return { db };
});
