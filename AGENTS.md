# 项目约定

## 不写身份标记
- 代码注释、文件头、docstring、README、生成的报告和提示词里，都不写作者或 AI 身份、模型名、"AI-assisted"、生成日期之类的署名。
- git 提交信息和 PR 描述只写改了什么，不加 Co-Authored-By、会话链接、"Generated with" 之类的署名行。
- 注释只写功能、思路、用法和参数含义。
- 竞赛要求的 AI 使用披露只写在论文的 Report on Use of AI Tools 里，不写进代码。

## 写代码
- 直接实现功能，不要写解释性的开场白或签名。
- 改动后运行 `pytest -q`，测试通过再提交。
