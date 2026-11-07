// Spike T-012: valida que getDisplayMedia consegue capturar ÁUDIO de uma aba
// (o mecanismo necessário para transcrever chamadas do WhatsApp Web).
//
// Estratégia: lança Chromium com flags que auto-selecionam a aba alvo no
// seletor de captura, abre uma aba "fonte" que emite um tom via Web Audio e
// chama /teste-captura em outra aba. Se o medidor de nível subir, o caminho
// getDisplayMedia -> áudio de aba -> Web Audio está provado de ponta a ponta.
//
// Flags relevantes do Chromium:
// - --auto-select-tab-capture-source-by-title=<título>: pula o seletor e
//   captura a aba cujo document.title bate com o valor.
// - --autoplay-policy=no-user-gesture-required: permite o AudioContext da aba
//   fonte tocar sem gesto do usuário (headless não tem gesto real).
//
// Reprodução: `bunx playwright test tests/e2e/display-media-audio.spec.ts`
// em apps/web (o webServer do playwright.config.ts sobe `bunx vp dev`).
// Requer DISPLAY/X (roda headful — o headless shell do Playwright não tem
// captura de tela). Se o dev server falhar por auth do wrangler na conta KTB,
// suba-o manualmente com CLOUDFLARE_ACCOUNT_ID=<conta acessível> —
// `reuseExistingServer` faz o Playwright reaproveitar.

import { chromium, expect, test } from "@playwright/test";

const AUDIO_SOURCE_TITLE = "ktb-tab-audio-source";

test.setTimeout(120_000);

test("getDisplayMedia captures tab audio end-to-end", async () => {
	// Headful: o chromium_headless_shell do Playwright não implementa captura
	// de tela (getDisplayMedia rejeita com "Not supported") e o headless novo
	// (channel "chromium") falhou com ERR_NETWORK_CHANGED neste ambiente.
	const browser = await chromium.launch({
		headless: false,
		args: [
			`--auto-select-tab-capture-source-by-title=${AUDIO_SOURCE_TITLE}`,
			"--autoplay-policy=no-user-gesture-required",
			"--allow-http-screen-capture",
		],
	});
	try {
		const context = await browser.newContext();

		// Aba fonte: emite um tom contínuo via Web Audio.
		const audioPage = await context.newPage();
		await audioPage.setContent(`<!doctype html><title>${AUDIO_SOURCE_TITLE}</title>
			<script>
				const ctx = new AudioContext();
				window.__audioCtx = ctx;
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				gain.gain.value = 0.5;
				osc.frequency.value = 440;
				osc.connect(gain).connect(ctx.destination);
				void ctx.resume().then(() => osc.start());
			</script>`);
		// Garante que o AudioContext está rodando (não suspenso por autoplay).
		await expect
			.poll(() => audioPage.evaluate(() => (window as any).__audioCtx?.state), {
				timeout: 10_000,
			})
			.toBe("running");

		// Aba de captura: a página spike.
		const page = await context.newPage();
		page.on("console", (m) => {
			if (m.type() === "error") console.log("[page error]", m.text());
		});
		page.on("pageerror", (e) => console.log("[pageerror]", e.message));
		await page.goto("/teste-captura");
		await page.waitForLoadState("networkidle");

		// O SSR entrega o botão antes da hidratação; clica até o handler
		// responder (status "solicitando…"/"capturando…" ou erro visível).
		// Se o chunk do cliente falhar no load (flake do dev server), recarrega
		// uma vez e tenta de novo.
		const startButton = page.getByRole("button", { name: /iniciar captura/i });
		const feedback = page
			.locator("p")
			.filter({ hasText: /solicitando|capturando|sem áudio|denied|allowed|failed|error/i });
		for (let round = 0; round < 2; round++) {
			for (let attempt = 0; attempt < 3; attempt++) {
				await startButton.click();
				try {
					await expect(feedback.first()).toBeVisible({ timeout: 3_000 });
					break;
				} catch {
					if (attempt === 2 && round === 1)
						throw new Error("clique não produziu feedback — hidratação?");
				}
			}
			// Se o feedback apareceu, sai do loop externo.
			if (
				await feedback
					.first()
					.isVisible()
					.catch(() => false)
			)
				break;
			await page.reload();
			await page.waitForLoadState("networkidle");
		}

		// Se a captura automática funcionou, o status mostra "capturando — track:".
		await expect(page.getByText(/capturando — track:/)).toBeVisible({ timeout: 15_000 });

		// O medidor de nível deve sair de zero — prova de que o áudio da aba
		// fonte está chegando no MediaStream capturado.
		const levelText = page.getByText(/nível:/);
		await expect
			.poll(
				async () => {
					const text = await levelText.textContent();
					const match = text?.match(/nível:\s*([\d.]+)%/);
					return match ? Number(match[1]) : 0;
				},
				{ timeout: 15_000, intervals: [250] },
			)
			.toBeGreaterThan(1);
		console.log(`[spike] nível de áudio capturado: ${await levelText.textContent()}`);
	} finally {
		await browser.close();
	}
});
