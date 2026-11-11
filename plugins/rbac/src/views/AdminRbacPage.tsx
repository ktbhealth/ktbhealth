import { useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@ktbhealth/ui/components/badge";
import { Button } from "@ktbhealth/ui/components/button";
import { Input } from "@ktbhealth/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ktbhealth/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";

import type { AdminRbacPageData, AssignmentRow, RoleDetailWire } from "../index.ts";
import {
	assignSubjectFn,
	createRoleFn,
	deleteRoleFn,
	revokeRolePermissionFn,
	setRolePermissionFn,
	unassignSubjectFn,
} from "../fns.ts";
import { rbacMessages } from "../i18n.ts";

const inputCls =
	"h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring";

const permKey = (resource: string, action: string) => `${resource}.${action}`;

const KIND_ITEMS = [
	{ value: "user", label: "user" },
	{ value: "group", label: "group" },
] as const;

/**
 * /platform/roles console (P-054): role list + create/delete, a
 * permission-matrix editor per role (cycle none → allow → deny → none),
 * and subject assignments (user/group × role, optional tenant scope and
 * expiry). Mutations go through the plugin's server fns; the loader
 * re-runs on `router.invalidate()`.
 */
export function AdminRbacPage({
	data,
	locale = "en",
}: {
	data: AdminRbacPageData;
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = rbacMessages(locale);
	const router = useRouter();
	const [selectedId, setSelectedId] = useState<number | null>(data.roles[0]?.id ?? null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const [newName, setNewName] = useState("");
	const [newDesc, setNewDesc] = useState("");
	const [assign, setAssign] = useState<{
		subjectKind: "user" | "group";
		subjectId: string;
		roleId: string | null;
		tenantId: string;
		expiresAt: string;
	}>({
		subjectKind: "user",
		subjectId: "",
		roleId: null,
		tenantId: "",
		expiresAt: "",
	});

	const detail = useMemo<RoleDetailWire | null>(
		() => data.details.find((d) => d.role.id === selectedId) ?? null,
		[data.details, selectedId],
	);
	const grants = useMemo(() => {
		const m = new Map<string, "allow" | "deny">();
		for (const p of detail?.permissions ?? []) m.set(permKey(p.resource, p.action), p.effect);
		return m;
	}, [detail]);
	// Base UI models "nothing selected" as null — the form state keeps "".
	const roleItems = useMemo(
		() => [
			{ value: null, label: t.selectRole },
			...data.roles.map((r) => ({ value: String(r.id), label: r.name })),
		],
		[data.roles, t.selectRole],
	);

	const run = async (fn: () => Promise<{ ok: boolean }>) => {
		setBusy(true);
		setError(false);
		try {
			const res = await fn();
			if (!res.ok) setError(true);
			await router.invalidate();
		} finally {
			setBusy(false);
		}
	};

	const cycleEffect = (resource: string, action: string) => {
		/* v8 ignore next -- the matrix button only renders when detail is non-null */
		if (!detail) return;
		const key = permKey(resource, action);
		const current = grants.get(key);
		const next = current === undefined ? "allow" : current === "allow" ? "deny" : undefined;
		void run(() =>
			next === undefined
				? revokeRolePermissionFn({
						data: { roleId: detail.role.id, resource, action },
					})
				: setRolePermissionFn({
						data: { roleId: detail.role.id, resource, action, effect: next },
					}),
		);
	};

	const fmtDate = (d: Date | string | null) =>
		d === null ? t.neverExpires : new Date(d).toLocaleString(locale);

	return (
		<div className="space-y-8">
			<div>
				<h1 className="text-lg font-bold tracking-tight">{t.title}</h1>
				<p className="mt-1 text-xs text-muted-foreground">{t.subtitle}</p>
			</div>
			{error ? <p className="text-xs text-destructive">{t.saveError}</p> : null}

			<section>
				<h2 className="text-sm font-semibold">{t.rolesTitle}</h2>
				<form
					className="mt-2 flex items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (newName.trim() === "") return;
						void run(async () => {
							const res = await createRoleFn({
								data: { name: newName.trim(), description: newDesc.trim() || null },
							});
							if (res.ok) {
								setNewName("");
								setNewDesc("");
							}
							return res;
						});
					}}
				>
					<Input
						className={inputCls}
						placeholder={t.roleName}
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
					/>
					<Input
						className={inputCls}
						placeholder={t.roleDescription}
						value={newDesc}
						onChange={(e) => setNewDesc(e.target.value)}
					/>
					<Button type="submit" size="sm" disabled={busy}>
						<PlusIcon className="size-3.5" /> {t.createRole}
					</Button>
				</form>
				{data.roles.length === 0 ? (
					<p className="mt-3 text-xs text-muted-foreground">{t.rolesEmpty}</p>
				) : (
					<div className="mt-3 overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t.roleName}</TableHead>
									<TableHead>{t.roleDescription}</TableHead>
									<TableHead className="text-right">{t.unassign}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.roles.map((r) => (
									<TableRow
										key={r.id}
										data-state={r.id === selectedId ? "selected" : undefined}
										className="cursor-pointer"
										onClick={() => setSelectedId(r.id)}
									>
										<TableCell className="font-medium">{r.name}</TableCell>
										<TableCell className="text-xs text-muted-foreground">
											{r.description ?? "—"}
										</TableCell>
										<TableCell className="text-right">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												disabled={busy}
												onClick={(e) => {
													e.stopPropagation();
													void run(() => deleteRoleFn({ data: { id: r.id } }));
												}}
											>
												<Trash2Icon className="size-3.5" /> {t.deleteRole}
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</section>

			<section>
				<h2 className="text-sm font-semibold">{t.permissionsTitle}</h2>
				{detail === null ? (
					<p className="mt-2 text-xs text-muted-foreground">
						{data.roles.length === 0 ? t.matrixEmpty : t.selectRole}
					</p>
				) : data.catalog.length === 0 ? null : (
					<div className="mt-3 overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t.colPermission}</TableHead>
									<TableHead className="text-right">{t.colEffect}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.catalog.map((c) => {
									const effect = grants.get(c.key);
									return (
										<TableRow key={c.key}>
											<TableCell className="font-mono text-xs">{c.key}</TableCell>
											<TableCell className="text-right">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													disabled={busy}
													onClick={() => cycleEffect(c.resource, c.action)}
												>
													<Badge
														variant={
															effect === "allow"
																? "default"
																: effect === "deny"
																	? "destructive"
																	: "outline"
														}
													>
														{effect === undefined
															? t.effectNone
															: effect === "allow"
																? t.effectAllow
																: t.effectDeny}
													</Badge>
												</Button>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				)}
			</section>

			<section>
				<h2 className="text-sm font-semibold">{t.assignmentsTitle}</h2>
				<form
					className="mt-2 flex flex-wrap items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault();
						if (assign.subjectId.trim() === "" || assign.roleId === null) return;
						void run(() =>
							assignSubjectFn({
								data: {
									subjectKind: assign.subjectKind,
									subjectId: assign.subjectId.trim(),
									roleId: Number(assign.roleId),
									tenantId: assign.tenantId.trim() === "" ? null : assign.tenantId.trim(),
									expiresAt:
										assign.expiresAt === "" ? null : new Date(assign.expiresAt).toISOString(),
								},
							}),
						);
					}}
				>
					<Select
						items={KIND_ITEMS}
						value={assign.subjectKind}
						onValueChange={(v) => setAssign({ ...assign, subjectKind: v as "user" | "group" })}
					>
						<SelectTrigger aria-label={t.subjectKind} className="h-8 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{KIND_ITEMS.map((item) => (
								<SelectItem key={item.value} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						className={inputCls}
						placeholder={t.subjectId}
						value={assign.subjectId}
						onChange={(e) => setAssign({ ...assign, subjectId: e.target.value })}
					/>
					<Select
						items={roleItems}
						value={assign.roleId}
						onValueChange={(v) => setAssign({ ...assign, roleId: v })}
					>
						<SelectTrigger aria-label={t.colRole} className="h-8 max-w-56 text-xs">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{roleItems.map((item) => (
								<SelectItem key={item.value ?? ""} value={item.value}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						className={inputCls}
						placeholder={t.tenantId}
						value={assign.tenantId}
						onChange={(e) => setAssign({ ...assign, tenantId: e.target.value })}
					/>
					<Input
						className={inputCls}
						type="datetime-local"
						value={assign.expiresAt}
						onChange={(e) => setAssign({ ...assign, expiresAt: e.target.value })}
						aria-label={t.expiresAt}
					/>
					<Button type="submit" size="sm" disabled={busy}>
						{t.assignSubject}
					</Button>
				</form>
				{data.assignments.length === 0 ? (
					<p className="mt-3 text-xs text-muted-foreground">{t.assignmentsEmpty}</p>
				) : (
					<div className="mt-3 overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t.colSubject}</TableHead>
									<TableHead>{t.colSubjectId}</TableHead>
									<TableHead>{t.colRole}</TableHead>
									<TableHead>{t.colTenant}</TableHead>
									<TableHead>{t.colExpires}</TableHead>
									<TableHead>{t.colGrantedBy}</TableHead>
									<TableHead className="text-right">{t.unassign}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.assignments.map((a: AssignmentRow) => (
									<TableRow key={a.id}>
										<TableCell>
											<Badge variant="outline">{a.subjectKind}</Badge>
										</TableCell>
										<TableCell className="font-mono text-xs">{a.subjectId}</TableCell>
										<TableCell>{a.roleName}</TableCell>
										<TableCell className="text-xs">{a.tenantId ?? t.globalTenant}</TableCell>
										<TableCell className="text-xs">{fmtDate(a.expiresAt)}</TableCell>
										<TableCell className="text-xs text-muted-foreground">
											{a.grantedBy ?? "—"}
										</TableCell>
										<TableCell className="text-right">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												disabled={busy}
												onClick={() => void run(() => unassignSubjectFn({ data: { id: a.id } }))}
											>
												{t.unassign}
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</section>
		</div>
	);
}
