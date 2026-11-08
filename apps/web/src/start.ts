import { createMiddleware, createStart } from "@tanstack/react-start";
import {
	getServerAsyncLocalStorage,
	overwriteServerAsyncLocalStorage,
} from "#/paraglide/runtime.js";
import { requestLocale } from "#/lib/i18n.ts";

// Runs every request inside paraglide's AsyncLocalStorage so getLocale()
// resolves the ktb-locale cookie during SSR — the cookie strategy cannot
// read request headers without it (paraglideMiddleware equivalent for
// TanStack Start's request-middleware pipeline).
const localeMiddleware = createMiddleware().server(async ({ request, next }) => {
	const locale = requestLocale(request);
	let als = getServerAsyncLocalStorage();
	if (!als) {
		const { AsyncLocalStorage } = await import("node:async_hooks");
		als = new AsyncLocalStorage();
		overwriteServerAsyncLocalStorage(als);
	}
	return als.run({ locale, origin: new URL(request.url).origin }, () => next());
});

export const startInstance = createStart(() => ({
	requestMiddleware: [localeMiddleware],
}));
