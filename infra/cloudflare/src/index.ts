// Cloudflare implementation of the infra ports (@ktb/infra-ports).
// Swap providers by importing a different adapter package instead.
export {
	cloudflareSqlDatabase as deploySqlDatabase,
	cloudflareStaticSite as deployStaticSite,
	cloudflareWorker as deployWorker,
} from "./cloudflare.ts";
export type {
	DeploySqlDatabase,
	DeployedSqlDatabase,
	DeployedSite,
	DeployedWorker,
	DeployStaticSite,
	DeployWorker,
	SqlDatabaseSpec,
	StaticSiteSpec,
	WorkerSpec,
} from "@ktb/infra-ports";
