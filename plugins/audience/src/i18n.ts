/**
 * Audience landing plugin copy, one typed catalog per locale. Plugins
 * cannot import the host's Paraglide output (arch lint); the host injects
 * the active locale through the landing page props and the page resolves
 * its strings here. A locale catalog must implement `AudienceMessages`
 * in full — a missing key is a type error, not an English fallback.
 *
 * Keys mirror the landing subset of the host Paraglide catalogs
 * (apps/web/messages/*.json); `persona_*` was renamed `audience_*`.
 */

export const AUDIENCE_LOCALES = ["en", "pt-BR", "es"] as const;
export type AudienceLocale = (typeof AUDIENCE_LOCALES)[number];
export const BASE_LOCALE: AudienceLocale = "en";

export interface AudienceMessages {
	readonly faq1_a: string;
	readonly faq1_q: string;
	readonly faq2_a: string;
	readonly faq2_q: string;
	readonly faq3_a: string;
	readonly faq3_q: string;
	readonly faq4_a: string;
	readonly faq4_q: string;
	readonly faq5_a: string;
	readonly faq5_q: string;
	readonly feat_anam_desc: string;
	readonly feat_anam_title: string;
	readonly feat_hpi: string;
	readonly feat_privacy_desc: string;
	readonly feat_privacy_p1: string;
	readonly feat_privacy_p2: string;
	readonly feat_privacy_p3: string;
	readonly feat_privacy_title: string;
	readonly feat_review_desc: string;
	readonly feat_review_i1: string;
	readonly feat_review_i2: string;
	readonly feat_review_i3: string;
	readonly feat_review_title: string;
	readonly feat_trans_desc: string;
	readonly feat_trans_title: string;
	readonly foryou_business_p1: string;
	readonly foryou_business_p2: string;
	readonly foryou_business_p3: string;
	readonly foryou_business_title: string;
	readonly foryou_developers_p1: string;
	readonly foryou_developers_p2: string;
	readonly foryou_developers_p3: string;
	readonly foryou_developers_title: string;
	readonly foryou_doctors_p1: string;
	readonly foryou_doctors_p2: string;
	readonly foryou_doctors_p3: string;
	readonly foryou_doctors_title: string;
	readonly foryou_eyebrow: string;
	readonly foryou_patients_p1: string;
	readonly foryou_patients_p2: string;
	readonly foryou_patients_p3: string;
	readonly foryou_patients_title: string;
	readonly hero_business_badge: string;
	readonly hero_business_subtitle: string;
	readonly hero_business_title_a: string;
	readonly hero_business_title_b: string;
	readonly hero_developers_badge: string;
	readonly hero_developers_subtitle: string;
	readonly hero_developers_title_a: string;
	readonly hero_developers_title_b: string;
	readonly hero_docs_cta: string;
	readonly hero_doctors_badge: string;
	readonly hero_doctors_subtitle: string;
	readonly hero_doctors_title_a: string;
	readonly hero_doctors_title_b: string;
	readonly hero_how_cta: string;
	readonly hero_patients_badge: string;
	readonly hero_patients_subtitle: string;
	readonly hero_patients_title_a: string;
	readonly hero_patients_title_b: string;
	readonly home_context_note: string;
	readonly home_cta_button: string;
	readonly home_cta_start: string;
	readonly home_cta_sub: string;
	readonly home_cta_title: string;
	readonly home_cta_view: string;
	readonly home_faq_eyebrow: string;
	readonly home_faq_title: string;
	readonly home_features_eyebrow: string;
	readonly home_features_title: string;
	readonly home_stats_1: string;
	readonly home_stats_2: string;
	readonly home_stats_3: string;
	readonly home_stats_source: string;
	readonly home_steps_eyebrow: string;
	readonly home_steps_title: string;
	readonly mock_a1: string;
	readonly mock_anamnesis: string;
	readonly mock_cc: string;
	readonly mock_cc_evidence: string;
	readonly mock_cc_text: string;
	readonly mock_conf_high: string;
	readonly mock_conf_high_short: string;
	readonly mock_conf_med: string;
	readonly mock_conf_med_short: string;
	readonly mock_dr_ana: string;
	readonly mock_live_transcription: string;
	readonly mock_meds: string;
	readonly mock_meds_text: string;
	readonly mock_patient: string;
	readonly mock_q1: string;
	readonly mock_q2: string;
	readonly mock_recording: string;
	readonly mock_review_lead: string;
	readonly mock_review_rest: string;
	readonly mock_sample: string;
	readonly never_1: string;
	readonly never_2: string;
	readonly never_3: string;
	readonly never_4: string;
	readonly never_eyebrow: string;
	readonly never_quote_a: string;
	readonly never_quote_b: string;
	readonly never_title: string;
	readonly audience_business: string;
	readonly audience_developers: string;
	readonly audience_doctors: string;
	readonly audience_label: string;
	readonly audience_patients: string;
	readonly step1_desc: string;
	readonly step1_title: string;
	readonly step2_desc: string;
	readonly step2_title: string;
	readonly step3_desc: string;
	readonly step3_title: string;
	readonly step4_desc: string;
	readonly step4_title: string;
}

