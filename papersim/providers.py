"""API 服务商识别与模型列表。

输入 key 后：按 key 前缀猜候选服务商 → 并行请求各家 /models → 第一个返回成功的就是它。
填了 base_url 时直接查该地址。
"""
import json
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

PROVIDERS = {
    "deepseek":    {"name": "DeepSeek",      "base": "https://api.deepseek.com/v1",
                    "prefer": ["deepseek-chat", "deepseek-reasoner"]},
    "openai":      {"name": "OpenAI",        "base": "https://api.openai.com/v1",
                    "prefer": ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o"],
                    "embed": ["text-embedding-3-small", "text-embedding-3-large"]},
    "qwen":        {"name": "通义千问",       "base": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "prefer": ["qwen-plus", "qwen-max", "qwen-turbo"], "embed": ["text-embedding-v3"]},
    "moonshot":    {"name": "Kimi (Moonshot)", "base": "https://api.moonshot.cn/v1",
                    "prefer": ["kimi-k2", "moonshot-v1-32k", "moonshot-v1-8k"]},
    "zhipu":       {"name": "智谱 GLM",       "base": "https://open.bigmodel.cn/api/paas/v4",
                    "prefer": ["glm-4-plus", "glm-4-air", "glm-4-flash"], "embed": ["embedding-3"]},
    "siliconflow": {"name": "硅基流动",       "base": "https://api.siliconflow.cn/v1",
                    "prefer": ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"], "embed": ["BAAI/bge-m3"]},
    "openrouter":  {"name": "OpenRouter",    "base": "https://openrouter.ai/api/v1",
                    "prefer": ["deepseek/deepseek-chat", "openai/gpt-4o-mini"]},
    "anthropic":   {"name": "Anthropic",     "base": "https://api.anthropic.com/v1",
                    "prefer": ["sonnet", "haiku"]},
    "gemini":      {"name": "Google Gemini", "base": "https://generativelanguage.googleapis.com/v1beta/openai",
                    "prefer": ["gemini-2.5-flash", "gemini-2.0-flash", "flash"], "embed": ["text-embedding-004"]},
    "volcengine":  {"name": "火山方舟（豆包）", "base": "https://ark.cn-beijing.volces.com/api/v3",
                    "prefer": ["doubao"]},
}

NON_CHAT = re.compile(r"whisper|tts|dall-e|image|audio|speech|moderation|rerank|vision-preview|realtime|transcri|sora|ocr", re.I)
EMBED = re.compile(r"embed|bge|m3e|gte-", re.I)


def candidates_for_key(key: str):
    k = key.strip()
    if k.startswith("sk-ant-"):
        return ["anthropic"]
    if k.startswith("sk-or-"):
        return ["openrouter"]
    if k.startswith("AIza"):
        return ["gemini"]
    if re.fullmatch(r"[0-9a-f]{32}\.[A-Za-z0-9]+", k):
        return ["zhipu"]
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", k):
        return ["volcengine"]
    if k.startswith("sk-proj-") or k.startswith("sk-svcacct-"):
        return ["openai"]
    if k.startswith("sk-"):
        return ["deepseek", "openai", "moonshot", "siliconflow", "qwen"]
    return list(PROVIDERS)


def auth_headers(base: str, key: str):
    h = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if "anthropic.com" in base:
        h.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
    return h


def _get_models(base: str, key: str, timeout=10):
    req = urllib.request.Request(base.rstrip("/") + "/models", headers=auth_headers(base, key))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)
    items = data.get("data", data.get("models", []))
    ids = []
    for m in items:
        mid = m.get("id") or m.get("name") if isinstance(m, dict) else str(m)
        if mid:
            ids.append(mid.removeprefix("models/"))
    return sorted(set(ids))


def classify(ids):
    chat, embed, other = [], [], []
    for i in ids:
        (embed if EMBED.search(i) else other if NON_CHAT.search(i) else chat).append(i)
    return chat, embed, other


def _pick(ids, prefer):
    for p in prefer or []:
        if p in ids:
            return p
        for i in ids:
            if p.lower() in i.lower():
                return i
    return ids[0] if ids else None


def provider_for_base(base: str):
    for k, v in PROVIDERS.items():
        if v["base"].split("//")[1].split("/")[0] in base:
            return k
    return "custom"


def _err_text(e):
    if isinstance(e, urllib.error.HTTPError):
        if e.code in (401, 403):
            return f"HTTP {e.code}：key 无效或无权限"
        if e.code == 404:
            return "HTTP 404：该地址没有 /models 接口"
        return f"HTTP {e.code}"
    if isinstance(e, urllib.error.URLError):
        return f"连接失败：{e.reason}"
    return str(e)


def detect(key: str, base: str = None):
    """返回 {ok, provider, provider_name, base_url, chat, embed, other, default_chat, default_embed, tried, error}"""
    key = (key or "").strip()
    if not key:
        return {"ok": False, "error": "请先填写 API key"}
    if base:
        cands = [(provider_for_base(base), base.rstrip("/"))]
    else:
        cands = [(p, PROVIDERS[p]["base"]) for p in candidates_for_key(key)]

    tried, found = {}, None
    with ThreadPoolExecutor(max_workers=len(cands)) as ex:
        futs = {ex.submit(_get_models, b, key): (p, b) for p, b in cands}
        for f in as_completed(futs):
            p, b = futs[f]
            try:
                ids = f.result()
                if found is None or cands.index((p, b)) < cands.index(found[:2]):
                    found = (p, b, ids)
            except Exception as e:
                tried[PROVIDERS.get(p, {}).get("name", p)] = _err_text(e)

    if not found:
        # 只有一个候选且服务商已知时，给出常用模型，允许手动填写
        if len(cands) == 1 and cands[0][0] in PROVIDERS:
            p = cands[0][0]
            info = PROVIDERS[p]
            return {"ok": False, "provider": p, "provider_name": info["name"], "base_url": cands[0][1],
                    "chat": [x for x in info["prefer"] if "/" in x or "-" in x], "embed": info.get("embed", []),
                    "other": [], "tried": tried,
                    "error": "没能获取模型列表：" + "；".join(f"{k} {v}" for k, v in tried.items()) + "。可以手动输入模型名"}
        return {"ok": False, "tried": tried,
                "error": "没有服务商接受这个 key：" + "；".join(f"{k} {v}" for k, v in tried.items())}

    p, b, ids = found
    chat, embed, other = classify(ids)
    info = PROVIDERS.get(p, {})
    return {"ok": True, "provider": p, "provider_name": info.get("name", "自定义"), "base_url": b,
            "chat": chat, "embed": embed, "other": other,
            "default_chat": _pick(chat, info.get("prefer")),
            "default_embed": _pick(embed, info.get("embed")) if embed else None,
            "tried": tried}


def test_chat(key, base, model):
    from .llm import LLMClient
    c = LLMClient(api_key=key, base_url=base, model=model)
    out = c.chat_text("只回复两个字：可用")
    return out.strip()[:40]
