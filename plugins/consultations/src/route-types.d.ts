import type { AnyRoute } from "@tanstack/react-router";
// Pulls in @tanstack/start-client-core's `declare module` augmentation
// that adds the `server` route option (api handlers) to
// FilebaseRouteOptionsInterface — type-only, no runtime import.
import type {} from "@tanstack/react-start";

// Route modules under src/routes/** and src/api-routes/** are
// typechecked inside the host app's TS program, where
// apps/web/src/routeTree.gen.ts augments FileRoutesByPath with the full
// route tree. This package's own program (and any standalone check of
// these files) does not see that augmentation, so createFileRoute path
// literals would not resolve.
//
// These entries mirror the generated ones for the consultations subtree
// only. Keep them in sync with the file names under src/routes/ and
// src/api-routes/ — the host routeTree.gen.ts remains the source of
// truth at runtime.

declare module "@tanstack/react-router" {
	interface FileRoutesByPath {
		"/api/consultations/$id/audio": {
			id: "/api/consultations/$id/audio";
			path: "/api/consultations/$id/audio";
			fullPath: "/api/consultations/$id/audio";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/api/consultations/$id/pdf": {
			id: "/api/consultations/$id/pdf";
			path: "/api/consultations/$id/pdf";
			fullPath: "/api/consultations/$id/pdf";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/api/patients/$id/export": {
			id: "/api/patients/$id/export";
			path: "/api/patients/$id/export";
			fullPath: "/api/patients/$id/export";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/api/transcribe": {
			id: "/api/transcribe";
			path: "/api/transcribe";
			fullPath: "/api/transcribe";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/consultations/": {
			id: "/consultations/";
			path: "/consultations";
			fullPath: "/consultations/";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/consultations/new": {
			id: "/consultations/new";
			path: "/consultations/new";
			fullPath: "/consultations/new";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
		"/consultations/$id": {
			id: "/consultations/$id";
			path: "/consultations/$id";
			fullPath: "/consultations/$id";
			preLoaderRoute: AnyRoute;
			parentRoute: AnyRoute;
		};
	}
}
