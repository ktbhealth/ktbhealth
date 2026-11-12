import { plugins as consultationsPlugins } from "@ktb/consultations";
import { plugins as doctorsPlugins } from "@ktb/doctors";
import { plugins as jobsPlugins } from "@ktb/jobs";
import { plugins as notificationsPlugins } from "@ktb/notifications";
import { plugins as patientAccessPlugins } from "@ktb/patient-access";
import { plugins as patientPortalPlugins } from "@ktb/patient-portal";
import { plugins as patientsPlugins } from "@ktb/patients";
import { plugins as platformPlugins } from "@ktb/platform";
import { plugins as secretariesPlugins } from "@ktb/secretaries";
import { index, physical, rootRoute, route } from "@tanstack/virtual-file-routes";

// Route-tree composition runs under jiti during typegen, where
// import.meta.glob (used by @ktb/app-host plugin discovery) is unavailable —
// so plugin entries are imported statically here instead of via `plugins`.
const routePlugins = [
	...consultationsPlugins,
	...doctorsPlugins,
	...jobsPlugins,
	...notificationsPlugins,
	...patientAccessPlugins,
	...patientPortalPlugins,
	...patientsPlugins,
	...platformPlugins,
	...secretariesPlugins,
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
	route("login", "login.tsx"),
	route("portal/login", "portal-login.tsx"),
	route("verify-email", "verify-email.tsx"),
	physical("/api", "api"),
]);
