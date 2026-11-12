import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UsersIcon } from "lucide-react";

import { Button } from "@ktbhealth/ui/components/button";
import { ConfirmDialog } from "@ktbhealth/ui/components/confirm-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@ktbhealth/ui/components/dialog";
import { Field, FieldLabel } from "@ktbhealth/ui/components/field";
import { Input } from "@ktbhealth/ui/components/input";
import { DataToolbar } from "@ktbhealth/ui/components/data-toolbar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ktbhealth/ui/components/empty";
import { PageContainer } from "@ktbhealth/ui/components/page-container";
import { PageHeader } from "@ktbhealth/ui/components/page-header";
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

import type { TenantMember, TenantRow } from "../index.ts";
import {
	addTenantMemberFn,
	listTenantMembersFn,
	removeTenantMemberFn,
	setTenantMemberRoleFn,
} from "../fns.ts";
import { tenantMessages, type TenantMessages } from "../i18n.ts";

const SEARCH_CLS = "w-56 sm:w-64";
const inputCls =
	"h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Built-in tenant roles — mirrors `TenantRole` in @ktb/tenant. The
 * stored `group_members.role` is free-form, so a non-standard value is
 * rendered as an extra select option instead of being rewritten. */
const TENANT_ROLES = ["owner", "admin", "member"] as const;
type TenantRoleValue = (typeof TENANT_ROLES)[number];

const isTenantRole = (value: string | null): value is TenantRoleValue =>
	value !== null && (TENANT_ROLES as readonly string[]).includes(value);

const roleItems = (t: TenantMessages) =>
	[
		{ value: "owner", label: t.roleOwner },
		{ value: "admin", label: t.roleAdmin },
		{ value: "member", label: t.roleMember },
	] as const;

/**
 * /platform/tenants console view — cross-owner tenant listing for
 * platform admins. Tenants are groups; this page manages memberships
 * and roles only (group CRUD lives on /platform/groups). Dense/
 * utilitarian by design (system console). Mutations go through the
 * plugin's server fns; the loader re-runs on `router.invalidate()`.
 */
