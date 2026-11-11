// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { definePlugin, type Plugin, type PluginId } from "@ktb/kernel";
import { Schema } from "effect";

const invalidate = vi.hoisted(() => vi.fn(async () => {}));
const fns = vi.hoisted(() => ({
	setPluginEnabledFn: vi.fn(),
	setPluginConfigFn: vi.fn(),
	getPluginConfigFn: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate }),
}));
vi.mock("../fns.ts", () => fns);

import { PluginsPage, type PluginStateInfo } from "./PluginsPage.tsx";

declare module "@ktb/kernel" {
	interface PluginRegistry {
		"v.base": true;
		"v.child": true;
		"v.other": true;
		"v.config": true;
	}
}

const dep = (id: string, deps: readonly string[] = []) =>
	definePlugin({ id, requiredDeps: deps as unknown as readonly PluginId[] });

const plugins: readonly Plugin[] = [
	dep("v.base"),
	dep("v.child", ["v.base"]),
	dep("v.other"),
	definePlugin({
		id: "v.config",
		meta: {
			name: "Configurable",
			description: "Has a config schema",
			config: {
				schema: Schema.toJsonSchemaDocument(
					Schema.Struct({
						title: Schema.String.annotate({ title: "Title" }),
						retries: Schema.optionalKey(Schema.Finite).annotate({
							title: "Retries",
							default: 3,
						}),
						verbose: Schema.optionalKey(Schema.Boolean).annotate({
							title: "Verbose",
							default: false,
						}),
						mode: Schema.optionalKey(Schema.Literals(["a", "b"])).annotate({
							title: "Mode",
							default: "a",
						}),
					}),
				),
			},
		},
	}),
];

const statesOf = (entries: Record<string, { enabled: boolean; config?: unknown }>) =>
	new Map<string, PluginStateInfo>(
		Object.entries(entries).map(([pluginId, e]) => [
			pluginId,
			{ pluginId, enabled: e.enabled, config: e.config ?? null },
		]),
	);

const allEnabled = () =>
	statesOf({
		"v.base": { enabled: true },
		"v.child": { enabled: true },
		"v.other": { enabled: true },
		"v.config": { enabled: true, config: { title: "T", retries: 3, verbose: false, mode: "a" } },
	});

beforeEach(() => {
	vi.clearAllMocks();
	fns.setPluginEnabledFn.mockResolvedValue(true);
	fns.setPluginConfigFn.mockResolvedValue(true);
	fns.getPluginConfigFn.mockResolvedValue({ title: "T" });
});

afterEach(cleanup);

