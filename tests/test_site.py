"""网页前端（site/）测试：JS 引擎与 Python 结果一致、本地服务托管与转发。"""
import json
import shutil
import subprocess
import threading
import urllib.request
from pathlib import Path

import pytest

from papersim.defensive import analyze, load_lexicon
from papersim.duplication import check_all
from papersim.extract import Document, clean, read_raw
from papersim.web.server import make_server

ROOT = Path(__file__).resolve().parent.parent
EX = ROOT / "examples"


def test_lexicon_in_sync():
    assert json.loads((ROOT / "site/lexicon.json").read_text(encoding="utf-8")) == \
        json.loads((ROOT / "papersim/lexicon.json").read_text(encoding="utf-8"))


@pytest.mark.skipif(not shutil.which("node"), reason="需要 node")
def test_js_engine_matches_python(tmp_path):
    names = ["suspect", "original"]
    texts = {n: clean(read_raw(EX / f"{n}.txt")) for n in names}
    docs = [Document.from_text(texts[n], n) for n in names]
    lex = load_lexicon()
    py = {d.name: [len(d.sentences), d.n_words, round(u.exact_rate, 4), round(u.paraphrase_rate, 4),
                   round(analyze(d, lex).rate, 4), len(u.pairs)] for d, u in zip(docs, check_all(docs))}
    (tmp_path / "in.json").write_text(json.dumps(texts), encoding="utf-8")
    script = tmp_path / "run.mjs"
    script.write_text(f"""
import fs from "fs";
import {{ makeDocument, checkAll, analyzeDef, compileLexicon, buildPrompt }} from "{(ROOT / 'site/engine.js').as_uri()}";
const lex = compileLexicon(JSON.parse(fs.readFileSync("{(ROOT / 'site/lexicon.json').as_posix()}", "utf8")));
const t = JSON.parse(fs.readFileSync("{(tmp_path / 'in.json').as_posix()}", "utf8"));
const docs = Object.entries(t).map(([n, x]) => makeDocument(x, n, true));
const dup = await checkAll(docs);
const out = {{}};
docs.forEach((d, i) => {{ const f = analyzeDef(d, lex);
  out[d.name] = [d.sentences.length, d.nWords, +dup[i].exact.toFixed(4), +dup[i].paraphrase.toFixed(4), +f.rate.toFixed(4), dup[i].pairs.length];
  out[d.name + "_prompt"] = buildPrompt(d, dup[i], f, lex).includes("底气"); }});
console.log(JSON.stringify(out));
""", encoding="utf-8")
    js = json.loads(subprocess.run(["node", str(script)], capture_output=True, text=True, check=True).stdout)
    for n in names:
        assert js[n] == py[n], (n, js[n], py[n])
    assert js["suspect_prompt"] is True


@pytest.fixture(scope="module")
def app():
    srv = make_server(0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.status, r.headers.get("Content-Type"), r.read()


def test_serves_site(app):
    _, ct, b = get(app + "/")
    assert "text/html" in ct and b'src="app.js' in b
    _, ct, _ = get(app + "/engine.js")
    assert "javascript" in ct
    _, ct, _ = get(app + "/vendor/pdf.min.mjs")
    assert "javascript" in ct
    assert json.loads(get(app + "/api/ping")[2]) == {"papersim": True}


def test_no_path_traversal(app):
    with pytest.raises(urllib.error.HTTPError):
        get(app + "/../pyproject.toml")
    with pytest.raises(urllib.error.HTTPError):
        get(app + "/%2e%2e/pyproject.toml")


def test_proxy_rejects_plain_http(app):
    req = urllib.request.Request(app + "/api/proxy", data=json.dumps({"url": "http://example.com/x"}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        assert "https" in json.load(r)["error"]


@pytest.mark.skipif(not shutil.which("node"), reason="需要 node")
def test_js_loose_json_and_quotes(tmp_path):
    script = tmp_path / "t.mjs"
    script.write_text(f"""
import {{ parseJSONLoose, locateQuote }} from "{(ROOT / 'site/engine.js').as_uri()}";
const doc = "The mixed system is fastest. The combined system finishes in 101 years.";
console.log(JSON.stringify([
  parseJSONLoose('好的：\\n```json\\n{{"a":[1]}}\\n```'),
  parseJSONLoose('<think>{{x}}</think> {{"logic":[]}} 完'),
  locateQuote(doc, "The mixed system is  fastest."),
  locateQuote(doc, "“the combined system finishes in 101 years”"),
  locateQuote(doc, "made up sentence that is absent"),
]));
""", encoding="utf-8")
    out = json.loads(subprocess.run(["node", str(script)], capture_output=True, text=True, check=True).stdout)
    assert out == [{"a": [1]}, {"logic": []}, "The mixed system is fastest.", "The combined system finishes in 101 years", None]


@pytest.mark.skipif(not shutil.which("node"), reason="需要 node")
def test_writing_guidance_contracts():
    subprocess.run(["node", "--test", str(ROOT / "tests/writing-guidance.test.mjs"),
                    str(ROOT / "tests/writing-guidance-recovery.test.mjs"),
                    str(ROOT / "tests/writing-context.test.mjs"),
                    str(ROOT / "tests/pdf-reading-order.test.mjs"),
                    str(ROOT / "tests/writing-style.test.mjs"),
                    str(ROOT / "tests/writing-date-definitions.test.mjs")],
                   capture_output=True, text=True, encoding="utf-8", check=True)