const en: AudienceMessages = {
	faq1_a:
		"Audio is captured only after explicit patient consent and is processed to produce the draft. Transcription can run locally or on the server, always under your control; you can also point to your own model (including a local one via Ollama) to keep everything in your environment.",
	faq1_q: "How is my consultation audio handled?",
	faq2_a:
		"No. KTB Health generates a structured draft from what was said in the consultation. Each field shows the confidence and the source sentences, and the final record is always reviewed and approved by a physician. KTB is a tool, not a decision-maker: the physician holds total decision.",
	faq2_q: "Does the AI diagnose or prescribe?",
	faq3_a:
		"Yes. We start with telemedicine because remote capture is simpler: the bot joins Meet, Zoom, Teams, and WhatsApp Web calls, or you can capture the browser tab audio directly. In-person consultations are a core part of the vision — we are extending the same ambient capture to the consultation room.",
	faq3_q: "Does it work for teleconsultations and in-person visits?",
	faq4_a:
		"Every consultation requires an explicit declaration that the patient was informed and consented to the recording. The consent record stays linked to the consultation and the generated anamnesis.",
	faq4_q: "How does patient consent work?",
	faq5_a:
		"Yes. Extraction supports Anthropic, OpenAI, Cloudflare Workers AI, local Ollama, and a heuristic fallback engine. The choice is configuration, not code.",
	faq5_q: "Can I choose which AI model to use?",
	feat_anam_desc:
		"Each field shows the confidence and the source sentences. You review the text without re-listening to the consultation.",
	feat_anam_title: "Anamnesis with evidence",
	feat_hpi: "History of illness",
	feat_privacy_desc:
		"LGPD by architecture, not by disclaimer: explicit patient consent on every consultation, audio under the physician's control, and the option to run 100% in your environment.",
	feat_privacy_p1: "Capture only after explicit consent",
	feat_privacy_p2: "Audio under the physician's control",
	feat_privacy_p3: "On-premise possible, synthetic data in the demo",
	feat_privacy_title: "Privacy by design",
	feat_review_desc:
		"You edit each section, check the evidence, and approve. Nothing enters the record without your ok.",
	feat_review_i1: "Free editing per section",
	feat_review_i2: "Sentence-by-sentence evidence",
	feat_review_i3: "PDF ready to export",
	feat_review_title: "Review and approval",
	feat_trans_desc:
		"KTB captures the consultation audio, stores it, transcribes it, and processes it into a structured draft. The physician uses it as a tool — every field traceable to what was said.",
	feat_trans_title: "Ambient scribe",
	foryou_business_p1:
		"No diagnosis, prescription or clinical decision, in any layer of the product.",
	foryou_business_p2: "Consent on every consultation and LGPD by architecture, not by disclaimer.",
	foryou_business_p3: "Deploy in the cloud or on-premise, inside the hospital.",
	foryou_business_title: "Documentation, never decision",
	foryou_developers_p1:
		"Model providers are swappable configuration: Anthropic, OpenAI, Cloudflare Workers AI, local Ollama or a heuristic engine.",
	foryou_developers_p2:
		"Every domain is a plugin that owns its routes, views and server functions.",
	foryou_developers_p3: "Run it on-premise, with your own model on your own GPU.",
	foryou_developers_title: "Ports, adapters and plugins",
	foryou_doctors_p1: "In person, by teleconsultation or by phone, without changing your workflow.",
	foryou_doctors_p2: "Every anamnesis field shows the consultation sentence that grounds it.",
	foryou_doctors_p3: "You review, edit and sign. Nothing enters the record without you.",
	foryou_doctors_title: "Document without leaving the consultation",
	foryou_eyebrow: "For you",
	foryou_patients_p1: "Recording only starts after your explicit consent.",
	foryou_patients_p2: "The audio stays under your doctor's control.",
	foryou_patients_p3: "KTB Health never diagnoses or decides your treatment: your doctor does.",
	foryou_patients_title: "Your data, your consent",
	hero_business_badge: "For clinics and partners",
	hero_business_subtitle:
		"Physicians spend 49% of the office day on records and desk work and only 27% with patients. KTB Health gives that time back, with documentation-only positioning and LGPD by architecture.",
	hero_business_title_a: "Less paperwork.",
	hero_business_title_b: "More time with patients.",
	hero_developers_badge: "For developers",
	hero_developers_subtitle:
		"A TypeScript monorepo where transcription and model providers are adapters behind ports, and every domain ships as a plugin. Run it in the cloud or in your own environment.",
	hero_developers_title_a: "Clinical documentation,",
	hero_developers_title_b: "built to plug in.",
	hero_docs_cta: "Read the docs",
	hero_doctors_badge: "Clinical documentation by voice",
	hero_doctors_subtitle:
		"Talk to the patient, not to the screen. KTB Health listens to the consultation, transcribes it and structures the anamnesis with evidence citations. You review, edit and sign.",
	hero_doctors_title_a: "The doctor decides.",
	hero_doctors_title_b: "KTB Health records.",
	hero_how_cta: "How it works",
	hero_patients_badge: "For patients",
	hero_patients_subtitle:
		"Recording only starts with your explicit consent. The audio stays under your doctor's control, and nothing enters your record without their review and signature.",
	hero_patients_title_a: "Your doctor looks at you.",
	hero_patients_title_b: "KTB Health records.",
	home_context_note:
		"Every consultation becomes lasting context. The next one already starts with the history on screen.",
	home_cta_button: "Start now",
	home_cta_start: "Start consultation",
	home_cta_sub: "Try it with the sample transcript, no microphone needed.",
	home_cta_title: "Always documentation. Never decision.",
	home_cta_view: "View consultations",
	home_faq_eyebrow: "Questions",
	home_faq_title: "Frequently asked questions",
	home_features_eyebrow: "Why KTB",
	home_features_title: "Built for the exam room, not the paperwork",
	home_stats_1: "of the office day with the patient",
	home_stats_2: "on records and desk work",
	home_stats_3: "of paperwork per hour with the patient, plus 1 to 2 hours at night",
	home_stats_source:
		"Source: Sinsky C. et al. Allocation of Physician Time in Ambulatory Practice. Annals of Internal Medicine, 2016;165(11):753-760. Direct observation of 57 physicians in 4 specialties, USA; night hours from diaries of 21 of them.",
	home_steps_eyebrow: "How it works",
	home_steps_title: "From conversation to medical record in four steps",
	mock_a1: "Suddenly, in the frontal region. It gets worse at night and knocks me down.",
	mock_anamnesis: "Anamnesis",
	mock_cc: "Chief complaint",
	mock_cc_evidence: "“The pain started suddenly, in the frontal region…”",
	mock_cc_text: "Intense frontal headache for 3 days, worse at night.",
	mock_conf_high: "high confidence",
	mock_conf_high_short: "high",
	mock_conf_med: "medium confidence",
	mock_conf_med_short: "medium",
	mock_dr_ana: "Dr. Ana",
	mock_live_transcription: "Live transcription",
	mock_meds: "Current medications",
	mock_meds_text: "Losartan 50 mg, once daily.",
	mock_patient: "Patient",
	mock_q1: "When did the pain start?",
	mock_q2: "Do you take any medication?",
	mock_recording: "recording…",
	mock_review_lead: "You review:",
	mock_review_rest: "each section shows the source sentence before saving.",
	mock_sample: "sample",
	never_1: "Never makes a diagnosis",
	never_2: "Never decides conduct or treatment",
	never_3: "Never suggests what the doctor should think",
	never_4: "Never replaces clinical judgment",
	never_eyebrow: "Positioning",
	never_quote_a: "The doctor reviews, edits and approves.",
	never_quote_b: "Nothing enters the record without a signature.",
	never_title: "What KTB Health never does",
	audience_business: "Business",
	audience_developers: "Developers",
	audience_doctors: "Doctors",
	audience_label: "View as",
	audience_patients: "Patients",
	step1_desc:
		"Captures the consultation, only with consent: microphone, video call tab or a pasted transcript.",
	step1_title: "Listens",
	step2_desc: "The audio becomes text, with doctor and patient separated.",
	step2_title: "Transcribes",
	step3_desc:
		"In seconds, the text becomes the anamnesis, each section with the consultation sentence that grounds it.",
	step3_title: "Structures",
	step4_desc:
		"You edit, check the evidence and sign. Nothing enters the record without your signature.",
	step4_title: "The doctor reviews",
};

