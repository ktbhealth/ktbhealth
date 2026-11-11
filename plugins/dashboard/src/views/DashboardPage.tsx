import type { AdminConsultationRow } from "@ktb/consultations";
import type { Plugin } from "@ktb/kernel";
import type { ConsoleNotification } from "@ktb/notifications/context";
import type { AdminPatientRow } from "@ktb/patients";

import { dashboardMessages } from "../i18n.ts";
import { PageContainer } from "@ktbhealth/ui/components/page-container";
import { PageHeader } from "@ktbhealth/ui/components/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

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
	locale = "en",
}: {
	patients: AdminPatientRow[];
	consultations: AdminConsultationRow[];
	plugins: readonly Plugin[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
	/** Session user's recent notifications — `undefined` hides the
	 * console-activity card entirely (backend plugin not registered). */
	notifications?: readonly ConsoleNotification[];
	unreadCount?: number;
}) {
	const t = dashboardMessages(locale);
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	const recent = consultations.slice(0, 8);
	const sidebarItems = plugins.reduce((n, p) => n + (p.panel?.sidebar?.length ?? 0), 0);
	return (
		<PageContainer>
			<PageHeader title={t.title} description={t.subtitle} />

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<Stat label={t.stats.patients} value={patients.length} />
				<Stat label={t.stats.consultations} value={consultations.length} />
				<Stat label={t.stats.plugins} value={plugins.length} />
				<Stat label={t.stats.sidebarItems} value={sidebarItems} />
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				<section>
					<h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
						{t.recentConsultations}
					</h2>
					{recent.length === 0 ? (
						<p className="mt-2 text-xs text-muted-foreground">{t.noConsultations}</p>
					) : (
						<div className="mt-2 overflow-hidden rounded-lg border border-border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-12">{t.colId}</TableHead>
										<TableHead>{t.colStatus}</TableHead>
										<TableHead>{t.colSource}</TableHead>
										<TableHead>{t.colOwner}</TableHead>
										<TableHead className="text-right">{t.colCreated}</TableHead>
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
						{t.registeredPlugins}
					</h2>
					<div className="mt-2 overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t.colId}</TableHead>
									<TableHead>{t.colContributions}</TableHead>
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
				<section>
					<h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
						{t.consoleActivity}
					</h2>
					<div className="mt-2 max-w-md rounded-lg border border-border px-3 py-2.5">
						<div className="flex items-baseline justify-between">
							<span className="text-[10px] tracking-widest text-muted-foreground uppercase">
								{t.unreadNotifications}
							</span>
							<span className="text-lg font-bold">{unreadCount}</span>
						</div>
						{notifications.length === 0 ? (
							<p className="mt-2 text-xs text-muted-foreground">{t.noNotifications}</p>
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
		</PageContainer>
	);
}
