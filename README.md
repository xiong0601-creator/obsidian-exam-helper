# 备考助手 · Obsidian 插件

![license](https://img.shields.io/badge/license-MIT-blue)
![obsidian](https://img.shields.io/badge/Obsidian-%E2%89%A51.4.0-purple)
![AI](https://img.shields.io/badge/AI-%E5%8F%AF%E9%80%89-lightgrey)

**把 Obsidian 里的备考笔记，直接变成题库。**

刷题、背诵、错题本、资料检索，都在侧栏里完成；AI 讲解和出题可选，用你自己的 API Key。
笔记不出本机，不需要注册账号，也没有服务器。

> 适合：教师招聘、事业单位、公务员、考证、考研专业课……凡是「资料在笔记里、题不够做」的备考。

---

## 为什么做这个

备考的人手里通常有两样东西：一堆资料（PDF、讲义、笔记），和一颗「不知道记住没有」的心。

市面上的刷题 App 要么让你把资料传上去，要么题不是你的考纲；而笔记软件里资料躺着，翻一遍花两小时，合上就忘。

这个插件做的事很简单：**你按一个固定格式写笔记，它就自动变成题库**，然后按刷题、背诵、错题本三套流程，把「看过」变成「做对」。

## 功能

| 功能 | 说明 |
| --- | --- |
| 刷题 | 从笔记里抽选择题，点选项立刻判分，给解析、给原文出处，点一下跳回笔记那一行 |
| 背诵 | 没有选项的 Q/A 自动变成卡；按 1/3/7/15/30 天间隔安排下一次，记不住就重来 |
| 错题本 | 做错自动收进来，点一下重做，做对就移出 |
| 资料检索 | 在题库范围内搜题干、答案、解析，结果定位到文件和行号 |
| 统计 | 今日进度、总正确率、连续天数、错题数、最近 7 天柱状图 |
| AI 讲解（可选） | 对当前这道题讲：为什么对、其它选项错在哪、最易混的概念怎么分 |
| AI 出题（可选） | 打开一篇笔记，让模型按笔记内容生成 5 道单选题，可直接插入笔记 |

## 安装

**方式一：手动装（推荐，最快）**

1. 到 [Releases](https://github.com/xiong0601-creator/obsidian-exam-helper/releases) 下载 `manifest.json`、`main.js`、`styles.css`（或整个 zip 解压）
2. 放到你的库：`<你的库>/.obsidian/plugins/beikao-helper/`
3. Obsidian 设置 → 第三方插件 → 关闭安全模式 → 刷新 → 启用「备考助手」

**方式二：BRAT**

装了 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 的话，Add Beta Plugin 填
`xiong0601-creator/obsidian-exam-helper` 即可，更新也归它管。

**注意**：插件 id 是 `beikao-helper`，文件夹名要一致。

## 快速开始（3 步）

1. 在库里建一个文件夹，比如 `备考资料`（名字可改，在插件设置里填同一个）
2. 在里面新建笔记，按下面格式写
3. 点左侧丝带图标（毕业帽）→ 出一题

### 题目格式

选择题：

```markdown
Q: 社区教育最本质的特征不包括下列哪一项？
A. 全员性
B. 服务性
C. 地域性
D. 公益性
答案: B
解析: 服务性是社区服务的特征，不是社区教育最本质的特征。
考点: 社区教育基础
```

背诵卡（不写选项就行）：

```markdown
Q: 社区教育三大基本属性是什么？
答案: 公益性、普惠性、便民性
```

规则很简单：

- `Q:` 或 `问：` 开头一行题干
- `A.` `B.` `C.` `D.` 开头一行一个选项（也认 `A、` `A)`）
- `答案:` 写字母或选项原文都行
- `解析:` 可选；`空行` 结束一道题

示例笔记在 [`examples/`](examples/)，复制进你的库里就能刷。

## AI 配置（可选）

插件本身不联网。要开 AI，在设置里填四样：

| 项 | 例子 |
| --- | --- |
| 接口地址 | `https://api.openai.com/v1` 或 `https://api.deepseek.com/v1` 或 `http://localhost:11434/v1` |
| API Key | 你自己的 key |
| 模型名 | `gpt-4o-mini` / `deepseek-chat` / `qwen2.5:7b` |

任何 OpenAI 兼容的 `/chat/completions` 都能用。Key 只写进本库的 `data.json`，不会上传到任何地方。

## 隐私

- 笔记、题目、进度全部留在你的库里
- 不启用 AI 时，插件**完全不发网络请求**
- 启用 AI 后，只有你主动点「AI 讲解 / AI 出题」时，才会把当前这道题或当前笔记发给你的接口

## 路线图

- [x] 刷题 / 背诵 / 错题本 / 检索 / 统计
- [x] 可选 AI 讲解与出题
- [ ] 填空题模式（挖空自测）
- [ ] 按考点筛选与薄弱项统计
- [ ] 题目去重与导入预览
- [ ] 移动端布局微调
- [ ] 上架 Obsidian 官方社区插件列表

## 已知限制

- 解析是**按格式**的，格式写错就不会被识别；建议先用 `examples/` 试一遍
- 选择题答案必须能对上选项（字母或原文），对不上的会被跳过
- AI 生成的题质量取决于模型，插入前请自己过一眼
- 题库是启动时读进内存的，改完笔记点「重新导入题库」才会更新

## 贡献

Issue / PR 都欢迎。提 bug 时请附：笔记片段（可脱敏）、Obsidian 版本、插件版本、复现步骤。

## License

[MIT](LICENSE)。题目和笔记内容归你，插件代码归本项目。

> 免责声明：这是学习工具，不押题、不承诺通过率。资料和答案请以官方考纲与权威教材为准。

---

### English (short)

**Beikao Helper** turns your Obsidian notes into a practice question bank: multiple-choice drills, spaced-repetition cards, a wrong-answer book, and full-text search — all local. Optional AI (bring your own key, any OpenAI-compatible endpoint) explains mistakes and drafts new questions from a note. Write `Q:` / `A.` / `答案:` blocks and you're set.
