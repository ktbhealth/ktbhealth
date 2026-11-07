import * as Cloudflare from "@alchemy.run/cloudflare";
import type { Providers } from "@alchemy.run/cloudflare";
import type { Output } from "alchemy";
import * as Effect from "effect/Effect";
import type { DeployD1, DeployedWorker, DeployStaticSite, DeployWorker } from "./ports.ts";

export const cloudflareStaticSite: DeployStaticSite<Output<string | undefined>, Providers> = (
	spec,
) =>
	Effect.gen(function* () {
		const site = yield* Cloudflare.Website.StaticSite(spec.name, {
			command: spec.command,
			outdir: spec.outdir,
		});
		return { url: site.url };
	});

export const cloudflareWorker: DeployWorker<Output<string | undefined>, Providers> = (spec) =>
	Effect.gen(function* () {
		const site = yield* Cloudflare.Website.StaticSite(spec.name, {
			command: spec.command,
			outdir: spec.outdir,
			main: spec.main,
			compatibilityFlags: spec.compatibilityFlags,
			...spec.bindings,
		} as Parameters<typeof Cloudflare.Website.StaticSite>[1]);
		return { url: site.url };
	}) as Effect.Effect<DeployedWorker<Output<string | undefined>>, never, Providers>;

export const cloudflareD1: DeployD1<Cloudflare.D1.Database, Providers> = (spec) =>
	Effect.gen(function* () {
		const db = yield* Cloudflare.D1.Database(spec.name, {
			migrations: spec.migrationsDir,
		});
		return { db };
	});