export function AdminTenantsPage({
	tenants,
	locale = "en",
}: {
	tenants: TenantRow[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = tenantMessages(locale);
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	const [q, setQ] = useState("");
	const [membersFor, setMembersFor] = useState<TenantRow | null>(null);
	const needle = q.trim().toLowerCase();
	const shown = useMemo(() => {
		if (needle === "") return tenants;
		return tenants.filter((tenant) =>
			[tenant.name, tenant.slug].filter(Boolean).join(" ").toLowerCase().includes(needle),
		);
	}, [tenants, needle]);

	return (
		<PageContainer>
			<PageHeader
				title={t.title}
				description={tenants.length === 0 ? t.none : t.count(tenants.length)}
			/>
			{tenants.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>{t.emptyTitle}</EmptyTitle>
						<EmptyDescription>{t.emptyDescription}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					<DataToolbar
						search={
							<Input
								type="search"
								value={q}
								onChange={(e) => setQ(e.target.value)}
								placeholder={t.searchPlaceholder}
								aria-label={t.searchLabel}
								className={SEARCH_CLS}
							/>
						}
						resultCount={needle === "" ? undefined : t.filteredCount(shown.length, tenants.length)}
					/>
					<div className="overflow-hidden rounded-lg border border-border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-14">{t.colId}</TableHead>
									<TableHead>{t.colName}</TableHead>
									<TableHead>{t.colSlug}</TableHead>
									<TableHead>{t.colKind}</TableHead>
									<TableHead className="text-right">{t.colMembers}</TableHead>
									<TableHead className="text-right">{t.colCreated}</TableHead>
									<TableHead className="text-right">{t.colActions}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{shown.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className="text-xs text-muted-foreground">
											{t.noMatch}
										</TableCell>
									</TableRow>
								) : (
									shown.map((tenant) => (
										<TableRow key={tenant.id}>
											<TableCell className="text-xs text-muted-foreground">{tenant.id}</TableCell>
											<TableCell className="font-medium">{tenant.name}</TableCell>
											<TableCell className="text-xs">{tenant.slug}</TableCell>
											<TableCell>{tenant.kind}</TableCell>
											<TableCell className="text-right text-xs">{tenant.memberCount}</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{fmtDate(tenant.createdAt)}
											</TableCell>
											<TableCell className="text-right">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => setMembersFor(tenant)}
												>
													<UsersIcon className="size-3.5" /> {t.colMembers}
												</Button>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</>
			)}
			{membersFor !== null ? (
				<TenantMembersDialog
					key={membersFor.id}
					tenant={membersFor}
					t={t}
					onClose={() => setMembersFor(null)}
				/>
			) : null}
		</PageContainer>
	);
}

/** Members dialog — lists user memberships, adds users, changes roles,
 * removes memberships for one tenant. */
function TenantMembersDialog({
	tenant,
	t,
	onClose,
}: {
	tenant: TenantRow;
	t: TenantMessages;
	onClose: () => void;
}) {
	const router = useRouter();
	const [members, setMembers] = useState<TenantMember[] | null>(null);
	const [error, setError] = useState(false);
	const [busy, setBusy] = useState(false);
	const [memberId, setMemberId] = useState("");
	const [role, setRole] = useState<TenantRoleValue>("member");
	const [removing, setRemoving] = useState<TenantMember | null>(null);

	const load = useCallback(async () => {
		const res = await listTenantMembersFn({ data: { tenantId: tenant.id } });
		if (res.ok) {
			setMembers([...res.data]);
		} else {
			setMembers([]);
			setError(true);
		}
	}, [tenant.id]);

	useEffect(() => {
		void load();
	}, [load]);

	const run = async (fn: () => Promise<{ ok: boolean }>) => {
		setBusy(true);
		setError(false);
		try {
			const res = await fn();
			if (!res.ok) setError(true);
			await router.invalidate();
			return res;
		} finally {
			setBusy(false);
		}
	};

	const addMember = async () => {
		const id = memberId.trim();
		if (id === "") return;
		await run(async () => {
			const res = await addTenantMemberFn({
				data: { tenantId: tenant.id, memberId: id, role },
			});
			if (res.ok) setMemberId("");
			await load();
			return res;
		});
	};

	const changeRole = async (target: TenantMember, next: string) => {
		// Only the built-in roles are writable — a stored free-form value
		// is display-only until the admin picks a real tenant role.
		if (!isTenantRole(next)) return;
		if (next === (target.role ?? "member")) return;
		await run(async () => {
			const res = await setTenantMemberRoleFn({
				data: { tenantId: tenant.id, memberId: target.memberId, role: next },
			});
			await load();
			return res;
		});
	};

	const confirmRemove = async (target: TenantMember) => {
		setRemoving(null);
		await run(async () => {
			const res = await removeTenantMemberFn({
				data: { tenantId: tenant.id, memberId: target.memberId },
			});
			await load();
			return res;
		});
	};

	return (
		<>
			<Dialog open onOpenChange={(open) => !open && onClose()}>
				<DialogContent className="max-w-lg">
					<DialogHeader>
						<DialogTitle>{t.membersTitle}</DialogTitle>
						<DialogDescription>
							{tenant.name} · {tenant.slug}
						</DialogDescription>
					</DialogHeader>
					{error ? <p className="text-xs text-destructive">{t.saveError}</p> : null}
					{members === null ? (
						<p className="text-xs text-muted-foreground">{t.membersLoading}</p>
					) : members.length === 0 ? (
						<p className="text-xs text-muted-foreground">{t.membersEmpty}</p>
					) : (
						<div className="max-h-64 overflow-y-auto rounded-lg border border-border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t.colMember}</TableHead>
										<TableHead>{t.colRole}</TableHead>
										<TableHead className="text-right">{t.colActions}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{members.map((m) => {
										// Free-form stored roles outside the built-in
										// set stay selectable-as-current but are not
										// offered as new values.
										const items =
											m.role !== null && !isTenantRole(m.role)
												? [...roleItems(t), { value: m.role, label: m.role }]
												: roleItems(t);
										return (
											<TableRow key={m.id}>
												<TableCell className="font-mono text-xs">{m.memberId}</TableCell>
												<TableCell>
													<Select
														items={items}
														value={m.role ?? "member"}
														onValueChange={(v) => void changeRole(m, v as string)}
														disabled={busy}
													>
														<SelectTrigger
															aria-label={`${t.colRole} ${m.memberId}`}
															className="h-7 w-28 text-xs"
														>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{items.map((item) => (
																<SelectItem key={item.value} value={item.value}>
																	{item.label}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</TableCell>
												<TableCell className="text-right">
													<Button
														type="button"
														variant="ghost"
														size="sm"
														disabled={busy}
														onClick={() => setRemoving(m)}
													>
														{t.removeMember}
													</Button>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					)}
					<form
						className="flex flex-wrap items-end gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							void addMember();
						}}
					>
						<Field className="min-w-40 flex-1">
							<FieldLabel htmlFor="member-id">{t.colMember}</FieldLabel>
							<Input
								id="member-id"
								className={inputCls}
								placeholder={t.memberIdPlaceholder}
								value={memberId}
								onChange={(e) => setMemberId(e.target.value)}
							/>
						</Field>
						<Field className="w-32">
							<FieldLabel htmlFor="member-role">{t.colRole}</FieldLabel>
							<Select
								items={roleItems(t)}
								value={role}
								onValueChange={(v) => setRole(v as TenantRoleValue)}
							>
								<SelectTrigger id="member-role" aria-label={t.colRole} className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{roleItems(t).map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
						<Button type="submit" size="sm" disabled={busy}>
							{t.addMember}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
			{removing !== null ? (
				<ConfirmDialog
					open
					onOpenChange={(open) => {
						/* v8 ignore next -- mounted only while removing; only close events fire */
						if (!open) setRemoving(null);
					}}
					title={t.removeMemberTitle}
					description={t.removeMemberDescription(removing.memberId)}
					confirmLabel={t.removeMember}
					cancelLabel={t.cancel}
					variant="destructive"
					loading={busy}
					onConfirm={() => confirmRemove(removing)}
				/>
			) : null}
		</>
	);
}
