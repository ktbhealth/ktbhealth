import { createFileRoute, Link } from "@tanstack/react-router";
import { buttonVariants } from "@ktbhealth/ui/components/button";
import { Badge } from "@ktbhealth/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@ktbhealth/ui/components/card";
import {
	ArrowRightIcon,
	AudioLinesIcon,
	ClipboardCheckIcon,
	FileTextIcon,
	MicIcon,
	ShieldCheckIcon,
	SparklesIcon,
	StethoscopeIcon,
} from "lucide-react";

export const Route = createFileRoute("/")({ component: Home });

const STEPS = [
	{
		icon: MicIcon,
		title: "Converse",
		desc: "Grave o microfone, capture a aba da videochamada ou cole a transcrição. Médico e paciente saem separados.",
	},
	{
		icon: SparklesIcon,
		title: "Gere a anamnese",
		desc: "Em segundos, o texto vira 8 seções de prontuário, cada uma com a frase da consulta que a fundamenta.",
	},
	{
		icon: ClipboardCheckIcon,
		title: "Revise e salve",
		desc: "Edite o que quiser, veja a segunda opinião da IA, confirme e baixe o PDF.",
	},
];

const FEATURES = [
	{
		icon: AudioLinesIcon,
		title: "Transcrição no seu navegador",
		desc: "O Whisper roda localmente em pt-BR. O áudio não sai do seu computador — só o texto é processado.",
		span: "lg:col-span-2",
	},
	{
		icon: FileTextIcon,
		title: "Anamnese com evidência",
		desc: "Cada campo mostra a confiança e as frases-fonte. Você revisa o texto, sem reouvir a consulta.",
	},
	{
		icon: SparklesIcon,
		title: "Segunda opinião da IA",
		desc: "Aponta lacunas, perguntas que ainda cabem e hipóteses com raciocínio. Você decide o que entra.",
	},
	{
		icon: ShieldCheckIcon,
		title: "Privacidade por desenho",
		desc: "Pode rodar 100% local, com modelo próprio na sua GPU. Consentimento do paciente registrado.",
	},
];

const STATS = [
	{ value: "8", label: "seções de prontuário" },
	{ value: "pt-BR", label: "transcrição local" },
	{ value: "100%", label: "revisão humana" },
];

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
	return (
		<div className="mx-auto max-w-2xl text-center">
			<span className="text-xs font-semibold tracking-wide text-primary uppercase">{eyebrow}</span>
			<h2 className="mt-3 text-3xl font-bold tracking-tight text-balance">{title}</h2>
		</div>
	);
}

