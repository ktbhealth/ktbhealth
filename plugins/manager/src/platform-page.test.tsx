// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PanelPageContext } from "@ktb/kernel";
import type { PluginStateEntry } from "@ktb/platform/plugin-states";

// The view is covered by its own suite — here we only assert the props
// ManagerPage derives (states map, locale, cascadeConfirm).
const seen = vi.hoisted(() => ({ last: undefined as Record<string, unknown> | undefined }));
vi.mock("./views/PluginsPage.tsx", () => ({
	PluginsPage: (props: Record<string, unknown>) => {
		seen.last = props;
		return null;
	},
}));

import { ManagerPage } from "./platform-page.tsx";

const ctx: PanelPageContext = {
	plugins: [],
	locale: "pt-BR",
};

const entry = (pluginId: string, config: unknown): PluginStateEntry => ({
	pluginId,
	enabled: true,
	system: true,
	config,
});

const renderPage = (states: readonly PluginStateEntry[]) =>
	render(<ManagerPage data={{ states }} ctx={ctx} />);

afterEach(() => {
	cleanup();
	seen.last = undefined;
});

describe("ManagerPage", () => {
	it("maps loader entries into a states Map and passes ctx through", () => {
		renderPage([entry("manager.chrome", null), entry("manager.panel", { cascadeConfirm: true })]);
		expect(seen.last?.locale).toBe("pt-BR");
		expect(seen.last?.cascadeConfirm).toBe(true);
		const states = seen.last?.states as Map<string, PluginStateEntry>;
		expect(states.get("manager.chrome")?.enabled).toBe(true);
	});

	it("reads cascadeConfirm=false from the manager.panel stored config", () => {
		renderPage([entry("manager.panel", { cascadeConfirm: false })]);
		expect(seen.last?.cascadeConfirm).toBe(false);
	});

	it("defaults cascadeConfirm to true for missing or malformed configs", () => {
		for (const config of [undefined, null, "yes", [false], { cascadeConfirm: "no" }]) {
			renderPage(config === undefined ? [] : [entry("manager.panel", config)]);
			expect(seen.last?.cascadeConfirm).toBe(true);
			cleanup();
		}
	});
});
