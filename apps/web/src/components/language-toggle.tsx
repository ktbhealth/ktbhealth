import { CheckIcon, LanguagesIcon } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@ktbhealth/ui/components/dropdown-menu";
import * as m from "#/paraglide/messages.js";
import { localeName } from "#/lib/i18n.ts";

/**
 * Controlled locale picker. The caller wires `onChange` to paraglide's
 * `setLocale` (which persists the cookie and reloads for SSR).
 */
export function LanguageToggle({
	locales,
	value,
	onChange,
}: {
	locales: readonly string[];
	value: string;
	onChange: (locale: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label={m.lang_menu_label()}
				className="flex items-center rounded-lg px-2 py-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
			>
				<LanguagesIcon className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuLabel>{m.lang_menu_heading()}</DropdownMenuLabel>
				{locales.map((locale) => (
					<DropdownMenuItem key={locale} onClick={() => onChange(locale)}>
						<span className="flex w-4 justify-center">
							{locale === value ? <CheckIcon /> : null}
						</span>
						{localeName(locale)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
