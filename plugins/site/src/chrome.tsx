import { Link } from "@tanstack/react-router";
import { BookPlusIcon } from "lucide-react";

import { LanguageToggle } from "@ktbhealth/ui/components/language-toggle";
import type { ChromeProps } from "@ktb/kernel";

/**
 * App-shell brand block contributed to `app.header.brand` (P-060):
 * the KTB Health mark linking to "/".
 */
export function SiteBrand() {
	return (
		<Link to="/" className="flex items-center gap-2.5">
			<span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
				<BookPlusIcon className="size-5" />
			</span>
			<span className="text-lg font-bold tracking-tight">KTB Health</span>
		</Link>
	);
}

/**
 * Locale picker contributed to `app.header.actions`: every value comes
 * from the host-injected ChromeProps (plugins cannot import the host's
 * i18n runtime); the menu label falls back to English when the host
 * doesn't fill `labels.langMenu`.
 */
export function SiteLocaleToggle({ locale, locales, localeName, setLocale, labels }: ChromeProps) {
	return (
		<LanguageToggle
			locales={locales}
			value={locale}
			onValueChange={setLocale}
			labels={Object.fromEntries(locales.map((l) => [l, localeName(l)]))}
			label={labels.langMenu ?? "Language"}
		/>
	);
}
