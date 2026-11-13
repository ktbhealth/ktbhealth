import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/health — liveness probe. Process is up and serving; no
 * dependency checks (a sick dependency shouldn't kill the pod/worker —
 * that's what /api/ready is for).
 */
function handle() {
	return Response.json({ status: "ok" });
}

export const Route = createFileRoute("/api/health")({
	server: { handlers: { GET: handle } },
});
