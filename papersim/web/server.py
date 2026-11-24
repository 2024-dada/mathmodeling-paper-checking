"""本地网页服务：papersim-web [--port 8765] [--no-browser]

只监听 127.0.0.1。API key 只在本机内存中转发给服务商，不落盘。
"""
import argparse
import base64
import json
import math
import re
import tempfile
import threading
import traceback
import urllib.error
import urllib.request
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from ..extract import Document
from ..pipeline import Options, run
from ..providers import PROVIDERS, detect, test_chat
from ..report import write_csv, write_html, write_json

SITE = Path(__file__).resolve().parents[2] / "site"      # 与 GitHub Pages 共用同一个前端
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"}
ALLOWED = {".pdf", ".txt", ".md", ".tex"}
JOBS = {}
MAX_BODY = 300 * 1024 * 1024


def _clean(x):
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    return x


def _save_files(items, folder: Path):
    paths = []
    for it in items or []:
        name = Path(it.get("name", "file")).name
        if Path(name).suffix.lower() not in ALLOWED:
            continue
        safe = re.sub(r"[\\/:*?\"<>|]", "_", name)
        p = folder / safe
        i = 1
        while p.exists():
            p = folder / f"{Path(safe).stem}_{i}{Path(safe).suffix}"
            i += 1
        p.write_bytes(base64.b64decode(it["data"].split(",", 1)[-1]))
        paths.append(p)
    return paths


def _summary(res):
    rows = []
    for d, u, f, pr, sg in zip(res.docs, res.dup, res.dfn, res.prompts, res.suggestions):
        r = {"name": d.name, "words": d.n_words, "sentences": len(d.sentences), "prompt": pr, "suggestion": sg}
        if u:
            r["dup"] = {"total": u.total_rate, "exact": u.exact_rate, "paraphrase": u.paraphrase_rate,
                        "excluded": u.excluded_rate, "by_source": u.by_source,
                        "pairs": [{"sim": s, "text": a, "source": src, "source_text": b} for s, a, src, b in u.pairs[:15]]}
        if f:
            cats = res.lex["categories"]
            r["def"] = {"rate": f.rate, "summary": f.summary_rate, "body": f.body_rate, "intensity": f.intensity,
                        "llm_rate": f.llm_rate,
                        "by_category": {cats[k]["label"]: v for k, v in f.by_category.items()},
                        "hits": [{"text": h.text, "score": h.score, "zone": "摘要" if h.index < d.summary_cutoff else "正文",
                                  "cats": [cats[c]["label"] for c in h.categories]}
                                 for h in sorted(f.hits, key=lambda h: -h.score)[:20]]}
        rows.append(r)
    return _clean(rows)


def _job(job_id, payload):
    job = JOBS[job_id]
    log = lambda m: job["log"].append(m)
    try:
        work = Path(tempfile.mkdtemp(prefix="papersim_"))
        job["dir"] = work
        o = payload.get("options", {})
        drop = not o.get("keep_references", False)
        groups = {}
        for g in ("papers", "corpus", "exclude"):
            (work / g).mkdir()
            groups[g] = _save_files(payload.get(g), work / g)
        if not groups["papers"]:
            raise ValueError("请至少放入一篇被测论文（PDF / TXT / MD / TEX）")
        log(f"读取 {len(groups['papers'])} 篇论文、{len(groups['corpus'])} 篇比对库、{len(groups['exclude'])} 份赛题原文…")
        docs = [Document.load(p, drop_references=drop) for p in groups["papers"]]
        corpus = [Document.load(p, drop_references=drop) for p in groups["corpus"]]
        exclude = [Document.load(p, drop_references=False) for p in groups["exclude"]]
        for d in docs:
            if len(d.sentences) < 3:
                log(f"注意：{d.name} 几乎没抽出文字，可能是扫描版 PDF")

        api = payload.get("api") or {}
        opt = Options(only=o.get("only") or None, para_threshold=float(o.get("para_threshold", 0.6)),
                      threshold=float(o["threshold"]) if o.get("threshold") not in (None, "") else None,
                      llm_review=bool(o.get("llm_review")), llm_embed=bool(o.get("llm_embed")),
                      apply=bool(o.get("apply")), embed_text=bool(o.get("embed_text")),
                      target_summary=float(o.get("target_summary", 0.10)), target_body=float(o.get("target_body", 0.08)))
        client = None
        if api.get("key") and api.get("model") and (opt.llm_review or opt.llm_embed or opt.apply):
            from ..llm import LLMClient
            client = LLMClient(api_key=api["key"], base_url=api.get("base"), model=api["model"],
                               embed_model=api.get("embed_model") or None)
        elif opt.llm_review or opt.llm_embed or opt.apply:
            log("未填写 API key 或模型，跳过大模型步骤")

        res = run(docs, corpus, exclude, opt, client, log=log)
        write_html(work / "report.html", res.docs, res.dup, res.dfn, res.lex, res.meta, res.prompts)
        write_csv(work / "summary.csv", res.docs, res.dup, res.dfn)
        write_json(work / "report.json", res.docs, res.dup, res.dfn)
        job["result"] = _summary(res)
        job["status"] = "done"
    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        job["trace"] = traceback.format_exc()


