import type { AdminConsultationRow } from "@ktb/consultations";
import type { Plugin } from "@ktb/kernel";
import type { ConsoleNotification } from "@ktb/notifications/context";
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
 * counts, latest consultations, the plugin registry, and (when the
 * notifications backend is registered) a console-activity card with the
 * unread count and the caller's most recent notifications. Dense by
 * design.
 */
export function DashboardPage({
	patients,
	consultations,
	plugins,
	notifications,
	unreadCount = 0,
}: {
	patients: AdminPatientRow[];
	consultations: AdminConsultationRow[];
	plugins: readonly Plugin[];
	/** Session user's recent notifications — `undefined` hides the
	 * console-activity card entirely (backend plugin not registered). */
	notifications?: readonly ConsoleNotification[];
	unreadCount?: number;
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

			{notifications !== undefined ? (
				<section className="mt-6">
					<h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
						Console activity
					</h2>
					<div className="mt-2 max-w-md rounded-lg border border-border px-3 py-2.5">
						<div className="flex items-baseline justify-between">
							<span className="text-[10px] tracking-widest text-muted-foreground uppercase">
								Unread notifications
							</span>
							<span className="text-lg font-bold">{unreadCount}</span>
						</div>
						{notifications.length === 0 ? (
							<p className="mt-2 text-xs text-muted-foreground">No notifications yet.</p>
						) : (
							<ul className="mt-1 divide-y divide-border">
								{notifications.slice(0, 5).map((n) => (
									<li key={n.id} className="flex gap-2.5 py-2">
										<span
											className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
												n.read ? "bg-transparent" : "bg-primary"
											}`}
										/>
										<div className="min-w-0">
											<p className="truncate text-sm">{n.title}</p>
											{n.description ? (
												<p className="truncate text-xs text-muted-foreground">{n.description}</p>
											) : null}
											{n.meta ? (
												<p className="mt-0.5 text-[11px] text-muted-foreground/70">{n.meta}</p>
											) : null}
										</div>
									</li>
								))}
							</ul>
						)}
					</div>
				</section>
			) : null}
		</div>
	);
}
