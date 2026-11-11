import type { PanelPageContext } from "@ktb/kernel";
import type { AudioStorageStats, QueueDepth } from "@ktb/server-fns";

import type { AudioJobRow } from "./jobs.ts";
import { OpsPage } from "./views/OpsPage.tsx";

/** Loader payload for /platform/ops — each section is null when its
 * signal cannot be read (the view renders the unavailable state). */
export interface OpsPageData {
	readonly jobs: readonly AudioJobRow[] | null;
	readonly queue: QueueDepth | null;
	readonly storage: AudioStorageStats | null;
}

/**
 * `panel.pages` component for /platform/ops (T-035): the host
 * dispatcher hands the loader Effect's result as `data`; this wrapper
 * narrows it back into the view's props (the admin gate already ran in
 * the page `guard`, the layout's beforeLoad and inside every service
 * call). `ctx.locale` feeds the view's catalog.
 */
export function OpsPlatformPage({ data, ctx }: { data: unknown; ctx: PanelPageContext }) {
	const d = (data ?? {}) as Partial<OpsPageData>;
	return (
		<OpsPage
			jobs={d.jobs ?? null}
			queue={d.queue ?? null}
			storage={d.storage ?? null}
			locale={ctx.locale}
		/>
	);
}
