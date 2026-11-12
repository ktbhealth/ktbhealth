import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Badge } from "@ktbhealth/ui/components/badge";
import { Button } from "@ktbhealth/ui/components/button";
import { Checkbox } from "@ktbhealth/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@ktbhealth/ui/components/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@ktbhealth/ui/components/alert-dialog";
import { Field, FieldDescription, FieldLabel } from "@ktbhealth/ui/components/field";
import { Input } from "@ktbhealth/ui/components/input";
import { PageContainer } from "@ktbhealth/ui/components/page-container";
import { PageHeader } from "@ktbhealth/ui/components/page-header";
import { Spinner } from "@ktbhealth/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";
import { Textarea } from "@ktbhealth/ui/components/textarea";

import { createPageFn, deletePageFn, updatePageFn } from "../fns.ts";
import { pagesMessages } from "../i18n.ts";

/** Row shape the panel loader hands down — the `custom_pages` record
 * narrowed to the fields the console edits (timestamps unused). */
export interface AdminPageRow {
	readonly id: number;
	readonly path: string;
	readonly title: string;
	readonly content: string;
	readonly published: boolean;
	readonly showInNav: boolean;
	readonly sortOrder: number;
}

export interface PagesAdminPageProps {
	readonly pages: readonly AdminPageRow[];
	readonly locale?: string;
}

interface FormState {
	readonly id: number | null;
	readonly path: string;
	readonly title: string;
	readonly content: string;
	readonly published: boolean;
	readonly showInNav: boolean;
	readonly sortOrder: string;
}

const EMPTY_FORM: FormState = {
	id: null,
	path: "",
	title: "",
	content: "",
	published: false,
	showInNav: false,
	sortOrder: "0",
};

const formFrom = (row: AdminPageRow | null): FormState =>
	row === null
		? /* v8 ignore next -- formFrom is only invoked with a table row */ EMPTY_FORM
		: {
				id: row.id,
				path: row.path,
				title: row.title,
				content: row.content,
				published: row.published,
				showInNav: row.showInNav,
				sortOrder: String(row.sortOrder),
			};

const toInput = (form: FormState) => ({
	path: form.path,
	title: form.title,
	content: form.content,
	published: form.published,
	showInNav: form.showInNav,
	sortOrder: Number(form.sortOrder) || 0,
});

/**
 * /platform/pages console view (T-083): CRUD over the `custom_pages`
 * table. Published pages render publicly through the wildcard `pages`
 * descriptor; `showInNav` pages join the app-header nav. Mutations go
 * through the plugin's admin-gated server fns; the loader re-runs via
 * `router.invalidate()` after each write.
 */