describe("PluginsPage", () => {
	it("renders every plugin with name, kinds and enabled status", () => {
		render(<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />);
		expect(screen.getByText("Plugins")).toBeTruthy();
		// The id renders twice per row (name fallback + muted id line).
		expect(screen.getAllByText("v.base").length).toBeGreaterThan(0);
		expect(screen.getByText("Configurable")).toBeTruthy();
		expect(screen.getAllByText("Enabled").length).toBe(plugins.length);
	});

	it("shows disabled state from the loader map", () => {
		const states = allEnabled();
		states.set("v.other", { pluginId: "v.other", enabled: false, config: null });
		render(<PluginsPage plugins={plugins} states={states} locale="en" />);
		expect(screen.getByText("Disabled")).toBeTruthy();
	});

	it("disables a plugin with no dependents directly", async () => {
		const user = userEvent.setup();
		render(<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />);
		// v.other has no dependents → single-id disable, no dialog.
		const switches = screen.getAllByRole("switch");
		await user.click(switches[plugins.findIndex((p) => p.id === "v.other")]);
		expect(fns.setPluginEnabledFn).toHaveBeenCalledWith({
			data: { ids: ["v.other"], enabled: false },
		});
		expect(invalidate).toHaveBeenCalled();
	});

	it("confirms the cascade when dependents exist", async () => {
		const user = userEvent.setup();
		render(<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />);
		const switches = screen.getAllByRole("switch");
		await user.click(switches[plugins.findIndex((p) => p.id === "v.base")]);
		// Dialog lists the dependents; nothing sent yet.
		expect(fns.setPluginEnabledFn).not.toHaveBeenCalled();
		expect(screen.getByText(/This also disables/)).toBeTruthy();
		await user.click(screen.getByText("Disable all"));
		expect(fns.setPluginEnabledFn).toHaveBeenCalledWith({
			data: { ids: ["v.base", "v.child"], enabled: false },
		});
	});

	it("skips the cascade dialog when cascadeConfirm is false", async () => {
		const user = userEvent.setup();
		render(
			<PluginsPage plugins={plugins} states={allEnabled()} locale="en" cascadeConfirm={false} />,
		);
		const switches = screen.getAllByRole("switch");
		await user.click(switches[plugins.findIndex((p) => p.id === "v.base")]);
		expect(fns.setPluginEnabledFn).toHaveBeenCalledWith({
			data: { ids: ["v.base", "v.child"], enabled: false },
		});
	});

	it("refuses to enable a plugin whose required dep is disabled", async () => {
		const user = userEvent.setup();
		const states = allEnabled();
		states.set("v.base", { pluginId: "v.base", enabled: false, config: null });
		states.set("v.child", { pluginId: "v.child", enabled: false, config: null });
		render(<PluginsPage plugins={plugins} states={states} locale="en" />);
		expect(screen.getByText(/Requires v.base to be enabled first/)).toBeTruthy();
		const switches = screen.getAllByRole("switch");
		await user.click(switches[plugins.findIndex((p) => p.id === "v.child")]);
		expect(fns.setPluginEnabledFn).not.toHaveBeenCalled();
	});

	it("enables a plugin when its deps are on", async () => {
		const user = userEvent.setup();
		const states = allEnabled();
		states.set("v.other", { pluginId: "v.other", enabled: false, config: null });
		render(<PluginsPage plugins={plugins} states={states} locale="en" />);
		const switches = screen.getAllByRole("switch");
		await user.click(switches[plugins.findIndex((p) => p.id === "v.other")]);
		expect(fns.setPluginEnabledFn).toHaveBeenCalledWith({
			data: { ids: ["v.other"], enabled: true },
		});
	});

	it("renders the generated config form and saves it", async () => {
		const user = userEvent.setup();
		render(<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />);
		expect(screen.getByText(/^Title/)).toBeTruthy();
		expect(screen.getByText("Retries")).toBeTruthy();
		expect(screen.getByText("Verbose")).toBeTruthy();
		expect(screen.getByText("Mode")).toBeTruthy();
		await user.click(screen.getByText("Save"));
		expect(fns.getPluginConfigFn).toHaveBeenCalledWith({ data: "v.config" });
		expect(fns.setPluginConfigFn).toHaveBeenCalledWith({
			data: {
				pluginId: "v.config",
				config: { title: "T", retries: 3, verbose: false, mode: "a" },
			},
		});
		expect(await screen.findByText("Saved.")).toBeTruthy();
	});

	it("resyncs config fields when the server config changes (post-invalidate)", async () => {
		const user = userEvent.setup();
		const { rerender } = render(
			<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />,
		);
		const title = screen.getByRole("textbox", { name: /^Title/ });
		await user.clear(title);
		await user.type(title, "edited");
		// router.invalidate() → loader returns fresh entries with a new
		// config object: the form must pick up the server values again.
		const states2 = allEnabled();
		states2.set("v.config", {
			pluginId: "v.config",
			enabled: true,
			config: { title: "New", retries: 5, verbose: true, mode: "b" },
		});
		rerender(<PluginsPage plugins={plugins} states={states2} locale="en" />);
		expect(screen.getByDisplayValue("New")).toBeTruthy();
		expect(screen.getByDisplayValue("5")).toBeTruthy();
	});

	it("keeps in-progress edits when invalidate returns identical config", async () => {
		const user = userEvent.setup();
		const { rerender } = render(
			<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />,
		);
		const title = screen.getByRole("textbox", { name: /^Title/ });
		await user.clear(title);
		await user.type(title, "edited");
		// New Map/object identities but identical serialized config —
		// unrelated invalidations must not clobber the draft.
		rerender(<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />);
		expect(screen.getByDisplayValue("edited")).toBeTruthy();
	});

	it("does not coerce a cleared number field to 0 — the key stays unset", async () => {
		const user = userEvent.setup();
		render(<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />);
		const retries = screen.getByRole("spinbutton", { name: /^Retries/ });
		expect((retries as HTMLInputElement).value).toBe("3");
		await user.clear(retries);
		await user.click(screen.getByText("Save"));
		expect(fns.setPluginConfigFn).toHaveBeenCalledWith({
			data: {
				pluginId: "v.config",
				config: { title: "T", verbose: false, mode: "a" },
			},
		});
	});

	it("changes an enum config field through the Select and saves it", async () => {
		const user = userEvent.setup();
		render(<PluginsPage plugins={plugins} states={allEnabled()} locale="en" />);
		// The enum field renders the styled Select: a button trigger that
		// opens a listbox of options.
		await user.click(screen.getByRole("combobox", { name: "Mode" }));
		await user.click(await screen.findByRole("option", { name: "b" }));
		await user.click(screen.getByText("Save"));
		expect(fns.setPluginConfigFn).toHaveBeenCalledWith({
			data: {
				pluginId: "v.config",
				config: { title: "T", retries: 3, verbose: false, mode: "b" },
			},
		});
	});
});
