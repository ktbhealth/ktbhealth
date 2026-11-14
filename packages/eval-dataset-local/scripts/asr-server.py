#!/usr/bin/env python3
"""asr-server.py — faster-whisper HTTP microservice (T-101).

Keeps one model warm in RAM and serves transcriptions over HTTP so the
TS adapter stays a thin client. stdlib only + faster-whisper — no
FastAPI/uvicorn so RAM stays low on dev machines.

    ASR_MODEL=base ASR_PORT=8765 python scripts/asr-server.py

POST /transcribe  {"audio_path": "/abs/file.wav", "language": "pt"}
  → 200 {"text": str, "language": str,
         "segments": [{"t0": f, "t1": f, "text": str, "confidence": f}]}
  → 4xx/5xx {"error": str}
GET /health → 200 {"model": name, "status": "ok"}
"""

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import faster_whisper

MODEL = os.environ.get("ASR_MODEL", "base")
PORT = int(os.environ.get("ASR_PORT", "8765"))

print(f"[asr-server] loading {MODEL} (int8, cpu)…", flush=True)
MODEL_OBJ = faster_whisper.WhisperModel(MODEL, device="cpu", compute_type="int8")
print(f"[asr-server] ready on :{PORT}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802 — stdlib naming
        if self.path == "/health":
            self._send(200, {"model": MODEL, "status": "ok"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 — stdlib naming
        if self.path != "/transcribe":
            self._send(404, {"error": "not found"})
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            audio_path = body["audio_path"]
            if not os.path.isfile(audio_path):
                self._send(400, {"error": f"audio not found: {audio_path}"})
                return
            language = body.get("language")
            segments, info = MODEL_OBJ.transcribe(audio_path, language=language)
            segs = [
                {
                    "t0": round(s.start, 3),
                    "t1": round(s.end, 3),
                    "text": s.text.strip(),
                    "confidence": round(1.0 - (s.no_speech_prob or 0.0), 4),
                }
                for s in segments
            ]
            self._send(
                200,
                {
                    "text": " ".join(s["text"] for s in segs).strip(),
                    "language": info.language or language,
                    "segments": segs,
                },
            )
        except (KeyError, json.JSONDecodeError) as e:
            self._send(400, {"error": f"bad request: {e}"})
        except Exception:  # noqa: BLE001 — surface everything to the caller
            traceback.print_exc()
            self._send(500, {"error": "transcription failed"})

    def log_message(self, *_args) -> None:
        pass  # quiet — RunRecord carries provenance


if __name__ == "__main__":
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
