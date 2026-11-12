import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";

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
import { PageContainer } from "@ktbhealth/ui/components/page-container";
import { PageHeader } from "@ktbhealth/ui/components/page-header";
import { Spinner } from "@ktbhealth/ui/components/spinner";
import { Switch } from "@ktbhealth/ui/components/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@ktbhealth/ui/components/table";
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
import type { Plugin, PluginConfigSchema } from "@ktb/kernel";

import {
	configFormFields,
	contributionKinds,
	disabledClosure,
	missingRequiredDeps,
	pluginDisplayName,
	type ConfigFormField,
} from "../logic.ts";
import { managerMessages } from "../i18n.ts";
import { getPluginConfigFn, setPluginConfigFn, setPluginEnabledFn } from "../fns.ts";

/** Server-resolved state for one plugin (PluginStates.entries row). */
export interface PluginStateInfo {
	readonly pluginId: string;
	readonly enabled: boolean;
	readonly config: unknown;
}

export interface PluginsPageProps {
	/** Full discovered registry — `ctx.plugins` (enabled AND disabled). */
	readonly plugins: readonly Plugin[];
	/** State map keyed by plugin id, from the page loader. */
	readonly states: ReadonlyMap<string, PluginStateInfo>;
	/** Active UI locale injected by the host via the panel page ctx. */
	readonly locale?: string;
	/** When false, disabling skips the cascade confirm dialog (the
	 * plugin's own `meta.config.cascadeConfirm`, dogfooded). */
	readonly cascadeConfirm?: boolean;
}

type RowStatus = "enabled" | "disabled" | "blocked";

const statusOf = (enabled: boolean, missing: readonly string[]): RowStatus => {
	// "Blocked" wins over both: required deps off means the plugin can
	// neither stay meaningfully on nor be (re-)enabled until they are.
	if (missing.length > 0) return "blocked";
	return enabled ? "enabled" : "disabled";
};

const configObject = (config: unknown): Record<string, unknown> =>
	typeof config === "object" && config !== null && !Array.isArray(config)
		? (config as Record<string, unknown>)
		: {};

/**
 * Initial field values from the server-merged config: stored value →
 * schema default → type-appropriate empty. Number fields stay `undefined`
 * (unset) rather than `""`/`0` — an empty input must not coerce to 0 and
 * a missing key lets the server fill the default on save.
 */
const initialFormValues = (fields: readonly ConfigFormField[], config: unknown) => {
	const stored = configObject(config);
	return Object.fromEntries(
		fields.map((f) => [
			f.key,
			stored[f.key] ?? f.default ?? (f.type === "number" ? undefined : ""),
		]),
	);
};

/* v8 ignore next -- configFormFields only emits enum fields with options */
const enumOptions = (field: ConfigFormField): readonly string[] => field.options ?? [];

/* v8 ignore next -- enum values are initialized to a string and only assigned strings */
const enumValue = (values: Record<string, unknown>, key: string): string =>
	String(values[key] ?? "");

/**
 * /platform/plugins console view (P-058): every discovered plugin with
 * its contributions, dep status and runtime state. Toggles cascade
 * through an alertdialog (dependents are disabled together); enables
 * are refused while required deps are off; `meta.config` plugins get a
 * generated settings form.
 */
