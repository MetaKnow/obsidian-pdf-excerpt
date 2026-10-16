# PDF 摘录 (PDF Excerpt)

在 Obsidian 中阅读 PDF 时，选中文字 → 右键 → **加入摘录**，即可把这段内容连同
页码、矩形坐标一起写进这篇 PDF 专属的 Markdown 笔记里，并在 PDF 原文上留下可
点击的高亮。

- 右键菜单与 Obsidian 原生 PDF 菜单风格一致，只在**选中有文字**时接管
- 每篇 PDF 对应一篇摘录笔记，路径确定、可预测、不会互相覆盖
- 复制出的链接带 `#page=N&selection=...`，点击后由 Obsidian 自己跳页并高亮
- 侧边面板列出当前 PDF 的所有摘录，点击即可跳回原文
- 重复内容自动去重，不会把同一段话记两遍
- 一键把全库摘录导出成 Markdown / CSV / JSON / HTML

> 仅支持桌面端（Windows / macOS / Linux）。Obsidian 的 PDF 阅读器本身也只在桌面端提供。

---

## 安装

### 方式一：手动安装（推荐自用）

1. 下载或构建出 `main.js`、`manifest.json`、`styles.css` 三个文件
2. 在你的仓库里创建目录：

   ```
   <你的仓库>/.obsidian/plugins/pdf-excerpt/
   ```

3. 把三个文件放进去
4. 打开 Obsidian → 设置 → 第三方插件 → 关闭「受限模式」→ 启用 **PDF 摘录**

### 方式二：从源码构建

```bash
git clone <this-repo> obsidian-pdf-excerpt
cd obsidian-pdf-excerpt
npm install
npm run build      # 产出 main.js
```

把 `main.js`、`manifest.json`、`styles.css` 复制到插件目录即可。

开发时用 `npm run dev`，esbuild 会监听 `src/` 并在改动后自动重新打包。

---

## 使用

1. 在 Obsidian 里打开任意 PDF
2. 用鼠标选中一段文字（单页、跨行、跨页都可以）
3. 在选区上点右键，菜单里会多出 **加入摘录**
4. 摘录笔记会自动创建并写入；默认情况下，某个 PDF 的**第一条**摘录写入后，
   笔记会在右侧边栏自动打开

如果这一段之前已经摘录过，会提示「这段内容已经摘录过了」，不会重复写入。

### 侧边面板

- 左侧功能区点击书签图标，或命令面板执行 **PDF 摘录: 打开 PDF 摘录面板**
- 面板跟随当前打开的 PDF 自动切换
- 每张卡片支持：定位（跳回 PDF 原文并闪烁）、复制文本、删除

### 命令面板

| 命令 | 说明 |
| --- | --- |
| 将选中的 PDF 文字加入摘录 | 等价于右键「加入摘录」 |
| 打开当前 PDF 的摘录笔记 | 打开 / 创建对应笔记 |
| 打开 PDF 摘录面板 | 显示右侧面板 |
| 显示 / 隐藏 PDF 中的摘录高亮 | 临时隐藏所有高亮 |
| 导出全部 PDF 摘录为 Markdown / CSV / JSON / HTML | 汇总全库摘录 |

---

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 摘录文件夹 | `摘录知识库` | 每篇 PDF 的摘录笔记存放位置，留空为仓库根目录 |
| 导出文件夹 | `摘录知识库/导出` | 导出汇总文件的存放位置 |
| 首次摘录时自动打开笔记 | 开 | 某个 PDF 第一次产生摘录时，在右侧打开笔记 |
| 摘录后闪烁提示 | 开 | 摘录成功后闪烁对应的原文位置 |
| 高亮颜色 | `#ffd400` | PDF 中摘录区域的高亮色 |
| 显示侧边栏图标 | 开 | 在右侧边栏顶部显示面板按钮（左侧功能区也会保留一个图标）|

---

## 摘录笔记的格式

每篇 PDF 对应一篇笔记。所有摘录笔记**平铺**在摘录文件夹里，不按 PDF 所在目录建子文件夹：

```
<摘录文件夹>/<PDF 文件名去掉扩展名>.md
```

例如 `论文/Attention Is All You Need.pdf`，摘录文件夹为 `摘录知识库` 时，笔记是
`摘录知识库/Attention Is All You Need.md`。

万一两篇 PDF 同名，第二篇会带上它所在的目录名来消歧（`摘录知识库/报告 (归档).md`），
仍然冲突时再附一个路径短哈希，因此始终不会互相覆盖。

笔记内容示例：