const ptBR: AudienceMessages = {
	faq1_a:
		"O áudio só é capturado após consentimento explícito do paciente e é processado para gerar o rascunho. A transcrição pode rodar local ou no servidor, sempre sob o seu controle; você também pode apontar para o seu próprio modelo (inclusive um local via Ollama) para manter tudo no seu ambiente.",
	faq1_q: "Como o áudio da consulta é tratado?",
	faq2_a:
		"Não. O KTB Health gera um rascunho estruturado a partir do que foi dito na consulta. Cada campo mostra a confiança e as frases de origem, e a ficha final é sempre revisada e aprovada por um médico. O KTB é uma ferramenta, não um decisor: o médico tem decisão total.",
	faq2_q: "A IA diagnostica ou prescreve?",
	faq3_a:
		"Sim. Começamos pela telemedicina porque a captura remota é mais simples: o bot entra em chamadas do Meet, Zoom, Teams e WhatsApp Web, ou você captura o áudio da aba do navegador diretamente. O atendimento presencial é parte central da visão — estamos estendendo a mesma captura ambiente para o consultório.",
	faq3_q: "Funciona para teleconsultas e consultas presenciais?",
	faq4_a:
		"Toda consulta exige uma declaração explícita de que o paciente foi informado e consentiu com a gravação. O registro de consentimento fica vinculado à consulta e à anamnese gerada.",
	faq4_q: "Como funciona o consentimento do paciente?",
	faq5_a:
		"Sim. A extração suporta Anthropic, OpenAI, Cloudflare Workers AI, Ollama local e um motor heurístico de fallback. A escolha é configuração, não código.",
	faq5_q: "Posso escolher qual modelo de IA usar?",
	feat_anam_desc:
		"Cada campo mostra a confiança e as frases de origem. Você revisa o texto sem ouvir a consulta de novo.",
	feat_anam_title: "Anamnese com evidência",
	feat_hpi: "História da doença atual",
	feat_privacy_desc:
		"LGPD por arquitetura, não por disclaimer: consentimento explícito do paciente em toda consulta, áudio sob controle do médico e a opção de rodar 100% no seu ambiente.",
	feat_privacy_p1: "Captura só após consentimento explícito",
	feat_privacy_p2: "Áudio sob controle do médico",
	feat_privacy_p3: "On-premise possível, dados sintéticos na demo",
	feat_privacy_title: "Privacidade por design",
	feat_review_desc:
		"Você edita cada seção, confere a evidência e aprova. Nada entra na ficha sem o seu ok.",
	feat_review_i1: "Edição livre por seção",
	feat_review_i2: "Evidência frase a frase",
	feat_review_i3: "PDF pronto para exportar",
	feat_review_title: "Revisão e aprovação",
	feat_trans_desc:
		"O KTB capta o áudio da consulta, armazena, transcreve e processa tudo em um rascunho estruturado. O médico usa como ferramenta — cada campo rastreável ao que foi dito.",
	feat_trans_title: "Scribe ambiente",
	foryou_business_p1:
		"Sem diagnóstico, prescrição ou decisão clínica, em nenhuma camada do produto.",
	foryou_business_p2: "Consentimento em toda consulta e LGPD por arquitetura, não por disclaimer.",
	foryou_business_p3: "Implante na nuvem ou on-premise, dentro do hospital.",
	foryou_business_title: "Documentação, nunca decisão",
	foryou_developers_p1:
		"Provedores de modelo são configuração: Anthropic, OpenAI, Cloudflare Workers AI, Ollama local ou um motor heurístico.",
	foryou_developers_p2:
		"Cada domínio é um plugin dono das suas rotas, telas e funções de servidor.",
	foryou_developers_p3: "Rode on-premise, com o seu próprio modelo na sua GPU.",
	foryou_developers_title: "Portas, adaptadores e plugins",
	foryou_doctors_p1: "Presencial, teleconsulta ou telefone, sem mudar o seu fluxo.",
	foryou_doctors_p2: "Cada campo da anamnese mostra a frase da consulta que o fundamenta.",
	foryou_doctors_p3: "Você revisa, edita e assina. Nada entra no prontuário sem você.",
	foryou_doctors_title: "Documente sem sair da consulta",
	foryou_eyebrow: "Para você",
	foryou_patients_p1: "A gravação só começa depois do seu consentimento explícito.",
	foryou_patients_p2: "O áudio fica sob controle do seu médico.",
	foryou_patients_p3:
		"A KTB Health nunca diagnostica nem decide o seu tratamento: quem decide é o seu médico.",
	foryou_patients_title: "Seus dados, seu consentimento",
	hero_business_badge: "Para clínicas e parceiros",
	hero_business_subtitle:
		"Médicos passam 49% do dia no consultório em prontuário e burocracia, e só 27% com o paciente. A KTB Health devolve esse tempo, com posicionamento só de documentação e LGPD por arquitetura.",
	hero_business_title_a: "Menos papelada.",
	hero_business_title_b: "Mais tempo com o paciente.",
	hero_developers_badge: "Para desenvolvedores",
	hero_developers_subtitle:
		"Um monorepo TypeScript em que transcrição e provedores de modelo são adaptadores atrás de portas, e cada domínio é um plugin. Rode na nuvem ou no seu próprio ambiente.",
	hero_developers_title_a: "Documentação clínica,",
	hero_developers_title_b: "feita para integrar.",
	hero_docs_cta: "Ler a documentação",
	hero_doctors_badge: "Documentação clínica por voz",
	hero_doctors_subtitle:
		"Converse com o paciente, não com a tela. A KTB Health escuta a consulta, transcreve e estrutura a anamnese com citações de evidência. Você revisa, edita e assina.",
	hero_doctors_title_a: "O médico decide.",
	hero_doctors_title_b: "A KTB Health registra.",
	hero_how_cta: "Como funciona",
	hero_patients_badge: "Para pacientes",
	hero_patients_subtitle:
		"A gravação só começa com o seu consentimento explícito. O áudio fica sob controle do seu médico, e nada entra no seu prontuário sem a revisão e a assinatura dele.",
	hero_patients_title_a: "Seu médico olha para você.",
	hero_patients_title_b: "A KTB Health registra.",
	home_context_note:
		"Cada consulta vira contexto duradouro. A próxima já começa com o histórico na tela.",
	home_cta_button: "Começar agora",
	home_cta_start: "Iniciar consulta",
	home_cta_sub: "Teste com a transcrição de exemplo, sem precisar de microfone.",
	home_cta_title: "Sempre documentação. Nunca decisão.",
	home_cta_view: "Ver consultas",
	home_faq_eyebrow: "Dúvidas",
	home_faq_title: "Perguntas frequentes",
	home_features_eyebrow: "Por que KTB",
	home_features_title: "Feito para o consultório, não para a papelada",
	home_stats_1: "do dia no consultório com o paciente",
	home_stats_2: "em prontuário e burocracia",
	home_stats_3: "de papelada por hora com o paciente, e mais 1 a 2 horas por noite",
	home_stats_source:
		"Fonte: Sinsky C. et al. Allocation of Physician Time in Ambulatory Practice. Annals of Internal Medicine, 2016;165(11):753-760. Observação direta de 57 médicos de 4 especialidades, EUA; horas noturnas por diário de 21 deles.",
	home_steps_eyebrow: "Como funciona",
	home_steps_title: "Da conversa ao prontuário em quatro passos",
	mock_a1: "De repente, na região frontal. Piora à noite e me derruba.",
	mock_anamnesis: "Anamnese",
	mock_cc: "Queixa principal",
	mock_cc_evidence: "“A dor começou de repente, na região frontal…”",
	mock_cc_text: "Cefaleia frontal intensa há 3 dias, pior à noite.",
	mock_conf_high: "confiança alta",
	mock_conf_high_short: "alta",
	mock_conf_med: "confiança média",
	mock_conf_med_short: "média",
	mock_dr_ana: "Dra. Ana",
	mock_live_transcription: "Transcrição ao vivo",
	mock_meds: "Medicamentos atuais",
	mock_meds_text: "Losartana 50 mg, uma vez ao dia.",
	mock_patient: "Paciente",
	mock_q1: "Quando a dor começou?",
	mock_q2: "Toma algum medicamento?",
	mock_recording: "gravando…",
	mock_review_lead: "Você revisa:",
	mock_review_rest: "cada seção mostra a frase de origem antes de salvar.",
	mock_sample: "exemplo",
	never_1: "Nunca emite diagnóstico",
	never_2: "Nunca decide conduta ou tratamento",
	never_3: "Nunca sugere o que o médico deveria pensar",
	never_4: "Nunca substitui o julgamento clínico",
	never_eyebrow: "Posicionamento",
	never_quote_a: "O médico revisa, edita e aprova.",
	never_quote_b: "Nada entra no prontuário sem assinatura.",
	never_title: "O que a KTB Health nunca faz",
	audience_business: "Negócios",
	audience_developers: "Desenvolvedores",
	audience_doctors: "Médicos",
	audience_label: "Ver como",
	audience_patients: "Pacientes",
	step1_desc:
		"Capta a consulta, só com consentimento: microfone, aba da videochamada ou transcrição colada.",
	step1_title: "Escuta",
	step2_desc: "O áudio vira texto, com médico e paciente separados.",
	step2_title: "Transcreve",
	step3_desc:
		"Em segundos, o texto vira a anamnese, cada seção com a frase da consulta que a fundamenta.",
	step3_title: "Estrutura",
	step4_desc:
		"Você edita, confere as evidências e assina. Nada entra no prontuário sem a sua assinatura.",
	step4_title: "O médico revisa",
};