export function PagesAdminPage({ pages, locale }: PagesAdminPageProps) {
	const t = pagesMessages(locale);
	const router = useRouter();
	const [form, setForm] = useState<FormState | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<AdminPageRow | null>(null);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);

	const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
		setForm((f) =>
			f === null
				? /* v8 ignore next -- the inputs only exist while the form dialog is open */ f
				: { ...f, [key]: value },
		);

	const save = async () => {
		/* v8 ignore next -- the save action only exists while the form dialog is open */
		if (form === null) return;
		setBusy(true);
		setFailed(false);
		try {
			const input = toInput(form);
			const ok =
				form.id === null
					? await createPageFn({ data: input })
					: await updatePageFn({ data: { id: form.id, ...input } });
			if (ok !== null) {
				setForm(null);
				await router.invalidate();
			} else {
				setFailed(true);
			}
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		/* v8 ignore next -- the delete action only exists while the confirm dialog is open */
		if (deleteTarget === null) return;
		setBusy(true);
		setFailed(false);
		try {
			const ok = await deletePageFn({ data: { id: deleteTarget.id } });
			if (ok) await router.invalidate();
			else setFailed(true);
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
			setDeleteTarget(null);
		}
	};

	return (
		<PageContainer>
			<PageHeader
				title={t.title}
				description={t.description}
				actions={
					<Button size="sm" onClick={() => setForm(EMPTY_FORM)}>
						<PlusIcon className="size-4" />
						{t.newPage}
					</Button>
				}
			/>
			{failed ? <p className="text-sm text-destructive">{t.saveFailed}</p> : null}
			{pages.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
					<p className="text-sm font-medium">{t.emptyTitle}</p>
					<p className="mt-1 text-sm text-muted-foreground">{t.emptyDescription}</p>
				</div>
			) : (
				<div className="overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t.colPath}</TableHead>
								<TableHead>{t.colTitle}</TableHead>
								<TableHead>{t.colStatus}</TableHead>
								<TableHead>{t.colNav}</TableHead>
								<TableHead>{t.colOrder}</TableHead>
								<TableHead className="text-right">{t.colActions}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pages.map((row) => (
								<TableRow key={row.id}>
									<TableCell className="font-mono text-xs">{row.path}</TableCell>
									<TableCell>{row.title}</TableCell>
									<TableCell>
										<Badge variant={row.published ? "default" : "secondary"}>
											{row.published ? t.statusPublished : t.statusDraft}
										</Badge>
									</TableCell>
									<TableCell>
										<Badge variant={row.showInNav ? "default" : "outline"}>
											{row.showInNav ? t.navShown : t.navHidden}
										</Badge>
									</TableCell>
									<TableCell className="text-muted-foreground">{row.sortOrder}</TableCell>
									<TableCell>
										<div className="flex items-center justify-end gap-1">
											{row.published ? (
												<Link
													to={row.path as "/"}
													className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
													aria-label={t.view}
												>
													<ExternalLinkIcon className="size-4" />
												</Link>
											) : null}
											<Button
												size="sm"
												variant="ghost"
												onClick={() => setForm(formFrom(row))}
												aria-label={t.edit}
											>
												<PencilIcon className="size-4" />
											</Button>
											<Button
												size="sm"
												variant="ghost"
												onClick={() => setDeleteTarget(row)}
												aria-label={t.delete}
											>
												<Trash2Icon className="size-4 text-destructive" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{form?.id === null || form === null ? t.create : t.edit}</DialogTitle>
						<DialogDescription>{t.pathHint}</DialogDescription>
					</DialogHeader>
					{form === null ? null : (
						<div className="flex flex-col gap-4">
							<Field>
								<FieldLabel htmlFor="cp-path">{t.fieldPath}</FieldLabel>
								<Input
									id="cp-path"
									value={form.path}
									onChange={(e) => set("path", e.target.value)}
									placeholder="/about"
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="cp-title">{t.fieldTitle}</FieldLabel>
								<Input
									id="cp-title"
									value={form.title}
									onChange={(e) => set("title", e.target.value)}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="cp-content">{t.fieldContent}</FieldLabel>
								<Textarea
									id="cp-content"
									value={form.content}
									onChange={(e) => set("content", e.target.value)}
									rows={10}
								/>
								<FieldDescription>{t.contentHint}</FieldDescription>
							</Field>
							<div className="flex flex-wrap gap-6">
								<label className="flex items-center gap-2 text-sm">
									<Checkbox
										checked={form.published}
										onCheckedChange={(v) => set("published", v === true)}
									/>
									{t.fieldPublished}
								</label>
								<label className="flex items-center gap-2 text-sm">
									<Checkbox
										checked={form.showInNav}
										onCheckedChange={(v) => set("showInNav", v === true)}
									/>
									{t.fieldShowInNav}
								</label>
								<Field className="w-28">
									<FieldLabel htmlFor="cp-order">{t.fieldSortOrder}</FieldLabel>
									<Input
										id="cp-order"
										type="number"
										value={form.sortOrder}
										onChange={(e) => set("sortOrder", e.target.value)}
									/>
								</Field>
							</div>
						</div>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => setForm(null)} disabled={busy}>
							{t.cancel}
						</Button>
						<Button onClick={() => void save()} disabled={busy}>
							{busy ? <Spinner className="size-4" /> : form?.id === null ? t.create : t.save}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle>
						<AlertDialogDescription>
							{deleteTarget === null ? "" : t.deleteBody(deleteTarget.path)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busy}>{t.cancel}</AlertDialogCancel>
						<AlertDialogAction onClick={() => void remove()} disabled={busy}>
							{busy ? <Spinner className="size-4" /> : t.deleteConfirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageContainer>
	);
}
