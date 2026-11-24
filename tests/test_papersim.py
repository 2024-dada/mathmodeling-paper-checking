from pathlib import Path

import pytest

from papersim.cli import main
from papersim.defensive import analyze, load_lexicon, score_sentence
from papersim.duplication import check
from papersim.extract import Document, split_sentences
from papersim.prompt import build

EX = Path(__file__).resolve().parent.parent / "examples"
LEX = load_lexicon()


# ---------------------------------------------------------------- 防御性语言
@pytest.mark.parametrize("sent", [
    "These are conditional examples, not engineering quotations or forecasts of 2050 prices.",
    "The result is a feasibility analysis, not an estimate of the true ballot count.",
    "Actual vote totals are unavailable.",
    "This does not imply that their present-day capabilities are identical.",
    "Absolute vote totals are unidentifiable without a weekly total.",
    "Under the illustrative assumption of 365 launches per year, rockets carry 456250 tonnes.",
    "该结果并非对真实票数的估计。",
])
def test_defensive_positive(sent):
    assert score_sentence(sent, LEX)[0] >= LEX["threshold"]


@pytest.mark.parametrize("sent", [
    "We sum the judges' scores within each contestant-week.",
    "The mixed system finishes in 101 years.",
    "A maximum-flow network gives the annual capacity of each mode.",
    "The assignment problem only has binary variables.",          # 单个弱信号不计
    "我们对每周评委分数求和。",
])
def test_defensive_negative(sent):
    assert score_sentence(sent, LEX)[0] < LEX["threshold"]


def test_defensive_rates():
    d = Document.load(EX / "suspect.txt")
    r = analyze(d, LEX)
    assert 0.25 < r.rate < 0.6
    assert r.summary_rate >= r.body_rate
    assert analyze(Document.load(EX / "original.txt"), LEX).rate < 0.1


# ---------------------------------------------------------------- 重复率
def test_identical_is_full_duplicate():
    d = Document.load(EX / "original.txt")
    r = check(d, [Document.load(EX / "original.txt", name="copy")])
    assert r.exact_rate > 0.95


def test_unrelated_is_zero():
    a = Document.from_text("Cats sleep for most of the day and hunt at night in quiet gardens.", "a")
    b = Document.from_text("Interest rates rose sharply after the central bank changed its policy stance.", "b")
    assert check(a, [b]).total_rate == 0


def test_suspect_detects_copy_and_paraphrase():
    s, o, p = (Document.load(EX / f) for f in ("suspect.txt", "original.txt", "problem.txt"))
    r = check(s, [o], [p])
    assert r.exact_rate > 0.15
    assert r.paraphrase_rate > 0.05
    assert r.excluded_rate > 0           # 赛题原句单列
    assert r.total_rate <= r.exact_rate + r.paraphrase_rate + 1e-9
    assert any("source node" in a for _, a, _, _ in r.pairs)


def test_exclude_reduces_rate():
    s, o, p = (Document.load(EX / f) for f in ("suspect.txt", "original.txt", "problem.txt"))
    assert check(s, [o], [p]).total_rate < check(s, [o]).total_rate


def test_chinese_duplication():
    a = Document.from_text("本文建立了最大流网络模型来计算每种运输方式的年运力，并用整数规划求解最低成本方案。结果表明混合方案最快。", "a")
    b = Document.from_text("我们建立了最大流网络模型来计算每种运输方式的年运力。另外讨论了其他问题。", "b")
    assert check(a, [b]).exact_rate > 0.3


# ---------------------------------------------------------------- 分句与提示词
def test_heading_not_glued():
    sents = split_sentences("2 Model\nThe source node represents the pool.\n3 Results\nThe mixed plan wins.")
    assert sents == ["The source node represents the pool.", "The mixed plan wins."]


def test_prompt_contents():
    s, o = Document.load(EX / "suspect.txt"), Document.load(EX / "original.txt")
    pr = build(s, check(s, [o]), analyze(s, LEX), LEX)
    assert "底气" in pr and "区分度" in pr
    assert "rather than forecasts" in pr          # 问题句被列出
    assert "不改动任何数字" in pr                  # 硬约束在
    assert "source node" in pr                    # 相似句被列出


def test_cli_end_to_end(tmp_path, capsys):
    out = tmp_path / "r.html"
    main([str(EX / "suspect.txt"), str(EX / "original.txt"), "-x", str(EX / "problem.txt"),
          "-o", str(out), "--csv", str(tmp_path / "s.csv"), "--json", str(tmp_path / "r.json")])
    assert out.exists() and "防御性语言率" in out.read_text(encoding="utf-8")
    assert (tmp_path / "prompts" / "suspect_优化提示词.md").exists()
    assert "suspect" in (tmp_path / "s.csv").read_text(encoding="utf-8-sig")


def test_levels_consistent_with_js():
    import json, re
    from papersim.prompt import LEVELS
    js = (Path(__file__).resolve().parent.parent / "site/engine.js").read_text(encoding="utf-8")
    names = re.findall(r'\{ name: "([^"]+)", summary: ([\d.]+), body: ([\d.]+)', js)
    assert [(n, float(a), float(b)) for n, a, b in names] == [(n, a, b) for n, a, b, _ in LEVELS]


def test_level_changes_prompt():
    s = Document.load(EX / "suspect.txt")
    f = analyze(s, LEX)
    p1, p9 = build(s, None, f, LEX, level=1), build(s, None, f, LEX, level=9)
    assert "摘要 ≤ 2%" in p1 and "绝对自信" in p1
    assert "摘要 ≤ 25%" in p9 and "学术保守" in p9
