import { plugins as authPlugins } from "@ktb/auth-plugin";
import { plugins as consultationsPlugins } from "@ktb/consultations";
import { plugins as doctorsPlugins } from "@ktb/doctors";
import { plugins as jobsPlugins } from "@ktb/jobs";
import { plugins as notificationsPlugins } from "@ktb/notifications";
import { plugins as patientsPlugins } from "@ktb/patients";
import { plugins as platformPlugins } from "@ktb/platform";
import { index, physical, rootRoute, route } from "@tanstack/virtual-file-routes";

// Route-tree composition runs under jiti during typegen, where
// import.meta.glob (used by @ktb/app-host plugin discovery) is unavailable —
// so plugin entries are imported statically here instead of via `plugins`.
const routePlugins = [
	...authPlugins,
	...consultationsPlugins,
	...doctorsPlugins,
	...jobsPlugins,
	...notificationsPlugins,
	...patientsPlugins,
	...platformPlugins,
];

// Host-composed route tree: host-owned routes plus each plugin's declared
// subtree. Self-contained plugins (patients, consultations) contribute
// physical() mounts of their own src/routes directories and reach the app
// runtime through @ktb/server-fns; plugins that still wire host server
// functions keep route modules under src/routes/**.
export const routes = rootRoute("__root.tsx", [
	index("index.tsx"),
	...routePlugins.flatMap((p) => p.routes ?? []),
	route("capture-test", "capture-test.tsx"),
	route("verify-email", "verify-email.tsx"),
	physical("/api", "api"),
	// Root splat (P-059): dispatches plugin-contributed `pages` at
	// arbitrary app paths; static routes above keep match priority.
	route("$", "$.tsx"),
]);
