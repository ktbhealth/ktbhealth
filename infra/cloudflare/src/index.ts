// Cloudflare implementation of the infra ports (@ktb/infra-ports).
// Swap providers by importing a different adapter package instead.
export {
	cloudflareD1 as deployD1,
	cloudflareStaticSite as deployStaticSite,
	cloudflareWorker as deployWorker,
} from "./cloudflare.ts";
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
} from "@ktb/infra-ports";
