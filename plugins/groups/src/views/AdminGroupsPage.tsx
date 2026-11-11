import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";

import { Badge } from "@ktbhealth/ui/components/badge";
import { Button } from "@ktbhealth/ui/components/button";
import { ConfirmDialog } from "@ktbhealth/ui/components/confirm-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
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

import type { AdminGroupRow, GroupMember } from "../index.ts";
import {
	addGroupMemberFn,
	createGroupFn,
	deleteGroupFn,
	listGroupMembersFn,
	removeGroupMemberFn,
} from "../fns.ts";
import { groupMessages, type GroupMessages } from "../i18n.ts";

const SEARCH_CLS = "w-56 sm:w-64";
const inputCls =
	"h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring";

const MEMBER_KIND_ITEMS = [
	{ value: "user", label: "user" },
	{ value: "group", label: "group" },
] as const;

const EMPTY_FORM = { name: "", slug: "", kind: "", meta: "" };

/**
 * /platform/groups console view — cross-owner group listing for
 * platform admins. Dense/utilitarian by design (system console).
 * Mutations go through the plugin's server fns; the loader re-runs on
 * `router.invalidate()`.
 */
export function AdminGroupsPage({
	groups,
	locale = "en",
}: {
	groups: AdminGroupRow[];
	/** Active UI locale, injected by the host via the panel page ctx. */
	locale?: string;
}) {
	const t = groupMessages(locale);
	const router = useRouter();
	const fmtDate = (d: Date) => d.toLocaleString(locale);
	const [q, setQ] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [membersFor, setMembersFor] = useState<AdminGroupRow | null>(null);
	const [deleting, setDeleting] = useState<AdminGroupRow | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const needle = q.trim().toLowerCase();
	const shown = useMemo(() => {
		if (needle === "") return groups;
		return groups.filter((g) =>
			[g.name, g.slug].filter(Boolean).join(" ").toLowerCase().includes(needle),
		);
	}, [groups, needle]);

	const confirmDelete = async (group: AdminGroupRow) => {
		setBusy(true);
		setError(false);
		try {
			const res = await deleteGroupFn({ data: { id: group.id } });
			if (!res.ok) setError(true);
			await router.invalidate();
		} finally {
			setBusy(false);
		}
	};

	return (
		<PageContainer>
			<PageHeader
				title={t.title}
				description={groups.length === 0 ? t.none : t.count(groups.length)}
				actions={
					<Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
						<PlusIcon className="size-3.5" /> {t.newGroup}
					</Button>
				}
			/>
			{error ? <p className="text-xs text-destructive">{t.saveError}</p> : null}
			{groups.length === 0 ? (
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
						resultCount={needle === "" ? undefined : t.filteredCount(shown.length, groups.length)}
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
									shown.map((g) => (
										<TableRow key={g.id}>
											<TableCell className="text-xs text-muted-foreground">{g.id}</TableCell>
											<TableCell className="font-medium">{g.name}</TableCell>
											<TableCell className="text-xs">{g.slug}</TableCell>
											<TableCell>{g.kind}</TableCell>
											<TableCell className="text-right text-xs">{g.memberCount}</TableCell>
											<TableCell className="text-right text-muted-foreground">
												{fmtDate(g.createdAt)}
											</TableCell>
											<TableCell className="text-right">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => setMembersFor(g)}
												>
													<UsersIcon className="size-3.5" /> {t.colMembers}
												</Button>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={() => setDeleting(g)}
												>
													<Trash2Icon className="size-3.5" /> {t.deleteGroup}
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
			<CreateGroupDialog open={createOpen} onOpenChange={setCreateOpen} t={t} />
			{membersFor !== null ? (
				<GroupMembersDialog
					key={membersFor.id}
					group={membersFor}
					t={t}
					onClose={() => setMembersFor(null)}
				/>
			) : null}
			{deleting !== null ? (
				<ConfirmDialog
					open
					onOpenChange={(open) => {
						/* v8 ignore next -- mounted only while deleting; only close events fire */
						if (!open) setDeleting(null);
					}}
					title={t.deleteGroupTitle}
					description={t.deleteGroupDescription(deleting.name)}
					confirmLabel={t.confirmDelete}
					cancelLabel={t.cancel}
					variant="destructive"
					loading={busy}
					onConfirm={() => confirmDelete(deleting)}
				/>
			) : null}
		</PageContainer>
	);
}

/** Create-group dialog — name/slug/kind are required, meta optional. */
function CreateGroupDialog({
	open,
	onOpenChange,
	t,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	t: GroupMessages;
}) {
	const router = useRouter();
	const [form, setForm] = useState(EMPTY_FORM);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const set = (key: keyof typeof EMPTY_FORM) => (value: string) =>
		setForm((prev) => ({ ...prev, [key]: value }));

	const submit = async () => {
		const name = form.name.trim();
		const slug = form.slug.trim();
		const kind = form.kind.trim();
		const meta = form.meta.trim();
		if (name === "" || slug === "" || kind === "") return;
		setBusy(true);
		setError(false);
		try {
			const res = await createGroupFn({
				data: { name, slug, kind, meta: meta === "" ? null : meta },
			});
			if (!res.ok) {
				setError(true);
				return;
			}
			setForm(EMPTY_FORM);
			onOpenChange(false);
			await router.invalidate();
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t.createTitle}</DialogTitle>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
				>
					<Field>
						<FieldLabel htmlFor="group-name">{t.fieldName}</FieldLabel>
						<Input
							id="group-name"
							className={inputCls}
							placeholder={t.namePlaceholder}
							value={form.name}
							onChange={(e) => set("name")(e.target.value)}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="group-slug">{t.fieldSlug}</FieldLabel>
						<Input
							id="group-slug"
							className={inputCls}
							placeholder={t.slugPlaceholder}
							value={form.slug}
							onChange={(e) => set("slug")(e.target.value)}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="group-kind">{t.fieldKind}</FieldLabel>
						<Input
							id="group-kind"
							className={inputCls}
							placeholder={t.kindPlaceholder}
							value={form.kind}
							onChange={(e) => set("kind")(e.target.value)}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="group-meta">{t.fieldMeta}</FieldLabel>
						<Input
							id="group-meta"
							className={inputCls}
							placeholder={t.metaPlaceholder}
							value={form.meta}
							onChange={(e) => set("meta")(e.target.value)}
						/>
					</Field>
					{error ? <p className="text-xs text-destructive">{t.saveError}</p> : null}
					<DialogFooter>
						<Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
							{t.cancel}
						</Button>
						<Button type="submit" size="sm" disabled={busy}>
							{t.createSubmit}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** Members dialog — lists memberships, adds/removes them for one group. */
function GroupMembersDialog({
	group,
	t,
	onClose,
}: {
	group: AdminGroupRow;
	t: GroupMessages;
	onClose: () => void;
}) {
	const router = useRouter();
	const [members, setMembers] = useState<GroupMember[] | null>(null);
	const [error, setError] = useState(false);
	const [busy, setBusy] = useState(false);
	const [memberKind, setMemberKind] = useState<"user" | "group">("user");
	const [memberId, setMemberId] = useState("");
	const [role, setRole] = useState("");
	const [removing, setRemoving] = useState<GroupMember | null>(null);

	const load = useCallback(async () => {
		const res = await listGroupMembersFn({ data: { groupId: group.id } });
		if (res.ok) {
			setMembers(res.data);
		} else {
			setMembers([]);
			setError(true);
		}
	}, [group.id]);

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
		const r = role.trim();
		await run(async () => {
			const res = await addGroupMemberFn({
				data: {
					groupId: group.id,
					memberKind,
					memberId: id,
					role: r === "" ? null : r,
				},
			});
			if (res.ok) {
				setMemberId("");
				setRole("");
			}
			await load();
			return res;
		});
	};

	const confirmRemove = async (target: GroupMember) => {
		setRemoving(null);
		await run(async () => {
			const res = await removeGroupMemberFn({
				data: {
					groupId: group.id,
					memberKind: target.memberKind,
					memberId: target.memberId,
				},
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
							{group.name} · {group.slug}
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
										<TableHead>{t.memberKindLabel}</TableHead>
										<TableHead>{t.colMember}</TableHead>
										<TableHead>{t.colRole}</TableHead>
										<TableHead className="text-right">{t.colActions}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{members.map((m) => (
										<TableRow key={m.id}>
											<TableCell>
												<Badge variant="outline">{m.memberKind}</Badge>
											</TableCell>
											<TableCell className="font-mono text-xs">{m.memberId}</TableCell>
											<TableCell className="text-xs">{m.role ?? "—"}</TableCell>
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
									))}
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
						<Field className="w-28">
							<FieldLabel htmlFor="member-kind">{t.memberKindLabel}</FieldLabel>
							<Select
								items={MEMBER_KIND_ITEMS}
								value={memberKind}
								onValueChange={(v) => setMemberKind(v as "user" | "group")}
							>
								<SelectTrigger
									id="member-kind"
									aria-label={t.memberKindLabel}
									className="h-8 text-xs"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{MEMBER_KIND_ITEMS.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
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
						<Field className="min-w-32 flex-1">
							<FieldLabel htmlFor="member-role">{t.colRole}</FieldLabel>
							<Input
								id="member-role"
								className={inputCls}
								placeholder={t.rolePlaceholder}
								value={role}
								onChange={(e) => setRole(e.target.value)}
							/>
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
