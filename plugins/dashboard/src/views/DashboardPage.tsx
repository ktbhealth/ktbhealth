import type { AdminConsultationRow } from "@ktb/consultations";
import type { Plugin } from "@ktb/kernel";
import type { AdminPatientRow } from "@ktb/patients";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

const fmtDate = (d: Date) => d.toLocaleString();

const contributions = (p: Plugin) =>
	[
		p.routes?.length ? "routes" : null,
		p.landingNav?.length ? "landing-nav" : null,
		p.landing ? "landing" : null,
		p.landingFooter?.blocks.length ? "landing-footer" : null,
		p.panel?.sidebar?.length ? "panel" : null,
		p.tables !== undefined ? "tables" : null,
		p.services !== undefined ? "services" : null,
	]
		.filter(Boolean)
		.join(", ") || "—";

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border border-border px-3 py-2.5">
			<div className="text-[10px] tracking-widest text-muted-foreground uppercase">{label}</div>
			<div className="mt-1 text-2xl font-bold">{value}</div>
		</div>
	);
}

/**
 * /platform landing view — system overview for platform admins: headline
 * counts, latest consultations, and the plugin registry. Dense by
 * design.
 */
export function DashboardPage({
	patients,
	consultations,
	plugins,
}: {
	patients: AdminPatientRow[];
	consultations: AdminConsultationRow[];
	plugins: readonly Plugin[];
}) {
	const recent = consultations.slice(0, 8);
	const sidebarItems = plugins.reduce((n, p) => n + (p.panel?.sidebar?.length ?? 0), 0);
	return (
		<div>
			<h1 className="text-lg font-bold tracking-tight">dashboard</h1>
			<p className="mt-1 text-xs text-muted-foreground">
				System overview — aggregated across plugins.
			</p>

			<div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Stat label="Patients" value={patients.length} />
				<Stat label="Consultations" value={consultations.length} />
				<Stat label="Plugins" value={plugins.length} />
				<Stat label="Sidebar items" value={sidebarItems} />
			</div>

			<div className="mt-6 grid gap-6 lg:grid-cols-2">
				<section>
					<h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
						Recent consultations
					</h2>
					{recent.length === 0 ? (
						<p className="mt-2 text-xs text-muted-foreground">No consultations yet.</p>
					) : (
						<div className="mt-2 overflow-hidden rounded-lg border border-border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-12">Id</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Source</TableHead>
										<TableHead>Owner</TableHead>
										<TableHead className="text-right">Created</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{recent.map((c) => (
										<TableRow key={c.id}>
											<TableCell className="text-xs text-muted-foreground">{c.id}</TableCell>
											<TableCell className="font-medium">{c.status}</TableCell>
											<TableCell className="text-muted-foreground">{c.source}</TableCell>
											<TableCell>{c.ownerName ?? c.ownerEmail ?? "—"}</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{fmtDate(c.createdAt)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</section>

				<section>
					<h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
						Registered plugins
					</h2>
					<div className="mt-2 overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Id</TableHead>
									<TableHead>Contributions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{plugins.map((p) => (
									<TableRow key={p.id}>
										<TableCell className="text-xs">{p.id}</TableCell>
										<TableCell className="text-muted-foreground">{contributions(p)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</section>
			</div>
		</div>
	);
}