function Home() {
	return (
		<div className="space-y-24">
			{/* ---------- hero ---------- */}
			<section className="grid items-center gap-12 pt-10 lg:grid-cols-[1.05fr_0.95fr]">
				<div>
					<Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
						<span className="size-1.5 rounded-full bg-emerald-500" />
						Documentação clínica por voz
					</Badge>
					<h1 className="mt-6 text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
						Sua consulta,{" "}
						<span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
							documentada.
						</span>
					</h1>
					<p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
						Fale com o paciente, não com a tela. A conversa vira anamnese estruturada — você só
						revisa e aprova. O contexto de cada consulta fica guardado para a próxima.
					</p>
					<div className="mt-8 flex flex-wrap items-center gap-3">
						<Link to="/consulta/nova" className={buttonVariants({ size: "lg" })}>
							Iniciar consulta
							<ArrowRightIcon />
						</Link>
						<Link to="/consultas" className={buttonVariants({ variant: "outline", size: "lg" })}>
							Ver consultas
						</Link>
					</div>
					<dl className="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-border pt-8">
						{STATS.map((s) => (
							<div key={s.label}>
								<dt className="text-2xl font-bold tracking-tight">{s.value}</dt>
								<dd className="mt-1 text-xs text-muted-foreground">{s.label}</dd>
							</div>
						))}
					</dl>
				</div>

				{/* mock: cartão de anamnese */}
				<div className="relative">
					<div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-emerald-100 via-teal-50 to-transparent blur-2xl" />
					<Card className="shadow-xl">
						<CardHeader className="flex-row items-center justify-between">
							<CardTitle className="text-base">Anamnese</CardTitle>
							<Badge variant="outline" className="text-[10px] font-normal">
								exemplo
							</Badge>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="rounded-xl border border-l-4 border-border border-l-emerald-400 p-3">
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-semibold">Queixa principal</span>
									<Badge className="bg-emerald-50 text-[10px] text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">
										confiança alta
									</Badge>
								</div>
								<p className="mt-1 text-sm">
									Cefaleia frontal intensa há 3 dias, com piora noturna.
								</p>
								<p className="mt-1.5 text-[11px] text-muted-foreground">
									“A dor começou de repente, na região frontal…”
								</p>
							</div>
							<div className="rounded-xl border border-l-4 border-border border-l-amber-400 p-3">
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-semibold">Medicamentos em uso</span>
									<Badge className="bg-amber-50 text-[10px] text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50">
										confiança média
									</Badge>
								</div>
								<p className="mt-1 text-sm">Losartana 50 mg, 1x ao dia.</p>
							</div>
							<div className="flex items-start gap-2 rounded-xl bg-accent p-3 text-xs text-accent-foreground">
								<SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
								<span>
									<span className="font-semibold">Segunda opinião:</span> perguntar sobre rigidez de
									nuca e fotofobia.
								</span>
							</div>
						</CardContent>
					</Card>
				</div>
			</section>

			{/* ---------- como funciona ---------- */}
			<section className="border-t border-border bg-muted/40 py-16">
				<div className="mx-auto max-w-6xl px-6">
					<SectionHeading
						eyebrow="Como funciona"
						title="Da conversa ao prontuário em três passos"
					/>
					<ol className="mt-12 grid gap-6 sm:grid-cols-3">
						{STEPS.map((s, i) => (
							<li key={s.title}>
								<Card className="h-full">
									<CardHeader>
										<span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
											<s.icon className="size-4.5" />
										</span>
										<CardTitle className="mt-2 text-base">{s.title}</CardTitle>
										<CardDescription className="text-sm leading-relaxed">{s.desc}</CardDescription>
									</CardHeader>
									<CardContent>
										<span className="text-xs font-medium text-muted-foreground">
											Passo {i + 1} de 3
										</span>
									</CardContent>
								</Card>
							</li>
						))}
					</ol>
				</div>
			</section>

			{/* ---------- recursos (bento) ---------- */}
			<section className="mx-auto max-w-6xl px-6 py-16">
				<SectionHeading
					eyebrow="Por que KTB"
					title="Feito para o consultório, não para o prontuário"
				/>
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{FEATURES.map((f) => (
						<Card key={f.title} className={`transition hover:ring-foreground/20 ${f.span ?? ""}`}>
							<CardHeader>
								<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<f.icon className="size-5" />
								</span>
								<CardTitle className="mt-3 text-base">{f.title}</CardTitle>
								<CardDescription className="text-sm leading-relaxed">{f.desc}</CardDescription>
							</CardHeader>
						</Card>
					))}
				</div>
				<p className="mx-auto mt-8 flex max-w-md items-center justify-center gap-2 text-center text-sm text-muted-foreground">
					<StethoscopeIcon className="size-4 shrink-0" />
					Cada consulta vira contexto duradouro — a próxima já começa com o histórico na tela.
				</p>
			</section>

			{/* ---------- CTA final ---------- */}
			<section className="mx-auto max-w-6xl px-6 pb-8">
				<div className="rounded-3xl bg-foreground px-8 py-14 text-center text-background">
					<h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
						Termine o dia sem prontuário pendente.
					</h2>
					<p className="mx-auto mt-3 max-w-md text-sm text-background/70">
						Teste com a transcrição de exemplo, sem precisar de microfone.
					</p>
					<Link
						to="/consulta/nova"
						className={buttonVariants({ variant: "secondary", size: "lg" }) + " mt-8"}
					>
						Começar agora
						<ArrowRightIcon />
					</Link>
				</div>
			</section>
		</div>
	);
}
