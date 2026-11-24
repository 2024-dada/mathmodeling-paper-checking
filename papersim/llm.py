"""OpenAI 兼容接口的极简客户端（只用标准库）。

环境变量：
  PAPERSIM_API_KEY      必填
  PAPERSIM_BASE_URL     默认 https://api.openai.com/v1 ；DeepSeek: https://api.deepseek.com/v1
                        通义千问: https://dashscope.aliyuncs.com/compatible-mode/v1 ；Kimi: https://api.moonshot.cn/v1
  PAPERSIM_MODEL        默认 gpt-4o-mini
  PAPERSIM_EMBED_MODEL  可选；设置后改写相似检测会额外使用语义向量
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

import numpy as np

from .providers import auth_headers


class LLMClient:
    def __init__(self, api_key=None, base_url=None, model=None, embed_model=None, timeout=180):
        self.api_key = api_key or os.environ.get("PAPERSIM_API_KEY")
        if not self.api_key:
            raise RuntimeError("未设置 PAPERSIM_API_KEY")
        self.base = (base_url or os.environ.get("PAPERSIM_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        self.model = model or os.environ.get("PAPERSIM_MODEL") or "gpt-4o-mini"
        self.embed_model = embed_model or os.environ.get("PAPERSIM_EMBED_MODEL")
        self.timeout = timeout

    def _post(self, path, body, retries=3):
        req = urllib.request.Request(
            self.base + path, data=json.dumps(body).encode(),
            headers=auth_headers(self.base, self.api_key))
        for k in range(retries):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code in (429, 500, 502, 503) and k < retries - 1:
                    time.sleep(2 ** k * 3)
                    continue
                raise RuntimeError(f"API 错误 {e.code}: {e.read().decode(errors='ignore')[:300]}")

    def chat_json(self, prompt):
        body = {"model": self.model, "temperature": 0,
                "messages": [{"role": "system", "content": "只输出合法 JSON。"},
                             {"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"}}
        try:
            out = self._post("/chat/completions", body)
        except RuntimeError as e:
            if "response_format" in str(e):     # 部分服务不支持 json 模式
                body.pop("response_format")
                out = self._post("/chat/completions", body)
            else:
                raise
        txt = out["choices"][0]["message"]["content"].strip()
        txt = re.sub(r"^```(?:json)?\s*|\s*```$", "", txt)
        return json.loads(txt)

    def chat_text(self, prompt):
        body = {"model": self.model, "temperature": 0.3, "messages": [{"role": "user", "content": prompt}]}
        return self._post("/chat/completions", body)["choices"][0]["message"]["content"]

    def embed(self, texts, batch=64):
        if not self.embed_model:
            return None
        vecs = []
        for i in range(0, len(texts), batch):
            out = self._post("/embeddings", {"model": self.embed_model, "input": texts[i:i + batch]})
            vecs += [d["embedding"] for d in sorted(out["data"], key=lambda d: d["index"])]
        return np.array(vecs)
