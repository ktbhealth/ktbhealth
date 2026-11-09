import type { AnyRoute } from "@tanstack/react-router";

// Route modules under src/routes/** are typechecked inside the host app's
// TS program, where apps/web/src/routeTree.gen.ts augments
// FileRoutesByPath with the full route tree. This package's own program
// (and any standalone check of these files) does not see that
// augmentation, so createFileRoute path literals would not resolve.
//
// These entries mirror the generated ones for the patients subtree only.
// Keep them in sync with the file names under src/routes/ — the host
// routeTree.gen.ts remains the source of truth at runtime.

declare module "@tanstack/react-router" {
	interface FileRoutesByPath {
		"/patients/": {
			id: "/patients/";
			path: "/patients";
			fullPath: "/patients/";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/patients/new": {
			id: "/patients/new";
			path: "/patients/new";
			fullPath: "/patients/new";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/patients/$id/": {
			id: "/patients/$id/";
			path: "/patients/$id";
			fullPath: "/patients/$id/";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/patients/$id/edit": {
			id: "/patients/$id/edit";
			path: "/patients/$id/edit";
			fullPath: "/patients/$id/edit";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
	}
}