def proxy(req):
    """把页面的 API 请求转发给服务商（本地运行时绕开浏览器跨域限制）。只允许 https 或本机地址。"""
    url = req.get("url", "")
    if not (url.startswith("https://") or url.startswith("http://127.0.0.1") or url.startswith("http://localhost")):
        return {"error": "只允许转发 https 地址"}
    headers = {k: v for k, v in (req.get("headers") or {}).items() if k.lower() not in ("host", "content-length", "origin")}
    body = req.get("body")
    r = urllib.request.Request(url, data=body.encode() if isinstance(body, str) else None,
                               headers=headers, method=req.get("method", "GET"))
    try:
        with urllib.request.urlopen(r, timeout=300) as resp:
            return {"status": resp.status, "body": resp.read().decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": e.read().decode("utf-8", "replace")}
    except Exception as e:
        return {"error": f"连接失败：{e}"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(_clean(body), ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self):
        n = int(self.headers.get("Content-Length", 0))
        if n > MAX_BODY:
            raise ValueError("上传内容超过 300MB")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/ping":
            return self._send(200, {"papersim": True})
        if not path.startswith("/api/"):
            rel = "index.html" if path in ("/", "") else path.lstrip("/")
            f = (SITE / rel).resolve()
            if SITE in f.parents and f.is_file():
                return self._send(200, f.read_bytes(), MIME.get(f.suffix, "application/octet-stream"))
            if not SITE.exists():
                return self._send(500, "找不到 site/ 目录，请在仓库目录里用 pip install -e . 安装", "text/plain; charset=utf-8")
        if path == "/api/providers":
            return self._send(200, [{"id": k, "name": v["name"], "base": v["base"]} for k, v in PROVIDERS.items()])
        m = re.fullmatch(r"/api/job/([0-9a-f]+)", path)
        if m and m.group(1) in JOBS:
            j = JOBS[m.group(1)]
            return self._send(200, {k: j.get(k) for k in ("status", "log", "result", "error")})
        m = re.fullmatch(r"/api/job/([0-9a-f]+)/(report\.html|summary\.csv|report\.json)", path)
        if m and m.group(1) in JOBS and JOBS[m.group(1)].get("dir"):
            f = JOBS[m.group(1)]["dir"] / m.group(2)
            if f.exists():
                ctype = {"html": "text/html; charset=utf-8", "csv": "text/csv; charset=utf-8",
                         "json": "application/json; charset=utf-8"}[f.suffix[1:]]
                disp = {} if f.suffix == ".html" else {"Content-Disposition": f'attachment; filename="{f.name}"'}
                return self._send(200, f.read_bytes(), ctype, disp)
        self._send(404, {"error": "not found"})

    def do_POST(self):
        try:
            data = self._json()
            if self.path == "/api/proxy":
                return self._send(200, proxy(data))
            if self.path == "/api/models":
                return self._send(200, detect(data.get("key"), data.get("base") or None))
            if self.path == "/api/test":
                try:
                    return self._send(200, {"ok": True, "reply": test_chat(data["key"], data.get("base"), data["model"])})
                except Exception as e:
                    return self._send(200, {"ok": False, "error": str(e)})
            if self.path == "/api/run":
                jid = uuid.uuid4().hex[:12]
                JOBS[jid] = {"status": "running", "log": []}
                threading.Thread(target=_job, args=(jid, data), daemon=True).start()
                return self._send(200, {"job": jid})
            self._send(404, {"error": "not found"})
        except Exception as e:
            self._send(400, {"error": str(e)})


def make_server(port=8765):
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="papersim-web", description="papersim 本地网页")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args(argv)
    port = a.port
    for _ in range(20):
        try:
            srv = make_server(port)
            break
        except OSError:
            port += 1
    url = f"http://127.0.0.1:{port}/"
    print(f"papersim 网页已启动：{url}（Ctrl+C 退出）")
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
