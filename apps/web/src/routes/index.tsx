import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

const STEPS = [
	{
		n: "1",
		title: "Converse",
		desc: "Grave o microfone, capture a aba da videochamada ou cole a transcrição. Médico e paciente saem separados.",
	},
	{
		n: "2",
		title: "Gere a anamnese",
		desc: "Em segundos, o texto vira 8 seções de prontuário, cada uma com a frase da consulta que a fundamenta.",
	},
	{
		n: "3",
		title: "Revise e salve",
		desc: "Edite o que quiser, veja a segunda opinião da IA, confirme e baixe o PDF.",
	},
];

const FEATURES = [
	{
		icon: "🎙️",
		title: "Transcrição no seu navegador",
		desc: "O Whisper roda localmente em pt-BR. O áudio não sai do seu computador — só o texto é processado.",
	},
	{
		icon: "🔎",
		title: "Anamnese com evidência",
		desc: "Cada campo mostra a confiança e as frases-fonte. Você revisa o texto, sem reouvir a consulta.",
	},
	{
		icon: "🧠",
		title: "Segunda opinião da IA",
		desc: "Aponta lacunas, perguntas que ainda cabem e hipóteses com raciocínio. Você decide o que entra.",
	},
	{
		icon: "🔒",
		title: "Privacidade por desenho",
		desc: "Pode rodar 100% local, com modelo próprio na sua GPU. Consentimento do paciente registrado.",
	},
];

function Home() {
	return (
		<div className="space-y-20">
			{/* ---------- hero ---------- */}
			<section className="grid items-center gap-12 pt-6 lg:grid-cols-[1.1fr_0.9fr]">
				<div>
					<span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
						<span className="size-1.5 rounded-full bg-emerald-500" />
						Documentação clínica por voz
					</span>
					<h1 className="mt-5 text-5xl font-bold tracking-tight text-balance sm:text-6xl">
						Sua consulta,{" "}
						<span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
							documentada.
						</span>
					</h1>
					<p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
						Fale com o paciente, não com a tela. A anamnese sai estruturada da conversa — você só
						revisa e aprova.
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						<Link
							to="/consulta/nova"
							className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/80"
						>
							Iniciar consulta →
						</Link>
						<Link
							to="/consultas"
							className="rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold text-card-foreground transition hover:bg-muted"
						>
							Ver consultas
						</Link>
					</div>
				</div>

				{/* mock: cartão de anamnese */}
				<div className="relative">
					<div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-emerald-100 via-teal-50 to-transparent blur-2xl" />
					<div className="rounded-2xl border border-border bg-card p-5 shadow-xl">
						<div className="flex items-center justify-between">
							<span className="text-sm font-semibold">Anamnese</span>
							<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
								exemplo
							</span>
						</div>
						<div className="mt-4 space-y-3">
							<div className="rounded-xl border border-l-4 border-border border-l-emerald-400 p-3">
								<div className="flex items-center justify-between">
									<span className="text-xs font-semibold text-card-foreground">
										Queixa principal
									</span>
									<span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200">
										confiança alta
									</span>
								</div>
								<p className="mt-1 text-sm text-card-foreground">
									Cefaleia frontal intensa há 3 dias, com piora noturna.
								</p>
								<p className="mt-1.5 text-[11px] text-muted-foreground">
									“A dor começou de repente, na região frontal…”
								</p>
							</div>
							<div className="rounded-xl border border-l-4 border-border border-l-amber-400 p-3">
								<div className="flex items-center justify-between">
									<span className="text-xs font-semibold text-card-foreground">
										Medicamentos em uso
									</span>
									<span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-200">
										confiança média
									</span>
								</div>
								<p className="mt-1 text-sm text-card-foreground">Losartana 50 mg, 1x ao dia.</p>
							</div>
							<div className="rounded-xl bg-indigo-50 p-3 text-xs text-indigo-900">
								<span className="font-semibold">Segunda opinião:</span> perguntar sobre rigidez de
								nuca e fotofobia.
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* ---------- como funciona ---------- */}
			<section>
				<h2 className="text-center text-2xl font-bold tracking-tight">Como funciona</h2>
				<div className="mt-8 grid gap-4 sm:grid-cols-3">
					{STEPS.map((s) => (
						<div key={s.n} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
							<span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
								{s.n}
							</span>
							<div className="mt-4 font-semibold">{s.title}</div>
							<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
						</div>
					))}
				</div>
			</section>

			{/* ---------- recursos ---------- */}
			<section>
				<h2 className="text-center text-2xl font-bold tracking-tight">Feito para o consultório</h2>
				<div className="mt-8 grid gap-4 sm:grid-cols-2">
					{FEATURES.map((f) => (
						<div
							key={f.title}
							className="flex gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-foreground/20 hover:shadow"
						>
							<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-xl">
								{f.icon}
							</span>
							<div>
								<div className="font-semibold">{f.title}</div>
								<p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
							</div>
						</div>
					))}
				</div>
			</section>

			{/* ---------- CTA final ---------- */}
			<section className="rounded-3xl bg-foreground px-8 py-12 text-center text-background">
				<h2 className="text-2xl font-bold tracking-tight">
					Termine o dia sem prontuário pendente.
				</h2>
				<p className="mx-auto mt-2 max-w-md text-sm text-background/70">
					Teste com a transcrição de exemplo, sem precisar de microfone.
				</p>
				<Link
					to="/consulta/nova"
					className="mt-6 inline-block rounded-xl bg-background px-6 py-3 text-sm font-semibold text-foreground transition hover:bg-muted"
				>
					Começar agora →
				</Link>
			</section>
		</div>
	);
}
