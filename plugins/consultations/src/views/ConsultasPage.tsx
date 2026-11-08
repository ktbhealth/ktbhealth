import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ClipboardListIcon, DownloadIcon } from "lucide-react";

import { buttonVariants } from "@ktbhealth/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@ktbhealth/ui/components/empty";

const SOURCE_LABEL: Record<string, string> = {
	browser: "Voz no navegador",
	bot: "Teleconsulta (bot)",
	dictation: "Ditado",
	upload: "Upload",
};

const FILTERS = [
	["todas", "Todas"],
	["anamnese", "Com anamnese"],
	["pendente", "Pendentes"],
] as const;

function initials(name: string | null) {
	if (!name) return "?";
	const parts = name.trim().split(/\s+/);
	return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Badge({
	children,
	tone = "neutral",
}: {
	children: React.ReactNode;
	tone?: "neutral" | "green" | "amber" | "indigo" | "red";
}) {
	const tones = {
		neutral: "bg-muted text-muted-foreground ring-border",
		green: "bg-primary/10 text-primary ring-primary/20",
		amber: "bg-amber-50 text-amber-700 ring-amber-200",
		indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
		red: "bg-red-50 text-red-700 ring-red-200",
	};
	return (
		<span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${tones[tone]}`}>
			{children}
		</span>
	);
}

export interface ConsultaListItem {
	id: number;
	engine: string | null;
	createdAt: Date;
	transcript: string;
	source: string | null;
	status: string;
	consentAt: Date | null;
	patientName: string | null;
	queixa: string | null;
	hasAnamnesis: boolean;
	hasReview: boolean;
}

export function ConsultasPage({ consultas }: { consultas: ConsultaListItem[] }) {
	const [q, setQ] = useState("");
	const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("todas");

	const shown = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return consultas.filter((c) => {
			if (filter === "anamnese" && !c.hasAnamnesis) return false;
			if (filter === "pendente" && c.hasAnamnesis) return false;
			if (!needle) return true;
			return [c.patientName, c.queixa, c.transcript, String(c.id)]
				.filter(Boolean)
				.some((t) => (t as string).toLowerCase().includes(needle));
		});
	}, [consultas, q, filter]);

	return (
		<div>
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">Consultas</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{consultas.length === 0
							? "Nenhuma consulta ainda."
							: `${consultas.length} consulta${consultas.length > 1 ? "s" : ""} registrada${consultas.length > 1 ? "s" : ""}.`}
					</p>
				</div>
				<Link
					to="/consultations/new"
					className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/80"
				>
					+ Nova consulta
				</Link>
			</div>

			{consultas.length > 0 ? (
				<div className="mt-6 flex flex-wrap items-center gap-3">
					<input
						type="search"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="Buscar por paciente, queixa ou texto…"
						aria-label="Buscar consultas"
						className="w-full max-w-sm rounded-lg border border-border bg-card px-3 py-2 text-sm"
					/>
					<div className="flex rounded-lg bg-muted p-0.5 text-xs">
						{FILTERS.map(([key, label]) => (
							<button
								key={key}
								type="button"
								onClick={() => setFilter(key)}
								aria-pressed={filter === key}
								className={`rounded-md px-3 py-1.5 font-medium transition ${
									filter === key
										? "bg-background text-foreground shadow-sm"
										: "text-muted-foreground hover:text-foreground"
								}`}
							>
								{label}
							</button>
						))}
					</div>
				</div>
			) : null}

			<div className="mt-5 space-y-3">
				{shown.map((c) => (
					<article
						key={c.id}
						className="group relative flex items-start gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:border-foreground/20 hover:shadow"
					>
						<div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 text-sm font-semibold text-primary">
							{initials(c.patientName)}
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-baseline gap-x-2">
								<Link
									to="/consultations/$id"
									params={{ id: String(c.id) }}
									className="font-semibold after:absolute after:inset-0 after:content-['']"
								>
									{c.patientName ?? "Paciente não vinculado"}
								</Link>
								<span className="text-xs text-muted-foreground">
									#{c.id} · {new Date(c.createdAt).toLocaleString("pt-BR")}
								</span>
							</div>
							<p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
								{c.queixa && !c.queixa.startsWith("A preencher")
									? c.queixa
									: c.transcript || "Sem transcrição."}
							</p>
							<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
								{c.status === "live" ? <Badge tone="red">● ao vivo</Badge> : null}
								{c.hasAnamnesis ? (
									<Badge tone="green">Anamnese</Badge>
								) : (
									<Badge tone="amber">Sem anamnese</Badge>
								)}
								{c.hasReview ? <Badge tone="indigo">2ª opinião</Badge> : null}
								{c.consentAt ? <Badge tone="green">Consentimento ✓</Badge> : null}
								<Badge>{SOURCE_LABEL[c.source ?? ""] ?? c.source}</Badge>
							</div>
						</div>
						{c.hasAnamnesis ? (
							<a
								href={`/api/consultations/${c.id}/pdf`}
								download
								title="Baixar PDF da anamnese"
								className="relative z-10 shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
							>
								<DownloadIcon className="mr-1 inline size-3.5 -translate-y-px" />
								PDF
							</a>
						) : null}
					</article>
				))}

				{consultas.length > 0 && shown.length === 0 ? (
					<Empty className="border">
						<EmptyDescription>Nenhuma consulta corresponde à busca.</EmptyDescription>
					</Empty>
				) : null}

				{!consultas.length ? (
					<Empty className="border bg-card px-6 py-16">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<ClipboardListIcon />
							</EmptyMedia>
							<EmptyTitle>Nenhuma consulta ainda</EmptyTitle>
							<EmptyDescription>
								Inicie uma consulta para gravar a conversa e gerar a anamnese.
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Link to="/consultations/new" className={buttonVariants()}>
								Iniciar consulta
							</Link>
						</EmptyContent>
					</Empty>
				) : null}
			</div>
		</div>
	);
}
