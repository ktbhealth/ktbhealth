// Client registry collections (@ktb/app-host/client): the discovered
// plugin list plus everything derived from it — page maps, chrome
// helpers and enabled-state filters. Re-exported here so routes and
// server fns keep a single app-bound import path; this file is the
// documented @ktb/app-host exception in vite.config.ts (same role
// #/plugins.ts plays for the raw registry).
export {
	appPages,
	chromeWhenMatches,
	collectChrome,
	collectPages,
	consolePages,
	defaultPageContext,
	enabledIdSet,
	enabledPlugins,
	isConsolePath,
	KNOWN_CHROME_REGIONS,
	packageEnabled,
	pages,
	unknownChromeRegions,
	warnUnknownChromeRegions,
} from "@ktb/app-host/client";
export type { PageEntry, PageRegistry, PageShell, PluginStatesResult } from "@ktb/app-host/client";
