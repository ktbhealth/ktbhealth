import { useEffect, useRef } from "react";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
	render: (
		el: HTMLElement,
		opts: {
			sitekey: string;
			callback?: (token: string) => void;
			"expired-callback"?: () => void;
			"error-callback"?: () => void;
		},
	) => string;
	remove: (id: string) => void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
	scriptPromise ??= new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = SCRIPT_SRC;
		s.async = true;
		s.defer = true;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error("failed to load turnstile"));
		document.head.appendChild(s);
	});
	return scriptPromise;
}

export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

/** Cloudflare Turnstile widget. Calls onToken with the token, or null on
 * expiry/error. Renders nothing when no site key is configured. */
export function Turnstile({
	siteKey = TURNSTILE_SITE_KEY,
	onToken,
}: {
	siteKey?: string;
	onToken: (token: string | null) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const onTokenRef = useRef(onToken);
	onTokenRef.current = onToken;

	useEffect(() => {
		if (!siteKey) return;
		let widgetId: string | undefined;
		let cancelled = false;
		loadScript()
			.then(() => {
				if (cancelled || !ref.current || !window.turnstile) return;
				widgetId = window.turnstile.render(ref.current, {
					sitekey: siteKey,
					callback: (token) => onTokenRef.current(token),
					"expired-callback": () => onTokenRef.current(null),
					"error-callback": () => onTokenRef.current(null),
				});
			})
			.catch(() => onTokenRef.current(null));
		return () => {
			cancelled = true;
			if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
		};
	}, [siteKey]);

	if (!siteKey) return null;
	return <div ref={ref} className="flex justify-center" />;
}
