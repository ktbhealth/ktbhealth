import type { Confidence } from "@ktb/anamnesis";

export const CONF_STYLE: Record<Confidence, string> = {
	alta: "bg-primary/10 text-primary ring-primary/20",
	media: "bg-amber-50 text-amber-700 ring-amber-200",
	baixa: "bg-muted text-muted-foreground ring-border",
};

export const CONF_BAR: Record<Confidence, string> = {
	alta: "border-l-primary",
	media: "border-l-amber-400",
	baixa: "border-l-border",
};

export const SPEAKER_STYLE: Record<string, string> = {
	Doctor: "bg-sky-50 text-sky-800 ring-sky-200",
	Patient: "bg-primary/10 text-primary ring-primary/20",
	// legacy pt-BR speaker labels from bot/dictation transcripts
	Médico: "bg-sky-50 text-sky-800 ring-sky-200",
	Paciente: "bg-primary/10 text-primary ring-primary/20",
};

/** Ring-tone classes applied on top of `<Badge variant="secondary">` (see `ring-1`). */
export const BADGE_TONES = {
	neutral: "bg-muted text-muted-foreground ring-border",
	green: "bg-primary/10 text-primary ring-primary/20",
	amber: "bg-amber-50 text-amber-700 ring-amber-200",
	red: "bg-red-50 text-red-700 ring-red-200",
} as const;