```markdown
---
type: pdf-excerpt
source: "论文/Attention Is All You Need.pdf"
title: "Attention Is All You Need"
count: 2
created: "2024-05-06T07:08:00.000Z"
updated: "2024-05-06T07:09:12.000Z"
tags:
  - pdf摘录
---

# 摘录 · Attention Is All You Need

> [!quote] 第 3 页 · 2024-05-06 15:08
> The dominant sequence transduction models are based on complex recurrent
> or convolutional neural networks.
>
> [[论文/Attention Is All You Need.pdf#page=3&selection=12,0,14,44|Attention Is All You Need, 第 3 页]]
```

整篇笔记就到这里为止——没有任何注释、JSON 或几何数据。

几点说明：

- 文字用 Obsidian 的 **quote callout** 包裹，在阅读视图里好看，也能被 Dataview 查询
- 反链由 `app.fileManager.generateMarkdownLink()` 生成，因此会遵循你设置的
  「新链接格式」（Wikilink / 相对路径 / 绝对路径）
- `#page=N&selection=a,b,c,d` 是 Obsidian 原生的 PDF 子路径，点击链接时由
  Obsidian 自己完成跳页 + 高亮，不依赖本插件
- 高亮定位用的矩形坐标**不写在笔记里**，而是存在插件自己的数据文件
  `<插件目录>/geometry.json` 中，以「笔记路径 + 摘录 id」为键。因此笔记始终是
  干净的纯文档，你可以随意编辑正文
- 摘录 id 由「页码 + 归一化文本」推导而来，所以笔记里不需要记录 id 也能对上号
- 代价：几何数据不随笔记走。把笔记复制到别的仓库、或删除插件的数据文件后，
  正文不会丢，但需要重新摘录一次才能恢复 PDF 里的高亮
- 矩形坐标是相对于页面 canvas 的归一化值（0~1），所以缩放、改窗口大小、
  重新渲染都不会让高亮错位

---

## 工作原理（以及兼容性风险）

Obsidian 没有为 PDF 阅读器提供公开 API，所以本插件依赖一些内部结构。所有访问
都做了防御性判断，形状不符时安静地退化为「什么也不做」，而不是抛错。

关键点：

- **右键接管**：Obsidian 自己的 PDF 右键处理函数第一行是
  `if (e.defaultPrevented) return;`。插件在 `document` 上以**捕获阶段**监听
  `contextmenu`，只有在确实有选区时才调用 `preventDefault()`，从而完整接管菜单；
  没有选区时什么都不做，Obsidian 原生的复制 / 标注菜单照常弹出。
- **选区捕获**：沿 `.textLayer` 里的文本节点走 TreeWalker，把选区切成
  每页一片，用 `Range.getClientRects()` 取矩形再按行合并、归一化。
- **高亮覆盖层**：在每个 `.page` 里插一个绝对定位的 `.pdf-excerpt-layer`，
  尺寸实时对齐 canvas。覆盖层是 `pointer-events: none` 的，不会影响你继续选中文字。

如果 Obsidian 更新后 PDF 阅读器的 DOM 结构发生变化，最可能失效的是高亮层
和选区坐标；右键菜单与笔记写入依赖的路径相对稳定。

---

## 开发

```bash
npm install
npm run dev        # 监听构建
npm run typecheck  # tsc --noEmit
npm test           # node --test（纯函数单测）
npm run build      # 类型检查 + 生产构建

# 端到端冒烟测试：用 jsdom 加载真正的 main.js，走完四项需求的完整流程
cd tools/smoke && npm install && node harness.cjs
```

冒烟测试不需要打开 Obsidian：它自己伪造一个极简 vault、PDF 阅读器 DOM 和
`obsidian` 模块，然后依次验证右键菜单、笔记落盘与路径、去重、高亮覆盖层、
删除、导出、右侧边栏按钮以及 `onunload` 清理是否干净。

源码结构：

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 插件入口：命令、右键菜单、高亮生命周期、导出 |
| `src/pdf-view.ts` | 与 Obsidian PDF 阅读器内部结构对接、选区捕获 |
| `src/highlight-layer.ts` | PDF 页面内的摘录高亮覆盖层 |
| `src/excerpt-markdown.ts` | 摘录笔记的序列化 / 解析（纯函数，可单测） |
| `src/excerpt-store.ts` | 笔记的定位、读写、去重、缓存 |
| `src/sidebar.ts` | 右侧摘录面板 |
| `src/export.ts` | 汇总导出（Markdown / CSV / JSON / HTML） |
| `src/settings.ts` | 设置页 |

## 发布到社区插件市场

准备提交到 Obsidian 官方插件市场时，见 [PUBLISHING.md](PUBLISHING.md)：
包含建仓库、推送、打 tag 触发自动 Release、以及向 `obsidianmd/obsidian-releases`
提 PR 的完整命令和自查清单。

## 许可证

MIT
