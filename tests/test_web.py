"""网页服务与 API 识别测试：用本地模拟的 OpenAI 兼容服务，不访问外网。"""
import base64
import json
import re
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from papersim import providers
from papersim.web.server import make_server

EX = Path(__file__).resolve().parent.parent / "examples"
GOOD_KEY = "sk-test-0123456789abcdef"


class MockAPI(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _auth(self):
        return self.headers.get("Authorization") == f"Bearer {GOOD_KEY}"

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if not self._auth():
            return self._send(401, {"error": "bad key"})
        if self.path == "/v1/models":
            return self._send(200, {"data": [{"id": x} for x in
                                             ["deepseek-chat", "deepseek-reasoner", "text-embedding-3-small", "whisper-1"]]})
        self._send(404, {})

    def do_POST(self):
        if not self._auth():
            return self._send(401, {"error": "bad key"})
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/v1/embeddings":
            return self._send(200, {"data": [{"index": i, "embedding": [len(t) % 7, 1.0, len(t.split()) % 5]}
                                             for i, t in enumerate(body["input"])]})
        prompt = body["messages"][-1]["content"]
        if "防御性语言" in prompt and "items" in prompt:
            items = [{"i": int(i), "defensive": " not " in s or "rather than" in s, "category": "disclaimer"}
                     for i, s in re.findall(r"\[(\d+)\] (.*)", prompt)]
            content = json.dumps({"items": items}, ensure_ascii=False)
        else:
            content = "可用" if "只回复两个字" in prompt else "| 原句 | 修改后 | 理由 |\n|---|---|---|"
        self._send(200, {"choices": [{"message": {"content": content}}]})


@pytest.fixture(scope="module")
def mock_api():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), MockAPI)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}/v1"
    srv.shutdown()


@pytest.fixture(scope="module")
def app():
    srv = make_server(0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def post(url, obj):
    req = urllib.request.Request(url, data=json.dumps(obj).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read()


# ---------------------------------------------------------------- key 识别
@pytest.mark.parametrize("key,expect", [
    ("sk-ant-api03-xxxx", ["anthropic"]),
    ("sk-or-v1-xxxx", ["openrouter"]),
    ("AIzaSyD-xxxx", ["gemini"]),
    ("0123456789abcdef0123456789abcdef.AbCdEf123", ["zhipu"]),
    ("12345678-1234-1234-1234-123456789abc", ["volcengine"]),
    ("sk-proj-xxxx", ["openai"]),
])
def test_key_prefix(key, expect):
    assert providers.candidates_for_key(key) == expect


def test_plain_sk_probes_several():
    c = providers.candidates_for_key("sk-abcdef")
    assert "deepseek" in c and "openai" in c and len(c) >= 3


def test_detect_with_base(mock_api):
    r = providers.detect(GOOD_KEY, mock_api)
    assert r["ok"]
    assert r["chat"] == ["deepseek-chat", "deepseek-reasoner"]
    assert r["embed"] == ["text-embedding-3-small"]
    assert "whisper-1" in r["other"]
    assert r["default_chat"] == "deepseek-chat"


def test_detect_bad_key(mock_api):
    r = providers.detect("sk-wrong-key-000000", mock_api)
    assert not r["ok"] and "key 无效" in r["error"]


def test_detect_autoprobe_picks_working(monkeypatch, mock_api):
    monkeypatch.setitem(providers.PROVIDERS, "deepseek", {**providers.PROVIDERS["deepseek"], "base": "http://127.0.0.1:9/v1"})
    monkeypatch.setitem(providers.PROVIDERS, "openai", {**providers.PROVIDERS["openai"], "base": mock_api})
    monkeypatch.setattr(providers, "candidates_for_key", lambda k: ["deepseek", "openai"])
    r = providers.detect(GOOD_KEY)
    assert r["ok"] and r["provider"] == "openai" and "DeepSeek" in r["tried"]


# ---------------------------------------------------------------- 网页服务
def test_index_and_providers(app):
    assert "papersim" in get(app + "/").decode()
    assert any(p["id"] == "deepseek" for p in json.loads(get(app + "/api/providers")))


def test_models_endpoint(app, mock_api):
    r = post(app + "/api/models", {"key": GOOD_KEY, "base": mock_api})
    assert r["ok"] and r["default_chat"] == "deepseek-chat"


def test_test_endpoint(app, mock_api):
    r = post(app + "/api/test", {"key": GOOD_KEY, "base": mock_api, "model": "deepseek-chat"})
    assert r["ok"] and r["reply"] == "可用"


def _b64(name):
    return {"name": name, "data": "data:text/plain;base64," + base64.b64encode((EX / name).read_bytes()).decode()}


def _wait(app, jid):
    for _ in range(200):
        j = json.loads(get(f"{app}/api/job/{jid}"))
        if j["status"] != "running":
            return j
        time.sleep(0.1)
    raise TimeoutError


def test_run_offline(app):
    jid = post(app + "/api/run", {"papers": [_b64("suspect.txt"), _b64("original.txt")],
                                  "exclude": [_b64("problem.txt")], "options": {}})["job"]
    j = _wait(app, jid)
    assert j["status"] == "done", j.get("error")
    s = {r["name"]: r for r in j["result"]}["suspect"]
    assert s["dup"]["total"] > 0.3 and s["def"]["rate"] > 0.25
    assert "底气" in s["prompt"]
    assert b"<html" in get(f"{app}/api/job/{jid}/report.html")
    assert "suspect" in get(f"{app}/api/job/{jid}/summary.csv").decode("utf-8-sig")


def test_run_with_llm(app, mock_api):
    jid = post(app + "/api/run", {
        "papers": [_b64("suspect.txt"), _b64("original.txt")],
        "options": {"llm_review": True, "llm_embed": True, "apply": True},
        "api": {"key": GOOD_KEY, "base": mock_api, "model": "deepseek-chat", "embed_model": "text-embedding-3-small"}})["job"]
    j = _wait(app, jid)
    assert j["status"] == "done", j.get("error")
    s = {r["name"]: r for r in j["result"]}["suspect"]
    assert s["def"]["llm_rate"] is not None and s["def"]["llm_rate"] > 0
    assert "原句" in s["suggestion"]


def test_run_rejects_empty(app):
    j = _wait(app, post(app + "/api/run", {"papers": [], "options": {}})["job"])
    assert j["status"] == "error" and "至少" in j["error"]


def test_proxy_forwards_to_api(app, mock_api):
    r = post(app + "/api/proxy", {"url": mock_api + "/models", "method": "GET",
                                  "headers": {"Authorization": f"Bearer {GOOD_KEY}"}})
    assert r["status"] == 200 and "deepseek-chat" in r["body"]
    r = post(app + "/api/proxy", {"url": mock_api + "/models", "headers": {"Authorization": "Bearer nope"}})
    assert r["status"] == 401


def test_parse_json_loose():
    from papersim.llm import parse_json_loose
    assert parse_json_loose('好的：\n```json\n{"a": [1]}\n```') == {"a": [1]}
    assert parse_json_loose('<think>{x}</think>结果 {"logic": []} 完') == {"logic": []}
    with pytest.raises(ValueError):
        parse_json_loose("没有 JSON")
