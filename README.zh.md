# PDF Excerpt · PDF 摘录

[![GitHub release](https://img.shields.io/github/v/release/MetaKnow/obsidian-pdf-excerpt)](https://github.com/MetaKnow/obsidian-pdf-excerpt/releases)
[![License](https://img.shields.io/github/license/MetaKnow/obsidian-pdf-excerpt)](LICENSE)
![Obsidian](https://img.shields.io/badge/Obsidian-1.5.0%2B-7C3AED)

[English](README.md) · **中文**

在 Obsidian 里读 PDF：**选中文字 → 右键 →「加入摘录」**。这段文字带着页码和精确位置，
写进这篇 PDF 专属的 Markdown 笔记，同时在原文上留下可点击的高亮。每篇 PDF 一个自包含文件夹
（笔记 + PDF 副本 + 全部截图），整体搬走、同步、导出都不会丢东西。

> 仅支持**桌面端**（Windows / macOS / Linux）。Obsidian 的 PDF 阅读器本身也只提供桌面端。

---

## 它把什么事变简单了

在 Obsidian 里读 PDF，原本的流程是：切窗口 → 复制 → 回到笔记 → 粘贴 → 手写页码和出处。
读几篇论文之后，笔记里全是不知道从哪来的文段。

这个插件把整件事压成一步，并且顺手把出处、回跳、原文留痕、截图、导出都解决了：

| | 手工复制粘贴 | **PDF 摘录** |
| --- | --- | --- |
| 摘录一段话 | 切窗口、复制、粘贴、手写页码 | 选中 → 右键，结束 |
| 回到原文 | 自己翻回去找 | 点链接，自动跳到那一页并高亮 |
| 原文有没有摘过 | 看不出来 | 摘过的段落保持高亮 |
| 出处会不会丢 | 换个仓库、改个文件名就断 | 链接 + 坐标写在笔记里，笔记自包含 |
| 图和表格 | 手动截图、命名、插入 | 框选一下，全分辨率存进笔记 |
| 攒到 100 条以后 | 只能靠全文搜索 | 侧边面板逐条定位 + 一键导出 |

---

## 核心功能

### 1. 一步摘录，出处自动带上

选中任意文字 → 右键 →「加入摘录」。插件从 pdf.js 的文字层里取出选区，按行合并成矩形、
归一化成 0~1 的坐标，然后 ① 写进笔记 ② 在原文上画高亮 ③ 闪烁一下确认。

- 只在你**确实选中了文字**时才接管右键菜单，其他情况 Obsidian 原生菜单照旧
- 摘录的是文字，落到笔记里是 Obsidian 的 **quote callout**，阅读视图下好看，也能被 Dataview 查询
- 同一段内容摘第二次会被拦下并提示「这段内容已经摘录过了」

### 2. 每条摘录都能点回原文

每段摘录后面跟着一条 Obsidian **原生**的 PDF 子路径链接：

```
[[论文/Attention Is All You Need.pdf#page=3&selection=12,0,14,44|Attention Is All You Need, 第 3 页]]
```

`#page=N&selection=a,b,c,d` 是 Obsidian 自带的能力，**不依赖本插件**——即使哪天禁用插件，
链接照样能跳页并高亮。链接由 `app.fileManager.generateMarkdownLink()` 生成，所以会遵循你设置的
「新链接格式」（Wikilink / 相对路径 / 绝对路径）。

### 3. 原文上留下看得见的高亮

摘录过的段落在 PDF 里以高亮块显示，颜色可配。打开 PDF 时插件会读回坐标自动重绘；
pdf.js 是懒渲染的，插件监听每页的 `data-loaded`，页面一渲染出来就补画，所以刚打开也能立刻看到。

高亮层是 `pointer-events: none` 的覆盖层，不会妨碍你继续在 PDF 里选中文字。

### 4. 每篇 PDF 一个自包含文件夹（最实用的一点）

```
摘录知识库/
└── Attention Is All You Need/
    ├── Attention Is All You Need.md                          ← 摘录笔记
    ├── Attention Is All You Need.pdf                         ← 自动复制进来的原文副本
    └── Attention Is All You Need-第3页-20240506151200.png      ← 这篇 PDF 的截图
```

给一篇 PDF 加**第一条**摘录时，插件会把 PDF 本身也复制一份进这个文件夹，笔记的 `source`
和所有跳转链接都指向副本（只复制一次）。于是这个文件夹是**自包含**的：

- 整个文件夹拷到别的仓库、丢进同步盘、或导出给别人，笔记和原文都还在
- 原始 PDF 之后被移动、改名、删掉都不影响
- PDF 本来就在摘录文件夹里，或 PDF 在仓库之外（`file:` 打开）时同样成立

同名 PDF 不会互相覆盖：第二篇的子文件夹会带上它原来的目录名消歧
（`摘录知识库/报告 (归档)/报告.md`），仍然冲突时再附加一个路径短哈希。

从旧版本升级、笔记还平铺着的话，执行一次命令
**「整理摘录笔记（移入以 PDF 命名的子文件夹）」** 即可批量搬家，并把找得到的 PDF 一并复制进去。

### 5. 截图摘录：图、表格、公式

面板上点截图按钮 → 在 PDF 页面上拖拽框选 → 松手即入库。图片直接从页面 canvas 裁切，
**全分辨率**，不受当前缩放影响；`Esc` 取消。

截图不记录位置、不参与重复判断，所以同一页可以截很多张。删除截图摘录时，对应的 PNG 会一并删除。

### 6. 侧边面板 + 一键导出

面板跟随当前打开的 PDF 自动切换，列出这篇 PDF 的全部摘录：

- **点任意卡片 = 跳回 PDF 原文**（截图卡片跳到截图所在页并闪烁页面边框）
- 每张卡片可定位、复制文本、删除
- 标题栏右到左：截图、打开摘录笔记、**导出整个摘录文件夹**、刷新

导出走**系统对话框**，由你选保存位置，导出后不自动打开：

- 面板的「导出」按钮导出的是这篇 PDF 的**整个文件夹**（笔记 + 全部截图），不是单个 md
- 命令面板的「导出全部 PDF 摘录为 …」把全库汇总成 **Markdown / CSV / JSON / HTML**

---

## 安装

**从社区插件市场安装**（已上架后）：设置 → 第三方插件 → 浏览 → 搜索 `PDF Excerpt`。

**手动安装**：

1. 从 [Releases](https://github.com/MetaKnow/obsidian-pdf-excerpt/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放进 `<你的仓库>/.obsidian/plugins/pdf-excerpt/`
3. Obsidian → 设置 → 第三方插件 → 关闭「受限模式」→ 启用 **PDF Excerpt**

---

## 快速上手

1. 在 Obsidian 里打开任意 PDF
2. 选中一段文字（跨行、整段都可以）
3. 右键 → **加入摘录**
4. 搞定。笔记会在主编辑区以**阅读视图**打开（可在设置里关掉），之后每条摘录都追加进同一篇笔记

面板入口：左侧功能区的荧光笔图标、右侧边栏顶部的按钮，或命令面板执行 **PDF 摘录: 打开 PDF 摘录面板**。

---

## 命令面板

| 命令 | 说明 |
| --- | --- |
| 将选中的 PDF 文字加入摘录 | 等价于右键「加入摘录」 |
| 截图并加入摘录笔记 | 在 PDF 页面上框选截图 |
| 打开当前 PDF 的摘录笔记 | 打开 / 创建对应笔记 |
| 打开 PDF 摘录面板 | 显示右侧面板 |
| 显示 / 隐藏 PDF 中的摘录高亮 | 临时隐藏所有高亮 |
| 导出全部 PDF 摘录为 Markdown / CSV / JSON / HTML | 汇总全库摘录 |
| 迁移旧版摘录笔记（改为隐藏的几何数据） | 把早期笔记里可见的 `<!-- -->` 几何注释改写成隐藏的 `%%` 形式 |
| 整理摘录笔记（移入以 PDF 命名的子文件夹） | 把平铺的旧笔记搬进各自子文件夹，并把 PDF 复制进去 |

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 摘录文件夹 | `摘录知识库` | 每篇 PDF 的摘录笔记存放位置，留空为仓库根目录 |
| 导出文件夹 | `摘录知识库/导出` | 拿不到系统对话框时的兜底导出位置 |
| 首次摘录时自动打开笔记 | 开 | 某篇 PDF 第一次产生摘录时，在主编辑区打开笔记 |
| 以阅读视图打开摘录笔记 | 开 | 打开摘录笔记时用阅读视图而不是编辑模式 |
| 摘录后闪烁提示 | 开 | 摘录成功后闪烁对应的原文位置 |
| 高亮颜色 | `#ffd400` | PDF 中摘录区域的高亮色 |
| 显示侧边栏图标 | 开 | 显示面板按钮（左侧功能区 + 右侧边栏顶部）|

打开摘录笔记时会复用已经开着的那个标签页，不会重复开页；「以阅读视图打开」**优先于** Obsidian
全局的「新标签默认视图」设置。

---

## 笔记格式

```markdown
---
type: pdf-excerpt
source: "摘录知识库/Attention Is All You Need/Attention Is All You Need.pdf"
title: "Attention Is All You Need"
count: 2
created: "2024-05-06T07:08:00.000Z"
updated: "2024-05-06T07:09:12.000Z"
---

# 摘录 · Attention Is All You Need

> [!quote] 第 3 页 · 2024-05-06 15:08
> The dominant sequence transduction models are based on complex recurrent
> or convolutional neural networks.
>
> [[Attention Is All You Need.pdf#page=3&selection=12,0,14,44|Attention Is All You Need, 第 3 页]]

%% pdf-excerpt {"id":"e4f2a91","page":3,"created":1714979280000,"rects":[[0.1103,0.1544,0.7831,0.0161]],"sel":"12,0,14,44"} %%

> [!quote] 截图 · 第 20 页 · 2024-05-06 15:12
> ![[摘录知识库/Attention Is All You Need/Attention Is All You Need-第20页-20240506151200.png]]
```

- 正文用 quote callout 包裹：阅读视图里好看，也能被 Dataview 查询
- 反链由 `app.fileManager.generateMarkdownLink()` 生成，所以会遵循你设置的「新链接格式」。
  笔记和 PDF 副本在同一个文件夹里，因此默认设置下链接就是文件名本身（`[[Attention Is All You Need.pdf#page=3&…]]`）
- 那行 `%% … %%` 是 Obsidian 的**注释语法**，阅读视图和实时预览里完全不显示，只有源码模式可见。
  高亮坐标就存在里面，所以**笔记是自包含的**：正文干干净净，把笔记复制到别的仓库，高亮信息也跟着走
- 坐标是相对页面 canvas 的归一化值（0~1），所以缩放、改窗口大小、重新渲染都不会错位
- 截图摘录只有 `id` 和页码，没有 `rects`，也不参与重复判断

---

## 隐私与文件访问

- **完全不联网**：没有网络请求、没有遥测、不需要账号，也不会上传任何内容。
- **正常使用时只通过 Obsidian 自己的 `Vault` API 读写你的仓库**：摘录、高亮、截图全部在仓库内完成。
- **只有「导出」会访问仓库之外的文件**（这是本插件唯一用到 Node `fs` 模块的地方）：
  面板的「导出整个摘录文件夹」按钮会调用系统文件夹选择框
  （`electron.dialog`，回退到 `@electron/remote`），**由你亲手选定目标目录**；你确认之后，
  插件才用 `fs.promises.cp()` 把该 PDF 的摘录文件夹复制过去。
  除此之外任何时候都不读写仓库外的文件，目标路径也永远不会被自动指定。
  如果你从不使用导出功能，仓库 API 之外的代码不会被执行。
- 插件标记 `isDesktopOnly: true` 正是因为用到了 Node / Electron API（Obsidian 的 PDF 阅读器本身也只有桌面端）。

---

## 已知限制与兼容性

- **仅桌面端**。Obsidian 的 PDF 阅读器只在桌面端提供。
- 每次摘录请在**同一个页面内**选择；跨页拖选暂不支持。
- Obsidian 没有为 PDF 阅读器提供公开 API，本插件依赖部分内部 DOM 结构（`.textLayer`、`.page`、
  pdf.js 的渲染时机），所有访问都做了防御性判断，形状不符时安静地退化为「什么也不做」而不是报错。
  如果 Obsidian 大版本更新后 PDF 阅读器结构变化，最可能受影响的是高亮层与选区坐标；
  右键菜单与笔记写入依赖的路径相对稳定。
- 右键接管利用的是 Obsidian 自身处理函数开头的 `if (e.defaultPrevented) return;`：插件在
  `document` 上以**捕获阶段**监听 `contextmenu`，只在确实有选区时 `preventDefault()`。

## 开发

```bash
npm install
npm run dev        # 监听构建
npm run typecheck  # tsc --noEmit
npm test           # node --test（纯函数单测）
npm run build      # 类型检查 + 生产构建
npm run deploy     # 把产物同步到 Obsidian 插件目录

# 端到端冒烟测试：用 jsdom 加载真正的 main.js，跑完整的用户流程
cd tools/smoke && npm install && node harness.cjs
```

> `npm run build` 只把产物写到仓库根目录，而 Obsidian 加载的是仓库里那份**拷贝**。改完代码记得
> `npm run deploy -- --to "<你的仓库>/.obsidian/plugins/pdf-excerpt"`（也可以把目标目录写进仓库根
> 目录的 `.deploy-target`，之后直接 `npm run deploy`），再回 Obsidian 执行一次「重新加载应用」。

冒烟测试不需要打开 Obsidian：它伪造一个极简 vault、PDF 阅读器 DOM 和 `obsidian` 模块，然后依次
验证右键菜单、笔记落盘与路径、PDF 副本、去重、高亮覆盖层、删除、截图、导出、侧边栏按钮以及
`onunload` 清理是否干净。

源码结构：

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 插件入口：命令、右键菜单、高亮生命周期、导出、截图入库 |
| `src/screenshot.ts` | 在 PDF 页面上框选并从页面 canvas 裁出 PNG |
| `src/pdf-view.ts` | 与 Obsidian PDF 阅读器内部结构对接、选区捕获 |
| `src/highlight-layer.ts` | PDF 页面内的摘录高亮覆盖层 |
| `src/excerpt-markdown.ts` | 摘录笔记的序列化 / 解析（纯函数，可单测） |
| `src/excerpt-store.ts` | 笔记定位、读写、去重、缓存、PDF 副本 |
| `src/sidebar.ts` | 右侧摘录面板 |
| `src/export.ts` | 汇总导出（Markdown / CSV / JSON / HTML） |
| `src/settings.ts` | 设置页 |

发布到社区目录的完整步骤见 [PUBLISHING.md](PUBLISHING.md)。

## 许可证

[MIT](LICENSE)
