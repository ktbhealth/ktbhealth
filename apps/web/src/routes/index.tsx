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
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@ktbhealth/ui/components/accordion";
import {
	ArrowRightIcon,
	AudioLinesIcon,
	BotIcon,
	CheckIcon,
	ClipboardCheckIcon,
	FileTextIcon,
	LockIcon,
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

const FAQ = [
	{
		q: "O áudio da consulta sai do meu computador?",
		a: "A transcrição roda no seu navegador com o Whisper local — o áudio não sai da máquina. Só o texto resultante é enviado para estruturar a anamnese, e você pode apontar um modelo próprio (inclusive local, via Ollama) para manter tudo no seu ambiente.",
	},
	{
		q: "A IA diagnostica ou prescreve?",
		a: "Não. O KTB Health gera um rascunho estruturado a partir do que foi dito na consulta. Cada campo mostra a confiança e as frases-fonte, e o registro final é sempre revisado e aprovado por um médico.",
	},
	{
		q: "Funciona em teleconsulta?",
		a: "Sim. O bot entra em calls de Meet, Zoom, Teams e WhatsApp Web, ou você pode capturar o áudio da aba do navegador diretamente. Para atendimento presencial, o modo de ditado transcreve sua narração com o mesmo Whisper.",
	},
	{
		q: "Como funciona o consentimento do paciente?",
		a: "Cada consulta exige uma declaração explícita de que o paciente foi informado e consentiu com a gravação. O registro de consentimento fica vinculado à consulta e à anamnese gerada.",
	},
	{
		q: "Posso escolher qual modelo de IA usar?",
		a: "Sim. A extração e a revisão suportam Anthropic, OpenAI, Workers AI da Cloudflare, Ollama local e um motor heurístico de fallback — a escolha é configuração, não código.",
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

/** Browser-chrome frame around the product mock, à la shadcn hero screenshot blocks. */
function BrowserFrame({ children }: { children: React.ReactNode }) {
	return (
		<div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
			<div className="flex items-center gap-3 border-b border-border bg-muted/60 px-4 py-2.5">
				<div className="flex gap-1.5">
					<span className="size-2.5 rounded-full bg-red-400" />
					<span className="size-2.5 rounded-full bg-amber-400" />
					<span className="size-2.5 rounded-full bg-emerald-400" />
				</div>
				<div className="mx-auto flex w-full max-w-xs items-center justify-center rounded-md bg-background px-3 py-1 text-[11px] text-muted-foreground">
					ktb.health/consulta/nova
				</div>
				<div className="w-10" />
			</div>
			{children}
		</div>
	);
}

function ProductMock() {
	return (
		<BrowserFrame>
			<div className="grid gap-0 sm:grid-cols-[1fr_1.2fr]">
				{/* transcript column */}
				<div className="border-b border-border p-5 sm:border-b-0 sm:border-r">
					<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
						<AudioLinesIcon className="size-3.5" />
						Transcrição ao vivo
					</div>
					<div className="mt-4 space-y-3 text-sm">
						<div>
							<span className="text-xs font-semibold text-primary">Dra. Ana</span>
							<p className="mt-0.5 text-muted-foreground">Desde quando a dor começou?</p>
						</div>
						<div>
							<span className="text-xs font-semibold text-emerald-600">Paciente</span>
							<p className="mt-0.5 text-muted-foreground">
								De repente, na região frontal. Piora à noite e me derruba.
							</p>
						</div>
						<div>
							<span className="text-xs font-semibold text-primary">Dra. Ana</span>
							<p className="mt-0.5 text-muted-foreground">Toma algum medicamento?</p>
						</div>
						<div className="flex items-center gap-1.5 pt-1">
							<span className="size-2 animate-pulse rounded-full bg-red-500" />
							<span className="text-xs text-muted-foreground">gravando…</span>
						</div>
					</div>
				</div>
				{/* anamnesis column */}
				<div className="bg-muted/30 p-5">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
							<FileTextIcon className="size-3.5" />
							Anamnese
						</div>
						<Badge variant="outline" className="text-[10px] font-normal">
							exemplo
						</Badge>
					</div>
					<div className="mt-4 space-y-3">
						<div className="rounded-lg border border-border border-l-4 border-l-emerald-400 bg-card p-3">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-semibold">Queixa principal</span>
								<Badge className="bg-emerald-50 text-[10px] text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">
									confiança alta
								</Badge>
							</div>
							<p className="mt-1 text-sm">Cefaleia frontal intensa há 3 dias, com piora noturna.</p>
							<p className="mt-1 text-[11px] text-muted-foreground">
								“A dor começou de repente, na região frontal…”
							</p>
						</div>
						<div className="rounded-lg border border-border border-l-4 border-l-amber-400 bg-card p-3">
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs font-semibold">Medicamentos em uso</span>
								<Badge className="bg-amber-50 text-[10px] text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50">
									confiança média
								</Badge>
							</div>
							<p className="mt-1 text-sm">Losartana 50 mg, 1x ao dia.</p>
						</div>
						<div className="flex items-start gap-2 rounded-lg bg-accent p-3 text-xs text-accent-foreground">
							<SparklesIcon className="mt-0.5 size-3.5 shrink-0" />
							<span>
								<span className="font-semibold">Segunda opinião:</span> perguntar sobre rigidez de
								nuca e fotofobia.
							</span>
						</div>
					</div>
				</div>
			</div>
		</BrowserFrame>
	);
}

function Home() {
	return (
		<div className="space-y-24">
			{/* ---------- hero ---------- */}
			<section className="mx-auto max-w-6xl px-6 pt-16 text-center">
				<Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1">
					<span className="size-1.5 rounded-full bg-emerald-500" />
					Documentação clínica por voz
				</Badge>
				<h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
					Sua consulta,{" "}
					<span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
						documentada.
					</span>
				</h1>
				<p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
					Fale com o paciente, não com a tela. A conversa vira anamnese estruturada — você só revisa
					e aprova. O contexto de cada consulta fica guardado para a próxima.
				</p>
				<div className="mt-8 flex flex-wrap items-center justify-center gap-3">
					<Link to="/consulta/nova" className={buttonVariants({ size: "lg" })}>
						Iniciar consulta
						<ArrowRightIcon />
					</Link>
					<Link to="/consultas" className={buttonVariants({ variant: "outline", size: "lg" })}>
						Ver consultas
					</Link>
				</div>
				<dl className="mx-auto mt-14 grid max-w-xl grid-cols-3 gap-6 border-t border-border pt-8">
					{STATS.map((s) => (
						<div key={s.label}>
							<dt className="text-2xl font-bold tracking-tight">{s.value}</dt>
							<dd className="mt-1 text-xs text-muted-foreground">{s.label}</dd>
						</div>
					))}
				</dl>
			</section>

			{/* product mock, full width */}
			<section className="mx-auto max-w-6xl px-6">
				<div className="relative">
					<div className="absolute -inset-x-8 -top-8 -z-10 h-40 bg-gradient-to-b from-emerald-100/70 to-transparent blur-2xl" />
					<ProductMock />
				</div>
			</section>

			{/* ---------- como funciona ---------- */}
			<section className="border-t border-border bg-muted/40 py-16">
				<div className="mx-auto max-w-6xl px-6">
					<SectionHeading
						eyebrow="Como funciona"
						title="Da conversa ao prontuário em três passos"
					/>
					<ol className="relative mt-12 grid gap-8 sm:grid-cols-3">
						<span
							aria-hidden
							className="absolute top-5 right-[16%] left-[16%] hidden border-t border-dashed border-border sm:block"
						/>
						{STEPS.map((s, i) => (
							<li key={s.title} className="relative">
								<span className="flex size-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
									{i + 1}
								</span>
								<Card className="mt-4 h-full">
									<CardHeader>
										<span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
											<s.icon className="size-4.5" />
										</span>
										<CardTitle className="mt-2 text-base">{s.title}</CardTitle>
										<CardDescription className="text-sm leading-relaxed">{s.desc}</CardDescription>
									</CardHeader>
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
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{/* flagship tile */}
					<Card className="sm:col-span-2 transition hover:ring-foreground/20">
						<CardHeader>
							<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<AudioLinesIcon className="size-5" />
							</span>
							<CardTitle className="mt-3 text-base">Transcrição no seu navegador</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								O Whisper roda localmente em pt-BR, separando médico e paciente por voz. O áudio não
								sai do seu computador — só o texto é processado.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="flex h-24 items-end gap-1 rounded-xl bg-muted/60 p-4">
								{[
									40, 70, 55, 90, 35, 65, 80, 45, 75, 60, 30, 85, 50, 95, 40, 70, 55, 80, 45, 65,
								].map((h, i) => (
									<span
										key={i}
										className={`w-1.5 rounded-full ${
											i % 5 === 0 ? "bg-emerald-400" : "bg-primary/30"
										}`}
										style={{ height: `${h}%` }}
									/>
								))}
							</div>
						</CardContent>
					</Card>

					<Card className="transition hover:ring-foreground/20">
						<CardHeader>
							<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<FileTextIcon className="size-5" />
							</span>
							<CardTitle className="mt-3 text-base">Anamnese com evidência</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								Cada campo mostra a confiança e as frases-fonte. Você revisa o texto, sem reouvir a
								consulta.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							{[
								{ t: "Queixa principal", c: "alta", cls: "border-l-emerald-400" },
								{ t: "História da doença", c: "média", cls: "border-l-amber-400" },
							].map((s) => (
								<div
									key={s.t}
									className={`flex items-center justify-between rounded-lg border border-l-4 border-border bg-muted/40 px-3 py-2 text-xs ${s.cls}`}
								>
									<span className="font-medium">{s.t}</span>
									<Badge variant="outline" className="text-[10px] font-normal">
										{s.c}
									</Badge>
								</div>
							))}
						</CardContent>
					</Card>

					<Card className="transition hover:ring-foreground/20">
						<CardHeader>
							<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<SparklesIcon className="size-5" />
							</span>
							<CardTitle className="mt-3 text-base">Segunda opinião da IA</CardTitle>
							<CardDescription className="text-sm leading-relaxed">
								Aponta lacunas, perguntas que ainda cabem e hipóteses com raciocínio. Você decide o
								que entra.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							{[
								"Perguntar sobre rigidez de nuca",
								"Confirmar dose e frequência",
								"Sugerir retorno em 7 dias",
							].map((s) => (
								<div
									key={s}
									className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
								>
									<CheckIcon className="size-3.5 shrink-0 text-emerald-600" />
									{s}
								</div>
							))}
						</CardContent>
					</Card>

					<Card className="sm:col-span-2 transition hover:ring-foreground/20">
						<CardHeader className="flex-row items-start justify-between gap-4">
							<div>
								<span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<ShieldCheckIcon className="size-5" />
								</span>
								<CardTitle className="mt-3 text-base">Privacidade por desenho</CardTitle>
								<CardDescription className="text-sm leading-relaxed">
									Transcrição local, consentimento do paciente registrado e opção de rodar 100% no
									seu ambiente — com modelo próprio na sua GPU.
								</CardDescription>
							</div>
							<LockIcon className="mt-1 size-5 shrink-0 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="flex flex-wrap gap-2">
								{[
									{ icon: MicIcon, t: "Áudio não sai da máquina" },
									{ icon: LockIcon, t: "Consentimento por consulta" },
									{ icon: BotIcon, t: "Bot com identificador próprio" },
								].map((p) => (
									<span
										key={p.t}
										className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
									>
										<p.icon className="size-3.5" />
										{p.t}
									</span>
								))}
							</div>
						</CardContent>
					</Card>
				</div>
				<p className="mx-auto mt-8 flex max-w-md items-center justify-center gap-2 text-center text-sm text-muted-foreground">
					<StethoscopeIcon className="size-4 shrink-0" />
					Cada consulta vira contexto duradouro — a próxima já começa com o histórico na tela.
				</p>
			</section>

			{/* ---------- FAQ ---------- */}
			<section className="border-t border-border bg-muted/40 py-16">
				<div className="mx-auto max-w-3xl px-6">
					<SectionHeading eyebrow="Dúvidas" title="Perguntas frequentes" />
					<Accordion multiple className="mt-10">
						{FAQ.map((f, i) => (
							<AccordionItem key={f.q} value={`faq-${i}`}>
								<AccordionTrigger className="py-4 text-base">{f.q}</AccordionTrigger>
								<AccordionContent className="text-muted-foreground leading-relaxed">
									{f.a}
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				</div>
			</section>

			{/* ---------- CTA final ---------- */}
			<section className="mx-auto max-w-6xl px-6 pb-8">
				<div className="relative overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center text-primary-foreground">
					<div
						aria-hidden
						className="absolute -top-24 left-1/2 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-white/10 blur-3xl"
					/>
					<div className="relative">
						<h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
							Termine o dia sem prontuário pendente.
						</h2>
						<p className="mx-auto mt-3 max-w-md text-sm text-primary-foreground/75">
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
				</div>
			</section>
		</div>
	);
}