export function PluginsPage({ plugins, states, locale, cascadeConfirm = true }: PluginsPageProps) {
	const t = managerMessages(locale);
	const router = useRouter();
	const [pendingDisable, setPendingDisable] = useState<readonly string[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(false);

	// Enabled set: the loader's entries cover every registry id; a plugin
	// missing from the map defaults to enabled (no row = enabled).
	const enabledSet = useMemo(() => {
		const set = new Set<string>();
		for (const p of plugins) set.add(p.id);
		for (const [id, info] of states) if (!info.enabled) set.delete(id);
		return set;
	}, [plugins, states]);

	const rows = useMemo(
		() =>
			plugins.map((plugin) => {
				const info = states.get(plugin.id);
				const enabled = enabledSet.has(plugin.id);
				const missing = missingRequiredDeps(plugins, enabledSet, plugin.id);
				return { plugin, info, enabled, missing };
			}),
		[plugins, states, enabledSet],
	);

	const applyEnabled = async (ids: readonly string[], enabled: boolean) => {
		setBusy(true);
		setFailed(false);
		try {
			const ok = await setPluginEnabledFn({ data: { ids: [...ids], enabled } });
			if (ok) await router.invalidate();
			else setFailed(true);
		} catch {
			setFailed(true);
		} finally {
			setBusy(false);
			setPendingDisable(null);
		}
	};

	const onToggle = (plugin: Plugin, enabled: boolean) => {
		if (enabled) {
			// Enable is refused client-side while required deps are off —
			// the row shows "blocked" and names them; no auto-enable.
			const missing = missingRequiredDeps(plugins, enabledSet, plugin.id);
			if (missing.length === 0) void applyEnabled([plugin.id], true);
			return;
		}
		const closure = disabledClosure(plugins, plugin.id);
		if (cascadeConfirm && closure.length > 1) setPendingDisable(closure);
		else void applyEnabled(closure, false);
	};

	const pendingNames = (pendingDisable ?? [])
		.map((id) => pluginDisplayName(plugins.find((p) => p.id === id) ?? { id, meta: undefined }))
		.join(", ");

	/* v8 ignore next -- the dialog action only renders while pendingDisable is set */
	const confirmDisable = () => void applyEnabled(pendingDisable ?? [], false);

	return (
		<PageContainer>
			<PageHeader title={t.title} description={t.description} />
			{failed ? <p className="text-sm text-destructive">{t.configSaveFailed}</p> : null}
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t.empty}</p>
			) : (
				<div className="overflow-hidden rounded-lg border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t.colPlugin}</TableHead>
								<TableHead>{t.colKind}</TableHead>
								<TableHead>{t.colStatus}</TableHead>
								<TableHead className="text-right">{t.colConfig}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map(({ plugin, info, enabled, missing }) => (
								<PluginRow
									key={plugin.id}
									plugin={plugin}
									enabled={enabled}
									missing={missing}
									config={info?.config}
									locale={locale}
									busy={busy}
									t={t}
									onToggle={(next) => onToggle(plugin, next)}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			<AlertDialog
				open={pendingDisable !== null}
				onOpenChange={(open) => !open && setPendingDisable(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t.confirmDisableTitle}</AlertDialogTitle>
						<AlertDialogDescription>{t.confirmDisableBody(pendingNames)}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t.cancel}</AlertDialogCancel>
						<AlertDialogAction onClick={confirmDisable}>{t.confirmDisableAction}</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageContainer>
	);
}

function PluginRow({
	plugin,
	enabled,
	missing,
	config,
	locale,
	busy,
	t,
	onToggle,
}: {
	plugin: Plugin;
	enabled: boolean;
	missing: readonly string[];
	config: unknown;
	locale?: string;
	busy: boolean;
	t: ReturnType<typeof managerMessages>;
	onToggle: (enabled: boolean) => void;
}) {
	const status: RowStatus = statusOf(enabled, missing);
	const name = pluginDisplayName(plugin);
	const kinds = contributionKinds(plugin).join(", ");
	return (
		<>
			<TableRow>
				<TableCell>
					<div className="font-medium">{name}</div>
					<div className="text-xs text-muted-foreground">
						{plugin.id}
						{plugin.meta?.description ? ` — ${plugin.meta.description}` : ""}
					</div>
				</TableCell>
				<TableCell className="text-muted-foreground">{kinds === "" ? "—" : kinds}</TableCell>
				<TableCell>
					<div className="flex items-center gap-2">
						<Switch
							checked={enabled}
							disabled={busy}
							onCheckedChange={onToggle}
							aria-label={name}
						/>
						<Badge variant={status === "enabled" ? "default" : "secondary"}>
							{status === "enabled"
								? t.statusEnabled
								: status === "disabled"
									? t.statusDisabled
									: t.statusBlocked}
						</Badge>
					</div>
					{missing.length > 0 ? (
						<div className="mt-1 text-xs text-muted-foreground">
							{t.blockedHint(missing.join(", "))}
						</div>
					) : null}
				</TableCell>
				<TableCell className="text-right">
					{plugin.meta?.config ? (
						<ConfigForm
							pluginId={plugin.id}
							schema={plugin.meta.config}
							config={config}
							locale={locale}
							t={t}
						/>
					) : (
						<span className="text-xs text-muted-foreground">—</span>
					)}
				</TableCell>
			</TableRow>
		</>
	);
}

/** Generated settings form for `meta.config` plugins: one control per
 * field (string/number → Input, boolean → Switch, enum → Select),
 * saved through `setPluginConfigFn`. */
function ConfigForm({
	pluginId,
	schema,
	config,
	locale,
	t,
}: {
	pluginId: string;
	schema: PluginConfigSchema;
	config: unknown;
	locale?: string;
	t: ReturnType<typeof managerMessages>;
}) {
	const router = useRouter();
	// The JSON-Schema document projects to the flat field list the form
	// renders — derived once per schema (static manifest data).
	const fields = useMemo(() => configFormFields(schema), [schema]);
	const [values, setValues] = useState<Record<string, unknown>>(() =>
		initialFormValues(fields, config),
	);
	const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

	// Resync field state when the server config actually changes —
	// router.invalidate() after a save (or an external write) hands the
	// loader fresh entries, but useState alone would keep stale values.
	// Comparing the serialized config keeps unrelated invalidations from
	// clobbering in-progress edits.
	const configJson = JSON.stringify(config ?? null);
	const syncedJson = useRef(configJson);
	useEffect(() => {
		if (syncedJson.current === configJson) return;
		syncedJson.current = configJson;
		setValues(initialFormValues(fields, config));
		setState("idle");
	}, [configJson, config, fields]);

	const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));

	const save = async () => {
		setState("saving");
		try {
			// Load the freshest merged config first so fields the form
			// doesn't render (added by a newer schema) survive the write.
			const current = configObject(await getPluginConfigFn({ data: pluginId }));
			// `undefined` values mean "unset" — drop them so the merge
			// treats the key as absent and the schema default applies
			// (matching validatePluginConfig's missing-key semantics).
			const merged = Object.fromEntries(
				Object.entries({ ...current, ...values }).filter(([, v]) => v !== undefined),
			);
			const ok = await setPluginConfigFn({ data: { pluginId, config: merged } });
			setState(ok ? "saved" : "failed");
			if (ok) await router.invalidate();
		} catch {
			setState("failed");
		}
	};

	return (
		<div className="flex flex-col items-end gap-2">
			{fields.map((field) => (
				<label key={field.key} className="flex items-center gap-2 text-xs">
					<span>
						{field.label}
						{field.required ? ` (${t.requiredMark})` : ""}
					</span>
					{field.type === "boolean" ? (
						<Switch
							checked={values[field.key] === true}
							onCheckedChange={(v) => set(field.key, v)}
						/>
					) : field.type === "enum" ? (
						<Select
							items={enumOptions(field).map((opt) => ({ value: opt, label: opt }))}
							value={enumValue(values, field.key)}
							onValueChange={(v) => set(field.key, String(v))}
						>
							<SelectTrigger size="sm" aria-label={field.label} className="w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{enumOptions(field).map((opt) => (
									<SelectItem key={opt} value={opt}>
										{opt}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<Input
							type={field.type === "number" ? "number" : "text"}
							value={String(values[field.key] ?? "")}
							onChange={(e) => {
								const raw = e.target.value;
								if (field.type !== "number") {
									set(field.key, raw);
									return;
								}
								// Empty stays unset (never coerces to 0); a non-finite
								// intermediate (e.g. "1e") keeps the previous value.
								setValues((v) => {
									if (raw === "") return { ...v, [field.key]: undefined };
									const n = Number(raw);
									return { ...v, [field.key]: Number.isFinite(n) ? n : v[field.key] };
								});
							}}
							className="h-7 w-40"
						/>
					)}
				</label>
			))}
			<div className="flex items-center gap-2">
				{state === "saved" ? (
					<span className="text-xs text-muted-foreground">{t.configSaved}</span>
				) : null}
				{state === "failed" ? (
					<span className="text-xs text-destructive">{t.configSaveFailed}</span>
				) : null}
				<Button
					size="sm"
					variant="outline"
					disabled={state === "saving"}
					onClick={() => void save()}
				>
					{state === "saving" ? <Spinner className="size-3" /> : t.configSave}
				</Button>
			</div>
		</div>
	);
}
