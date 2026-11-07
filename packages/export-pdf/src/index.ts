import PDFDocument from "pdfkit";

import type { Anamnesis, AnamnesisSectionKey } from "@ktb/anamnesis";
import { SECTION_LABELS } from "@ktb/anamnesis";

export interface AnamnesisPdfInput {
	consultationId: number;
	createdAt: Date;
	patientName: string | null;
	doctorName: string | null;
	consentAt: Date | null;
	anamnesis: Anamnesis;
}

const fmt = (d: Date) => d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Renders the reviewed anamnese as an A4 PDF (standard fonts, pt-BR safe). */
export function renderAnamnesisPdf(input: AnamnesisPdfInput): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const doc = new PDFDocument({
			size: "A4",
			margins: { top: 56, bottom: 64, left: 56, right: 56 },
			bufferPages: true,
			info: {
				Title: `Anamnese · consulta #${input.consultationId}`,
				Author: input.doctorName ?? "anamnese",
			},
		});
		const chunks: Buffer[] = [];
		doc.on("data", (c: Buffer) => chunks.push(c));
		doc.on("end", () => resolve(Buffer.concat(chunks)));
		doc.on("error", reject);

		const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

		// ---- header ----
		doc.font("Helvetica-Bold").fontSize(20).fillColor("#111").text("Anamnese");
		doc.moveDown(0.3);
		doc.font("Helvetica").fontSize(9.5).fillColor("#555");
		doc.text(`Consulta #${input.consultationId} · ${fmt(input.createdAt)}`);
		if (input.patientName) doc.text(`Paciente: ${input.patientName}`);
		if (input.doctorName) doc.text(`Médico: ${input.doctorName}`);
		doc.text(
			input.consentAt
				? `Consentimento do paciente declarado em ${fmt(input.consentAt)}`
				: "Consentimento do paciente: não registrado",
		);
		doc.moveDown(0.6);
		const y = doc.y;
		doc
			.moveTo(doc.page.margins.left, y)
			.lineTo(doc.page.margins.left + width, y)
			.strokeColor("#ddd")
			.stroke();
		doc.moveDown(0.8);

		// ---- sections ----
		for (const key of Object.keys(SECTION_LABELS) as AnamnesisSectionKey[]) {
			const content = input.anamnesis[key]?.content?.trim() || "Não informado";
			// keep a heading together with the start of its text
			if (doc.y > doc.page.height - doc.page.margins.bottom - 70) doc.addPage();
			doc
				.font("Helvetica-Bold")
				.fontSize(11)
				.fillColor("#111")
				.text(SECTION_LABELS[key].toUpperCase(), { characterSpacing: 0.4 });
			doc.moveDown(0.15);
			doc.font("Helvetica").fontSize(10.5).fillColor("#222").text(content, { width, lineGap: 2 });
			doc.moveDown(0.9);
		}

		// ---- signature ----
		if (doc.y > doc.page.height - doc.page.margins.bottom - 90) doc.addPage();
		doc.moveDown(2);
		const sy = doc.y;
		doc
			.moveTo(doc.page.margins.left, sy)
			.lineTo(doc.page.margins.left + 220, sy)
			.strokeColor("#888")
			.stroke();
		doc
			.font("Helvetica")
			.fontSize(9)
			.fillColor("#555")
			.text(input.doctorName ?? "Médico responsável", doc.page.margins.left, sy + 4);

		// ---- footer on every page ----
		const range = doc.bufferedPageRange();
		for (let i = range.start; i < range.start + range.count; i++) {
			doc.switchToPage(i);
			// writing inside the bottom margin would make pdfkit add a page
			doc.page.margins.bottom = 0;
			const fy = doc.page.height - 40;
			doc
				.font("Helvetica")
				.fontSize(8)
				.fillColor("#999")
				.text(
					"Rascunho estruturado por IA a partir da transcrição, revisado e validado pelo médico responsável.",
					doc.page.margins.left,
					fy,
					{ width: width - 60, lineBreak: false },
				)
				.text(`${i + 1}/${range.count}`, doc.page.margins.left + width - 40, fy, {
					width: 40,
					align: "right",
					lineBreak: false,
				});
		}
		doc.end();
	});
}
