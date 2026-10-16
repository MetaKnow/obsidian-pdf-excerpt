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
   笔记会在主编辑区新开一个标签页、以**阅读视图**打开（不会占用右侧面板）

如果这一段之前已经摘录过，会提示「这段内容已经摘录过了」，不会重复写入。

### 侧边面板

- 左侧功能区点击书签图标，或命令面板执行 **PDF 摘录: 打开 PDF 摘录面板**
- 面板跟随当前打开的 PDF 自动切换
- 面板标题栏右侧依次是：**截图**、打开摘录笔记、导出摘录文件夹、刷新
- 「打开摘录笔记」在主编辑区打开，并且默认用**阅读视图**显示（可在设置里关掉，
  改为普通编辑模式）。插件设置**优先于** Obsidian 全局的「新标签默认视图」；
  已经开着同一个笔记时会切到那个标签页，不会重复开新页
- 截图：点一下，在 PDF 页面上拖拽框选，松手后图片自动写进摘录笔记。按 Esc 取消。
  图片存到这篇 PDF 自己的子文件夹里；截图不记录位置、也不做重复判断，所以同一页可以截很多张；
  在面板里删除一条截图摘录时，对应的 PNG 会一起删除

### 导出

- 面板里的「导出」按钮把**当前这篇 PDF 的整个子文件夹**（摘录笔记 + 全部截图）完整搬到
  你自己选的位置：弹出系统文件夹选择框，选好之后会在里面新建一个同名的
  `摘录知识库/<PDF 文件名>/` 文件夹。导出的是文件夹不是单个 md，截图不会丢；导出后不会自动打开
- 命令面板里的「导出全部 PDF 摘录为 …」会把全库摘录汇总成
  Markdown / CSV / JSON / HTML，同样由系统对话框选择保存位置
- 如果当前环境拿不到系统对话框（例如某些非桌面场景），会退回把整个子文件夹镜像保存到
  「导出文件夹」设置里（默认 `摘录知识库/导出`）
- 每张卡片支持：定位（跳回 PDF 原文并闪烁）、复制文本、删除
- **点击卡片一律是"跳回 PDF 原文"**，不会打开摘录笔记；截图卡片没有自己的高亮矩形，
  所以跳转后是页面居中 + 页面边框闪一下。要打开笔记请点标题栏的「打开摘录笔记」

### 命令面板

| 命令 | 说明 |
| --- | --- |
| 将选中的 PDF 文字加入摘录 | 等价于右键「加入摘录」 |
| 截图并加入摘录笔记 | 在 PDF 页面上框选截图 |
| 打开当前 PDF 的摘录笔记 | 打开 / 创建对应笔记 |
| 打开 PDF 摘录面板 | 显示右侧面板 |
| 显示 / 隐藏 PDF 中的摘录高亮 | 临时隐藏所有高亮 |
| 导出全部 PDF 摘录为 Markdown / CSV / JSON / HTML | 汇总全库摘录 |
| 迁移旧版摘录笔记 | 把 1.0.0 笔记里的 `<!-- -->` 几何注释改成隐藏的 `%%` 形式 |
| 整理摘录笔记（移入以 PDF 命名的子文件夹） | 把平铺的旧笔记搬进各自的子文件夹 |

---

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 摘录文件夹 | `摘录知识库` | 每篇 PDF 的摘录笔记存放位置，留空为仓库根目录 |
| 导出文件夹 | `摘录知识库/导出` | 导出汇总文件的存放位置 |
| 首次摘录时自动打开笔记 | 开 | 某个 PDF 第一次产生摘录时，在主编辑区打开笔记 |
| 以阅读视图打开摘录笔记 | 开 | 打开摘录笔记时默认用阅读视图，而不是编辑模式 |
| 摘录后闪烁提示 | 开 | 摘录成功后闪烁对应的原文位置 |
| 高亮颜色 | `#ffd400` | PDF 中摘录区域的高亮色 |
| 显示侧边栏图标 | 开 | 在右侧边栏顶部显示面板按钮（左侧功能区也会保留一个图标）|

---

## 摘录笔记的格式

每篇 PDF 对应一篇笔记。每篇 PDF 有自己的子文件夹，摘录笔记和这篇 PDF 相关的其他文件
（例如截图）都放在里面：

```
<摘录文件夹>/<PDF 文件名去掉扩展名>/<PDF 文件名去掉扩展名>.md
<摘录文件夹>/<PDF 文件名去掉扩展名>/<PDF 文件名>-第 N 页-20240506070809.png
```

例如 `论文/Attention Is All You Need.pdf`，摘录文件夹为 `摘录知识库` 时，笔记是
`摘录知识库/Attention Is All You Need/Attention Is All You Need.md`，
截图也在同一个文件夹里。

万一两篇 PDF 同名，第二篇的子文件夹会带上它所在的目录名来消歧
（`摘录知识库/报告 (归档)/报告.md`），仍然冲突时再附一个路径短哈希，因此始终不会互相覆盖。

从旧版本升级、或笔记还平铺在摘录文件夹里时，运行命令
**「整理摘录笔记（移入以 PDF 命名的子文件夹）」** 可以一次性搬进各自的子文件夹。

笔记内容示例：

```markdown
---
type: pdf-excerpt
source: "论文/Attention Is All You Need.pdf"
title: "Attention Is All You Need"
count: 1
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

%% pdf-excerpt {"id":"e4f2a91","page":3,"created":1714979280000,"rects":[[0.1103,0.1544,0.7831,0.0161]],"sel":"12,0,14,44"} %%
```

（上面那行 `%% … %%` 是 Obsidian 的注释语法，在阅读视图和实时预览里都**完全不显示**，
只有切到源码模式才看得到。它保存高亮位置，因此笔记自包含、可以随意复制走。）

几点说明：

- 文字用 Obsidian 的 **quote callout** 包裹，在阅读视图里好看，也能被 Dataview 查询
- 反链由 `app.fileManager.generateMarkdownLink()` 生成，因此会遵循你设置的
  「新链接格式」（Wikilink / 相对路径 / 绝对路径）
- `#page=N&selection=a,b,c,d` 是 Obsidian 原生的 PDF 子路径，点击链接时由
  Obsidian 自己完成跳页 + 高亮，不依赖本插件
- 高亮定位用的矩形坐标写在每条摘录末尾的 `%% pdf-excerpt {…} %%` 里：Obsidian
  会把它整行隐藏，所以正文看起来始终是干净的纯文档，而你复制笔记到别的仓库时
  高亮信息也跟着走
- 打开 PDF 时插件会读回这份坐标并重绘高亮；pdf.js 是**懒渲染**的，插件监听了
  每页的 `data-loaded`，页面渲染出来就补画，所以刚打开 PDF 也能看到高亮
- 截图摘录只有 `id` 和页码，没有 `rects`，也不参与重复判断
- 矩形坐标是相对于页面 canvas 的归一化值（0~1），所以缩放、改窗口大小、
  重新渲染都不会让高亮错位
- 旧版本（1.0.0 / 1.0.1）用 HTML 注释保存坐标，那些注释在源码模式下可见；执行一次
  命令 **PDF 摘录: 迁移旧版摘录笔记（改为隐藏的几何数据）** 即可改写为 `%%` 形式

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
| `src/main.ts` | 插件入口：命令、右键菜单、高亮生命周期、导出、截图入库 |
| `src/screenshot.ts` | 在 PDF 页面上框选并直接从页面 canvas 裁出 PNG |
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
