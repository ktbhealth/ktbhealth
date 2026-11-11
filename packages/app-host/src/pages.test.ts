import { describe, expect, it, vi } from "vitest";
import type { Page, Plugin } from "@ktb/kernel";

import { collectPages, defaultPageContext, isConsolePath } from "./pages.ts";

const Page = () => null;

const pagePlugin = (id: string, pages: Page[]): Plugin => ({ id, pages });
const panelPlugin = (id: string, path: string): Plugin => ({
	id,
	panel: { pages: [{ id: `${id}.page`, path, component: Page }] },
});

describe("isConsolePath / defaultPageContext", () => {
	it("treats /platform and its descendants as console", () => {
		expect(isConsolePath("/platform")).toBe(true);
		expect(isConsolePath("/platform/patients")).toBe(true);
		expect(isConsolePath("/platformx")).toBe(false);
		expect(isConsolePath("/about")).toBe(false);
		expect(defaultPageContext("/platform/x")).toBe("console");
		expect(defaultPageContext("/about")).toBe("app");
	});
});

describe("collectPages", () => {
	it("merges panel.pages (console) and pages contributions into one registry", () => {
		const reg = collectPages([
			panelPlugin("a.panel", "/platform"),
			pagePlugin("b.pages", [
				{ id: "b.about", path: "/about", component: Page },
				{ id: "b.console", path: "/platform/custom", component: Page, context: "console" },
			]),
		]);
		expect(reg.pages.size).toBe(3);
		expect(reg.consolePages.get("/platform")?.pluginId).toBe("a.panel");
		expect(reg.consolePages.get("/platform/custom")?.context).toBe("console");
		expect(reg.appPages.get("/about")?.pluginId).toBe("b.pages");
		expect(reg.appPages.has("/platform/custom")).toBe(false);
		expect(reg.consolePages.has("/about")).toBe(false);
	});

	it("derives context from the path when undeclared", () => {
		const reg = collectPages([
			pagePlugin("x", [
				{ id: "x.a", path: "/platform/deep", component: Page },
				{ id: "x.b", path: "/status", component: Page },
			]),
		]);
		expect(reg.consolePages.has("/platform/deep")).toBe(true);
		expect(reg.appPages.has("/status")).toBe(true);
	});

	it("first contributor in topo order wins path conflicts and warns", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const reg = collectPages([
				pagePlugin("first", [{ id: "f", path: "/about", component: Page }]),
				pagePlugin("second", [{ id: "s", path: "/about", component: Page }]),
				panelPlugin("third.panel", "/about"),
			]);
			expect(reg.pages.size).toBe(1);
			expect(reg.pages.get("/about")?.pluginId).toBe("first");
			expect(warn).toHaveBeenCalledTimes(2);
		} finally {
			warn.mockRestore();
		}
	});

	it("ignores app-context pages claiming /platform paths", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const reg = collectPages([
				pagePlugin("bad", [
					{ id: "bad", path: "/platform/secret", component: Page, context: "app" },
				]),
			]);
			expect(reg.pages.size).toBe(0);
			expect(warn).toHaveBeenCalledOnce();
		} finally {
			warn.mockRestore();
		}
	});

	it("stays silent outside dev", () => {
		vi.stubEnv("DEV", false);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const reg = collectPages([
				pagePlugin("first", [{ id: "f", path: "/about", component: Page }]),
				pagePlugin("second", [{ id: "s", path: "/about", component: Page }]),
			]);
			// First-wins still applies — only the warning is dev-gated.
			expect(reg.pages.get("/about")?.pluginId).toBe("first");
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
			vi.unstubAllEnvs();
		}
	});

	it("ignores console-context pages outside /platform (unreachable)", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const reg = collectPages([
				pagePlugin("odd", [{ id: "odd", path: "/nowhere", component: Page, context: "console" }]),
			]);
			expect(reg.pages.size).toBe(0);
			expect(reg.consolePages.has("/nowhere")).toBe(false);
			expect(reg.appPages.has("/nowhere")).toBe(false);
			expect(warn).toHaveBeenCalledOnce();
		} finally {
			warn.mockRestore();
		}
	});
});
