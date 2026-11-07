// Provider seam: swap these bindings (or add env-based selection) when a
// second provider lands. Cloudflare Workers is the first implementation.
export type {
	DeployD1,
	DeployedD1,
	DeployedSite,
	DeployedWorker,
	DeployStaticSite,
	DeployWorker,
	D1Spec,
	StaticSiteSpec,
	WorkerSpec,
} from "./ports.ts";
export {
	cloudflareD1 as deployD1,
	cloudflareStaticSite as deployStaticSite,
	cloudflareWorker as deployWorker,
} from "./cloudflare.ts";
