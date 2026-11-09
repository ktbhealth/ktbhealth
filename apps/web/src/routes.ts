import { plugins as consultationsPlugins } from "@ktb/consultations";
import { plugins as patientsPlugins } from "@ktb/patients";
import { plugins as platformPlugins } from "@ktb/platform";
import { index, physical, rootRoute, route } from "@tanstack/virtual-file-routes";

// Route-tree composition runs under jiti during typegen, where
// import.meta.glob (used by @ktb/app-host plugin discovery) is unavailable —
// so plugin entries are imported statically here instead of via `plugins`.
const routePlugins = [...consultationsPlugins, ...patientsPlugins, ...platformPlugins];

// Host-composed route tree: host-owned routes plus each plugin's declared
// subtree. Plugin route modules live under src/routes/** because they wire
// plugin views to host server functions (#/lib/fns.ts), which plugins
// cannot import; the plugin owns the route paths, the host owns the binding.
export const routes = rootRoute("__root.tsx", [
	index("index.tsx"),
	...routePlugins.flatMap((p) => p.routes ?? []),
	route("capture-test", "capture-test.tsx"),
	route("login", "login.tsx"),
	physical("/api", "api"),
]);
