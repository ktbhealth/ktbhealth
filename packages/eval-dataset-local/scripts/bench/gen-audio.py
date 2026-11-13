import asyncio, os
from pathlib import Path
import edge_tts

OUT = Path(os.environ.get("BENCH_AUDIO_DIR", Path(__file__).parent / "audio"))
OUT.mkdir(parents=True, exist_ok=True)

SAMPLES = [
    ("s0", "pt-BR-FranciscaNeural", "O paciente nega alergia a medicamentos e refere dor de cabeça há três dias."),
    ("s1", "pt-BR-AntonioNeural", "Prescrevo dipirona quinhentos miligramas, um comprimido de oito em oito horas."),
    ("s2", "pt-BR-FranciscaNeural", "A senhora toma losartana cinquenta miligramas uma vez ao dia, pela manhã."),
    ("s3", "pt-BR-AntonioNeural", "Nega febre, nega dispneia, mas refere episódios de tontura ao levantar."),
    ("s4", "pt-BR-ThalitaMultilingualNeural", "Solicito hemograma completo, glicemia de jejum e retorno em quinze dias."),
]

async def synth(sid, voice, text):
    for attempt in range(6):
        try:
            tts = edge_tts.Communicate(text, voice)
            await tts.save(str(OUT / f"{sid}.mp3"))
            with open(OUT / f"{sid}.txt", "w") as f:
                f.write(text)
            print(f"{sid} ok (attempt {attempt+1})")
            return
        except Exception as e:
            await asyncio.sleep(2 * (attempt + 1))
    print(f"{sid} FAILED")

async def main():
    for s in SAMPLES:
        await synth(*s)
        await asyncio.sleep(1)

asyncio.run(main())
