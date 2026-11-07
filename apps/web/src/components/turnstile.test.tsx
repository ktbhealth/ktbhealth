// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { render } from "@testing-library/react";

let appendedScript: HTMLScriptElement | null = null;

function captureScripts() {
	appendedScript = null;
	const orig = HTMLHeadElement.prototype.appendChild;
	return vi.spyOn(HTMLHeadElement.prototype, "appendChild").mockImplementation(function (
		this: HTMLHeadElement,
		node: Node,
	) {
		if (node instanceof HTMLScriptElement) appendedScript = node;
		return orig.call(this, node);
	});
}

async function freshTurnstile() {
	vi.resetModules();
	return await import("./turnstile.tsx");
}

afterEach(() => {
	vi.restoreAllMocks();
	delete (window as { turnstile?: unknown }).turnstile;
});

describe("Turnstile", () => {
	it("renders nothing without a site key", async () => {
		const { Turnstile } = await freshTurnstile();
		const { container } = render(createElement(Turnstile, { siteKey: "", onToken: vi.fn() }));
		expect(container.innerHTML).toBe("");
	});

	it("renders widget, wires callbacks and cleans up", async () => {
		const spy = captureScripts();
		const renderMock = vi.fn((_el: HTMLElement, _opts?: Record<string, unknown>) => "widget-1");
		const removeMock = vi.fn();
		(window as { turnstile?: unknown }).turnstile = {
			render: renderMock,
			remove: removeMock,
		};
		const { Turnstile } = await freshTurnstile();
		const onToken = vi.fn();
		const { unmount } = render(createElement(Turnstile, { siteKey: "key-1", onToken }));
		expect(appendedScript).toBeTruthy();
		await act(async () => {
			(appendedScript as unknown as { onload: () => void }).onload();
		});
		expect(renderMock).toHaveBeenCalledWith(
			expect.any(HTMLElement),
			expect.objectContaining({ sitekey: "key-1" }),
		);
		const opts = renderMock.mock.calls[0]![1] as unknown as {
			callback: (t: string) => void;
			"expired-callback": () => void;
			"error-callback": () => void;
		};
		act(() => opts.callback("tok-123"));
		expect(onToken).toHaveBeenCalledWith("tok-123");
		act(() => opts["expired-callback"]());
		expect(onToken).toHaveBeenCalledWith(null);
		act(() => opts["error-callback"]());
		expect(onToken).toHaveBeenCalledWith(null);
		unmount();
		expect(removeMock).toHaveBeenCalledWith("widget-1");
		spy.mockRestore();
	});

	it("reports null token when the script fails to load", async () => {
		captureScripts();
		const { Turnstile } = await freshTurnstile();
		const onToken = vi.fn();
		render(createElement(Turnstile, { siteKey: "key-2", onToken }));
		await act(async () => {
			(appendedScript as unknown as { onerror: () => void }).onerror();
		});
		expect(onToken).toHaveBeenCalledWith(null);
	});

	it("does not render widget when unmounted before script loads", async () => {
		captureScripts();
		const renderMock = vi.fn(() => "w");
		(window as { turnstile?: unknown }).turnstile = { render: renderMock, remove: vi.fn() };
		const { Turnstile } = await freshTurnstile();
		const { unmount } = render(createElement(Turnstile, { siteKey: "key-3", onToken: vi.fn() }));
		unmount();
		await act(async () => {
			(appendedScript as unknown as { onload: () => void }).onload();
		});
		expect(renderMock).not.toHaveBeenCalled();
	});

	it("does not render widget when turnstile api is missing", async () => {
		captureScripts();
		const { Turnstile } = await freshTurnstile();
		const { container } = render(createElement(Turnstile, { siteKey: "key-4", onToken: vi.fn() }));
		expect(container.querySelector("div")).toBeTruthy();
		await act(async () => {
			(appendedScript as unknown as { onload: () => void }).onload();
		});
		// window.turnstile undefined → early return, no crash
	});
});
