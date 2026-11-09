import { createFileRoute } from "@tanstack/react-router";

import { plugins } from "#/plugins.ts";

export const Route = createFileRoute("/platform/")({
	component: PlatformOverview,
});

function PlatformOverview() {
	return (
		<div>
			<h1 className="text-2xl font-bold tracking-tight">Platform</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				System console — admin-only. Plugin contributions appear in the sidebar as they declare
				them.
			</p>
			<div className="mt-6 overflow-hidden rounded-lg border border-border">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
							<th className="px-3 py-2 font-medium">Plugin</th>
							<th className="px-3 py-2 font-medium">Id</th>
						</tr>
					</thead>
					<tbody>
						{plugins.map((p) => (
							<tr key={p.id} className="border-b border-border last:border-0">
								<td className="px-3 py-2 font-mono text-xs">{p.id}</td>
								<td className="px-3 py-2 text-muted-foreground">
									{[
										p.routes?.length ? "routes" : null,
										p.nav?.length ? "nav" : null,
										p.panel?.sidebar?.length ? "panel" : null,
										p.tables ? "tables" : null,
										p.services ? "services" : null,
									]
										.filter(Boolean)
										.join(", ") || "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
