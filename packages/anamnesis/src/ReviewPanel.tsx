import { useState } from "react";

import { Alert, AlertTitle } from "@ktbhealth/ui/components/alert";
import { Badge } from "@ktbhealth/ui/components/badge";

import { SECTION_LABELS } from "./types.ts";
import type { AnamnesisReview, Confidence } from "./types.ts";

const PROB_STYLE: Record<Confidence, string> = {
	alta: "bg-red-50 text-red-700",
	media: "bg-amber-50 text-amber-700",
	baixa: "bg-muted text-muted-foreground",
};

/** Second opinion — decision support, never merged silently. */
export function ReviewPanel({
	review,
	onAddHypothesis,
}: {
	review: AnamnesisReview;
	/** Return false when the hypothesis was already in the anamnese. */
	onAddHypothesis?: (text: string) => boolean | undefined;
}) {
	const empty =
		!review.lacunas.length &&
		!review.hipoteses.length &&
		!review.sinais_de_alerta.length &&
		!review.inconsistencias.length;
	const [added, setAdded] = useState<Set<string>>(new Set());
	if (empty)
		return (
			<p className="text-xs text-muted-foreground">
				A segunda opinião não encontrou lacunas nem hipóteses adicionais.
			</p>
		);

	return (
		<div className="space-y-5 text-sm">
			{review.sinais_de_alerta.length ? (
				<Alert variant="destructive" className="p-3">
					<AlertTitle className="text-xs">Sinais de alerta</AlertTitle>
					<ul className="mt-1 list-inside list-disc text-xs">
						{review.sinais_de_alerta.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				</Alert>
			) : null}

			{review.hipoteses.length ? (
				<div>
					<div className="text-xs font-semibold text-foreground">Hipóteses sugeridas</div>
					<div className="mt-2 space-y-3">
						{review.hipoteses.map((h) => (
							<div key={h.diagnostico} className="rounded-lg border border-border p-3">
								<div className="flex items-center gap-2">
									<span className="font-medium">{h.diagnostico}</span>
									<span
										className={`rounded-full px-2 py-0.5 text-[10px] ${PROB_STYLE[h.probabilidade]}`}
									>
										prob. {h.probabilidade}
									</span>
									{onAddHypothesis ? (
										added.has(h.diagnostico) ? (
											<Badge className="ml-auto border-emerald-200 bg-emerald-50 text-[11px] text-emerald-700 hover:bg-emerald-50">
												✓ adicionada
											</Badge>
										) : (
											<button
												type="button"
												onClick={() => {
													const ok = onAddHypothesis(`${h.diagnostico}: ${h.raciocinio}`);
													if (ok !== false) setAdded((prev) => new Set(prev).add(h.diagnostico));
												}}
												className="ml-auto rounded border border-border px-2 py-0.5 text-[11px] transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 active:scale-95"
											>
												+ adicionar às hipóteses
											</button>
										)
									) : null}
								</div>
								{h.raciocinio ? (
									<p className="mt-1 text-xs text-muted-foreground">{h.raciocinio}</p>
								) : null}
								{h.evidence.length ? (
									<ul className="mt-1 list-inside list-disc text-[11px] text-muted-foreground">
										{h.evidence.map((e) => (
											<li key={e.slice(0, 50)}>“{e}”</li>
										))}
									</ul>
								) : null}
								{h.investigar.length ? (
									<p className="mt-1 text-[11px] text-muted-foreground">
										Investigar: {h.investigar.join("; ")}
									</p>
								) : null}
							</div>
						))}
					</div>
				</div>
			) : null}

			{review.lacunas.length ? (
				<div>
					<div className="text-xs font-semibold text-foreground">
						Lacunas: perguntas que ainda podem ser feitas
					</div>
					<ul className="mt-2 space-y-2">
						{review.lacunas.map((g) => (
							<li
								key={`${g.secao}-${g.pergunta_sugerida}`}
								className="rounded-lg bg-muted p-3 text-xs"
							>
								<span className="font-medium text-foreground">{SECTION_LABELS[g.secao]}:</span>{" "}
								{g.o_que_falta}
								{g.pergunta_sugerida ? (
									<div className="mt-1 text-foreground">→ “{g.pergunta_sugerida}”</div>
								) : null}
								{g.motivo ? <div className="mt-0.5 text-muted-foreground">{g.motivo}</div> : null}
							</li>
						))}
					</ul>
				</div>
			) : null}

			{review.inconsistencias.length ? (
				<div>
					<div className="text-xs font-semibold text-foreground">Inconsistências</div>
					<ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
						{review.inconsistencias.map((i) => (
							<li key={i}>{i}</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}
