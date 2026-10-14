#!/usr/bin/env python3
"""Local & Cloudflare Tunnel HTTP Server with Gemini AI Question Generator Proxy for k-history-exam."""
import http.server
import json
import os
import ssl
import urllib.request

PORT = 8091
ROOT_DIR = "/Users/leeyoonmin/Documents/hermes/k-history-exam"

def load_env_key():
    env_path = os.path.expanduser("~/.hermes/.env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return os.environ.get("GEMINI_API_KEY", "")

GEMINI_KEY = load_env_key()
SSL_CTX = ssl._create_unverified_context()

class ExamRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def do_POST(self):
        if self.path.startswith("/api/ai-question"):
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            try:
                req_data = json.loads(raw_body)
            except Exception:
                req_data = {}

            era_name = req_data.get("eraName", "조선 후기")
            hint_title = req_data.get("hintTitle", "한국사 핵심 주제")

            if not GEMINI_KEY:
                self.send_response(503)
                self.end_headers()
                return

            prompt = f"""당신은 대한민국 한국사능력검정시험(심화 1~3급) 출제위원입니다.
시대: [{era_name}], 주제 힌트: [{hint_title} 또는 해당 시대의 중요 사건/인물/제도/문화재]
사료 박스 지문이 포함된 5지선다형 객관식 문제 1개를 출제하여 반드시 순수 JSON 객체로만 응답하세요.
{{
  "eraName": "{era_name}",
  "title": "문제 핵심 주제명",
  "points": 2,
  "stem": "다음 자료에 나타난 왕(또는 사건/단체/제도)에 대한 설명으로 옳은 것은?",
  "source": "【사료】\\n실제 역사 사료 풍의 구체적인 3~4문장 지문",
  "choices": ["선지1", "선지2", "선지3", "선지4", "선지5"],
  "answer": 0,
  "keywords": ["핵심키워드1", "핵심키워드2", "핵심키워드3"],
  "explanation": "정답 이유와 시대적 배경에 대한 친절하고 자세한 해설",
  "choiceDetails": ["① 선지 해설", "② 선지 해설", "③ 선지 해설", "④ 선지 해설", "⑤ 선지 해설"]
}}"""

            try:
                api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_KEY}"
                payload = json.dumps({
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"responseMimeType": "application/json", "temperature": 0.85}
                }).encode("utf-8")
                req = urllib.request.Request(api_url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(req, context=SSL_CTX, timeout=12) as resp:
                    resp_json = json.loads(resp.read().decode("utf-8"))
                    txt = resp_json["candidates"][0]["content"]["parts"][0]["text"]
                    clean_json = txt.replace("```json", "").replace("```", "").strip()
                    out_bytes = clean_json.encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(out_bytes)))
                    self.end_headers()
                    self.wfile.write(out_bytes)
                    return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                return

        self.send_response(404)
        self.end_headers()

if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), ExamRequestHandler)
    print(f"Serving k-history-exam on port {PORT}...")
    server.serve_forever()
