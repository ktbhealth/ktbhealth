// Client registry collections (@ktb/app-host/client): the discovered
// plugin list plus everything derived from it — page maps, chrome
// helpers and enabled-state filters. Re-exported here so routes and
// server fns keep a single app-bound import path; this file is the
// documented @ktb/app-host exception in vite.config.ts (same role
// #/plugins.ts plays for the raw registry).
export {
	appPages,
	collectChrome,
	consolePages,
	defaultPageContext,
	enabledIdSet,
	enabledPlugins,
	findPage,
	KNOWN_CHROME_REGIONS,
	packageEnabled,
	warnUnknownChromeRegions,
} from "@ktb/app-host/client";
export type { PageShell, PluginStatesResult } from "@ktb/app-host/client";
