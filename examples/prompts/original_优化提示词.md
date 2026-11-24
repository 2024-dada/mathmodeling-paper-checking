# 论文专项优化提示词：original

> 使用方法：把整段提示词连同论文全文（或 LaTeX 源码）一起发给 AI。本提示词只列出问题句，请另外附上论文全文。

## 角色与硬约束
你是一名数学建模竞赛（MCM/ICM）的资深评委兼写作教练。请按下面的诊断结果修改这篇英文论文，输出语言与原文一致（英文）。
必须遵守：
1. **不改动任何数字、公式、模型设定和结论方向**；不新增论文里没有的数据、实验或文献。
2. 需要新增分析才能支撑的地方，不要编造，写成 `[需补充分析：具体做什么]` 留给作者。
3. 保留论文的 Report on Use of AI Tools（竞赛要求如实披露 AI 使用）。
4. 不做同义词替换式的“降重”；每处修改都必须让论证更扎实或更有本队特色。

## 一、底气：防御性语言优化
诊断：全文防御性语言率 **0.0%**（摘要 0%，正文 0%），防御强度 0.0 分/千词。目标：摘要 ≤ 10%，正文 ≤ 8%。

评委读到满篇“这不是预测”“仅为示意”“无法识别”时，会觉得作者对自己的结果没底气。改写原则：
- 每个核心结论写成三步：**结论（带数字）→ 支撑证据（验证/对比/检验结果）→ 稳健性（扰动后是否仍成立）**。
- 不确定性用数字表达（区间、误差、灵敏度），不用语气词表达。
- 必要的局限集中写一次，并且每条都说明如何控制或缓解它。
- 摘要只保留一句最关键的适用范围声明，其余位置给出具体发现。

分类改写策略：

需要处理的句子（按防御强度排序，最多 30 条）：

| # | 位置 | 类别 | 原句 |
|---|---|---|---|

## 二、区分度：去同质化
大家用同一个 AI 写同一道题，表述和段落结构会高度趋同。评委一天看几十篇，雷同的段落会直接被略过。
诊断：总重复率 **33.9%**（逐字 20.2%，改写相似 13.7%）。最相似的来源：suspect（33.9%）

改写原则：
- **写出选择的理由**：为什么用这个模型、这个参数、这种数据处理方式，而不用常见做法。理由正是别人写不出来的部分。
- **用本文独有的证据开头**：具体到某一季、某个对象、某个反常案例，不要用题目背景复述开头。
- **重组结构**：问题驱动（先给答案，再说怎么得到），而不是千篇一律的“背景 → 方法 → 结果”。
- **给模型和关键指标起本队的名字**，并在图表、结论中前后呼应。
- 和赛题原文、公共数据描述相同的句子可以保留，但尽量压缩成一句。

请先基于论文已有结果，提出 **3 个能让本文与众不同的切入角度**（每个一句话，标明依据的是文中哪个结果），再按这些角度改写下面的段落。

逐字重复的片段：

- 「The combined system finishes in 101 years, while the elevator alone needs 187 years」（与 suspect 相同）
- 「Each harbor lifts cargo to an apex anchor, and rockets carry it onward to the Moon」（与 suspect 相同）
- 「site. The minimum cut of this network bounds the annual throughput of the whole system」（与 suspect 相同）

与其他论文高度相似的句子：

| # | 本文 | 相似来源 | 来源原句 | 相似度 |
|---|---|---|---|---|
| 1 | The elevator chain is the cheapest option when no deadline is imposed. | suspect | When no deadline is imposed the elevator chain is the cheapest choice. | 75% |
| 2 | The source node represents the material pool on Earth and the sink node represents completed delivery at the lunar site. | suspect | In the network, the source node stands for the material pool on Earth while the sink node stands for finished delivery at the lunar site. | 74% |

## 三、输出格式
1. 先给出 3 个差异化切入角度（如果有第二部分）。
2. 再用表格逐条给出：`原句 | 修改后 | 修改理由（对应上面哪条原则）`。
3. 最后给出改写后的**摘要全文**（这是评委最先读、也最影响印象的部分）。
4. 列出所有 `[需补充分析：…]` 的位置，作为作者的待办清单。
