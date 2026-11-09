import type { AnyRoute } from "@tanstack/react-router";
// Pulls in @tanstack/start-client-core's `declare module` augmentation
// that adds the `server` route option (SSE/api handlers) to
// FilebaseRouteOptionsInterface — type-only, no runtime import.
import type {} from "@tanstack/react-start";

// Route modules under src/api-routes/** are typechecked inside the host
// app's TS program, where apps/web/src/routeTree.gen.ts augments
// FileRoutesByPath with the full route tree. This package's own program
// does not see that augmentation, so createFileRoute path literals would
// not resolve.
//
// These entries mirror the generated ones for the notifications api
// subtree only. Keep them in sync with the file names under
// src/api-routes/ — the host routeTree.gen.ts remains the source of
// truth at runtime.

declare module "@tanstack/react-router" {
	interface FileRoutesByPath {
		"/api/notifications": {
			id: "/api/notifications";
			path: "/api/notifications";
			fullPath: "/api/notifications";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
	}
}
