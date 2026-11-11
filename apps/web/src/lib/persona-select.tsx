import { useNavigate, useSearch } from "@tanstack/react-router";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@ktbhealth/ui/components/select";
import * as m from "#/paraglide/messages.js";
import { PERSONAS, parsePersona, personaLabel } from "./persona.ts";

/**
 * Landing nav control: picks the audience the landing page speaks to.
 * The value is the `?persona=` search param of `/`, so it survives reloads
 * and can be shared; changing it replaces the history entry.
 */
export function PersonaSelect() {
	const navigate = useNavigate();
	const persona = parsePersona(
		useSearch({ strict: false, select: (s: Record<string, unknown>) => s.persona }),
	);
	const items = PERSONAS.map((p) => ({ value: p, label: personaLabel(p) }));
	return (
		<Select
			items={items}
			value={persona}
			onValueChange={(value) =>
				void navigate({ to: "/", search: { persona: parsePersona(value) }, replace: true })
			}
		>
			<SelectTrigger aria-label={m.persona_label()} size="sm" className="min-w-36">
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