const es: AudienceMessages = {
	faq1_a:
		"El audio solo se capta tras el consentimiento explícito del paciente y se procesa para generar el borrador. La transcripción puede ejecutarse local o en el servidor, siempre bajo su control; también puede apuntar a su propio modelo (incluso uno local vía Ollama) para mantener todo en su entorno.",
	faq1_q: "¿Cómo se maneja el audio de la consulta?",
	faq2_a:
		"No. KTB Health genera un borrador estructurado a partir de lo que se dijo en la consulta. Cada campo muestra la confianza y las frases de origen, y la ficha final siempre es revisada y aprobada por un médico. KTB es una herramienta, no un decisor: el médico tiene decisión total.",
	faq2_q: "¿La IA diagnostica o prescribe?",
	faq3_a:
		"Sí. Empezamos por la telemedicina porque la captura remota es más simple: el bot se une a llamadas de Meet, Zoom, Teams y WhatsApp Web, o puede capturar el audio de la pestaña del navegador directamente. La atención presencial es parte central de la visión — estamos extendiendo la misma captura ambiental al consultorio.",
	faq3_q: "¿Funciona para teleconsultas y consultas presenciales?",
	faq4_a:
		"Toda consulta exige una declaración explícita de que el paciente fue informado y consintió la grabación. El registro de consentimiento queda vinculado a la consulta y a la anamnesis generada.",
	faq4_q: "¿Cómo funciona el consentimiento del paciente?",
	faq5_a:
		"Sí. La extracción admite Anthropic, OpenAI, Cloudflare Workers AI, Ollama local y un motor heurístico de respaldo. La elección es configuración, no código.",
	faq5_q: "¿Puedo elegir qué modelo de IA usar?",
	feat_anam_desc:
		"Cada campo muestra la confianza y las frases de origen. Usted revisa el texto sin volver a escuchar la consulta.",
	feat_anam_title: "Anamnesis con evidencia",
	feat_hpi: "Historia de la enfermedad actual",
	feat_privacy_desc:
		"LGPD por arquitectura, no por descargo: consentimiento explícito del paciente en cada consulta, audio bajo control del médico y la opción de ejecutar el 100% en su entorno.",
	feat_privacy_p1: "Captura solo tras consentimiento explícito",
	feat_privacy_p2: "Audio bajo control del médico",
	feat_privacy_p3: "On-premise posible, datos sintéticos en la demo",
	feat_privacy_title: "Privacidad por diseño",
	feat_review_desc:
		"Usted edita cada sección, verifica la evidencia y aprueba. Nada entra en la ficha sin su visto bueno.",
	feat_review_i1: "Edición libre por sección",
	feat_review_i2: "Evidencia frase por frase",
	feat_review_i3: "PDF listo para exportar",
	feat_review_title: "Revisión y aprobación",
	feat_trans_desc:
		"KTB capta el audio de la consulta, lo almacena, lo transcribe y lo procesa en un borrador estructurado. El médico lo usa como herramienta — cada campo trazable a lo que se dijo.",
	feat_trans_title: "Scribe ambiental",
	foryou_business_p1:
		"Sin diagnóstico, prescripción ni decisión clínica, en ninguna capa del producto.",
	foryou_business_p2: "Consentimiento en cada consulta y LGPD por arquitectura, no por descargo.",
	foryou_business_p3: "Despliegue en la nube u on-premise, dentro del hospital.",
	foryou_business_title: "Documentación, nunca decisión",
	foryou_developers_p1:
		"Los proveedores de modelos son configuración: Anthropic, OpenAI, Cloudflare Workers AI, Ollama local o un motor heurístico.",
	foryou_developers_p2:
		"Cada dominio es un plugin dueño de sus rutas, vistas y funciones de servidor.",
	foryou_developers_p3: "Ejecútelo on-premise, con su propio modelo en su GPU.",
	foryou_developers_title: "Puertos, adaptadores y plugins",
	foryou_doctors_p1: "Presencial, teleconsulta o teléfono, sin cambiar su flujo de trabajo.",
	foryou_doctors_p2:
		"Cada campo de la anamnesis muestra la frase de la consulta que lo fundamenta.",
	foryou_doctors_p3: "Usted revisa, edita y firma. Nada entra en la historia clínica sin usted.",
	foryou_doctors_title: "Documente sin salir de la consulta",
	foryou_eyebrow: "Para usted",
	foryou_patients_p1: "La grabación solo comienza tras su consentimiento explícito.",
	foryou_patients_p2: "El audio queda bajo el control de su médico.",
	foryou_patients_p3: "KTB Health nunca diagnostica ni decide su tratamiento: lo decide su médico.",
	foryou_patients_title: "Sus datos, su consentimiento",
	hero_business_badge: "Para clínicas y socios",
	hero_business_subtitle:
		"Los médicos pasan el 49% de la jornada en la historia clínica y tareas administrativas, y solo el 27% con el paciente. KTB Health devuelve ese tiempo, solo como documentación y con la LGPD por arquitectura.",
	hero_business_title_a: "Menos papeleo.",
	hero_business_title_b: "Más tiempo con el paciente.",
	hero_developers_badge: "Para desarrolladores",
	hero_developers_subtitle:
		"Un monorepo TypeScript donde la transcripción y los proveedores de modelos son adaptadores detrás de puertos, y cada dominio es un plugin. Ejecútelo en la nube o en su propio entorno.",
	hero_developers_title_a: "Documentación clínica,",
	hero_developers_title_b: "hecha para integrarse.",
	hero_docs_cta: "Leer la documentación",
	hero_doctors_badge: "Documentación clínica por voz",
	hero_doctors_subtitle:
		"Hable con el paciente, no con la pantalla. KTB Health escucha la consulta, la transcribe y estructura la anamnesis con citas de evidencia. Usted revisa, edita y firma.",
	hero_doctors_title_a: "El médico decide.",
	hero_doctors_title_b: "KTB Health registra.",
	hero_how_cta: "Cómo funciona",
	hero_patients_badge: "Para pacientes",
	hero_patients_subtitle:
		"La grabación solo comienza con su consentimiento explícito. El audio queda bajo el control de su médico, y nada entra en su historia clínica sin su revisión y firma.",
	hero_patients_title_a: "Su médico lo mira a usted.",
	hero_patients_title_b: "KTB Health registra.",
	home_context_note:
		"Cada consulta se convierte en contexto duradero. La siguiente ya comienza con el historial en pantalla.",
	home_cta_button: "Comenzar ahora",
	home_cta_start: "Iniciar consulta",
	home_cta_sub: "Pruebe con la transcripción de ejemplo, sin necesidad de micrófono.",
	home_cta_title: "Siempre documentación. Nunca decisión.",
	home_cta_view: "Ver consultas",
	home_faq_eyebrow: "Dudas",
	home_faq_title: "Preguntas frecuentes",
	home_features_eyebrow: "Por qué KTB",
	home_features_title: "Hecho para el consultorio, no para el papeleo",
	home_stats_1: "de la jornada con el paciente",
	home_stats_2: "en historia clínica y tareas administrativas",
	home_stats_3: "de papeleo por hora con el paciente, y 1 a 2 horas más por la noche",
	home_stats_source:
		"Fuente: Sinsky C. et al. Allocation of Physician Time in Ambulatory Practice. Annals of Internal Medicine, 2016;165(11):753-760. Observación directa de 57 médicos de 4 especialidades, EE. UU.; horas nocturnas según el diario de 21 de ellos.",
	home_steps_eyebrow: "Cómo funciona",
	home_steps_title: "De la conversación a la historia clínica en cuatro pasos",
	mock_a1: "De repente, en la región frontal. Empeora por la noche y me derriba.",
	mock_anamnesis: "Anamnesis",
	mock_cc: "Motivo de consulta",
	mock_cc_evidence: "“El dolor empezó de repente, en la región frontal…”",
	mock_cc_text: "Cefalea frontal intensa desde hace 3 días, peor por la noche.",
	mock_conf_high: "confianza alta",
	mock_conf_high_short: "alta",
	mock_conf_med: "confianza media",
	mock_conf_med_short: "media",
	mock_dr_ana: "Dra. Ana",
	mock_live_transcription: "Transcripción en vivo",
	mock_meds: "Medicamentos actuales",
	mock_meds_text: "Losartán 50 mg, una vez al día.",
	mock_patient: "Paciente",
	mock_q1: "¿Cuándo empezó el dolor?",
	mock_q2: "¿Toma algún medicamento?",
	mock_recording: "grabando…",
	mock_review_lead: "Usted revisa:",
	mock_review_rest: "cada sección muestra la frase de origen antes de guardar.",
	mock_sample: "ejemplo",
	never_1: "Nunca emite un diagnóstico",
	never_2: "Nunca decide la conducta ni el tratamiento",
	never_3: "Nunca sugiere lo que el médico debería pensar",
	never_4: "Nunca reemplaza el juicio clínico",
	never_eyebrow: "Posicionamiento",
	never_quote_a: "El médico revisa, edita y aprueba.",
	never_quote_b: "Nada entra en la historia clínica sin firma.",
	never_title: "Lo que KTB Health nunca hace",
	audience_business: "Negocios",
	audience_developers: "Desarrolladores",
	audience_doctors: "Médicos",
	audience_label: "Ver como",
	audience_patients: "Pacientes",
	step1_desc:
		"Capta la consulta, solo con consentimiento: micrófono, pestaña de la videollamada o transcripción pegada.",
	step1_title: "Escucha",
	step2_desc: "El audio se convierte en texto, con médico y paciente separados.",
	step2_title: "Transcribe",
	step3_desc:
		"En segundos, el texto se convierte en la anamnesis, cada sección con la frase de la consulta que la fundamenta.",
	step3_title: "Estructura",
	step4_desc:
		"Usted edita, revisa la evidencia y firma. Nada entra en la historia clínica sin su firma.",
	step4_title: "El médico revisa",
};

const CATALOGS: Record<AudienceLocale, AudienceMessages> = { en, "pt-BR": ptBR, es };

export const isAudienceLocale = (locale: string): locale is AudienceLocale =>
	(AUDIENCE_LOCALES as readonly string[]).includes(locale);

/** Catalog for a locale tag; unknown tags get the base locale. */
export const audienceMessages = (locale: string): AudienceMessages =>
	CATALOGS[isAudienceLocale(locale) ? locale : BASE_LOCALE];
