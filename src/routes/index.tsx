import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<div>
			<section className="py-16 text-center">
				<h1 className="text-5xl font-bold tracking-tight">
					Sua consulta, documentada.
				</h1>
				<p className="mx-auto mt-4 max-w-xl text-lg text-neutral-600">
					Fale com o paciente, não com a tela. A anamnese sai estruturada da
					conversa — você só revisa e aprova.
				</p>
				<Link
					to="/consulta/nova"
					className="mt-8 inline-block rounded-lg bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-700"
				>
					Iniciar consulta
				</Link>
			</section>

			<section className="grid gap-4 sm:grid-cols-3">
				{[
					{
						title: "Transcrição ao vivo",
						desc: "Reconhecimento de voz pt-BR direto no browser — sem instalação.",
					},
					{
						title: "Anamnese com evidência",
						desc: "Cada campo aponta a frase da consulta que o fundamenta. Nunca re-ouça o áudio.",
					},
					{
						title: "LGPD por desenho",
						desc: "O áudio não sai do navegador. Só a transcrição é processada.",
					},
				].map((f) => (
					<div
						key={f.title}
						className="rounded-xl border border-neutral-200 p-5"
					>
						<div className="font-semibold">{f.title}</div>
						<div className="mt-1 text-sm text-neutral-600">{f.desc}</div>
					</div>
				))}
			</section>
		</div>
	);
}
