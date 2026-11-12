import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ktbhealth/ui/components/select";

import { AUDIENCES, parseAudience } from "./audience.ts";
import type { AudienceMessages } from "./i18n.ts";

/**
 * Landing nav control: picks the audience the landing page speaks to.
 * The value is the `?audience=` search param of `/`, so it survives
 * reloads and can be shared; changing it replaces the history entry.
 */
export function AudienceSelect({ t }: { readonly t: AudienceMessages }) {
	const navigate = useNavigate();
	const audience = parseAudience(
		useSearch({ strict: false, select: (s: Record<string, unknown>) => s.audience }),
	);
	const items = AUDIENCES.map((a) => ({
		value: a,
		label: {
			doctors: t.audience_doctors,
			patients: t.audience_patients,
			developers: t.audience_developers,
			business: t.audience_business,
		}[a],
	}));
	return (
		<Select
			items={items}
			value={audience}
			onValueChange={(value) =>
				void navigate({ to: "/", search: { audience: parseAudience(value) }, replace: true })
			}
		>
			<SelectTrigger aria-label={t.audience_label} size="sm" className="min-w-36">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{items.map((item) => (
					<SelectItem key={item.value} value={item.value}>
						{item.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
