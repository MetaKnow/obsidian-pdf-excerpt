# PDF Excerpt

[![GitHub release](https://img.shields.io/github/v/release/MetaKnow/obsidian-pdf-excerpt)](https://github.com/MetaKnow/obsidian-pdf-excerpt/releases)
[![License](https://img.shields.io/github/license/MetaKnow/obsidian-pdf-excerpt)](LICENSE)
![Obsidian](https://img.shields.io/badge/Obsidian-1.5.0%2B-7C3AED)

**English** · [中文](README.zh.md)

Select text in a PDF, right-click, and it becomes a Markdown excerpt in a note dedicated to that
PDF — with the page number, the exact position, and a highlight that stays on the original page.
Every PDF gets one self-contained folder (note + a copy of the PDF + its screenshots) that you can
move, sync, or hand to someone else as a whole. Duplicates are blocked, a side panel lists and
jumps, and one command exports everything.

> **Desktop only** (Windows / macOS / Linux). Obsidian's built-in PDF viewer is desktop-only too.

---

## What it simplifies

Reading a PDF in Obsidian usually means: switch windows → copy → switch back → paste → type the
page number by hand. After a few papers your notes are full of quotes with no traceable source.

This plugin collapses that into one step, and takes care of the source, the jump back, the mark on
the original, screenshots, and export along the way:

| | Manual copy & paste | **PDF Excerpt** |
| --- | --- | --- |
| Excerpt a passage | Switch windows, copy, paste, type the page | Select → right-click, done |
| Get back to the source | Scroll around and hunt for it | Click the link, it jumps to that page and highlights |
| Has this been excerpted before? | No way to tell | Excerpted passages stay highlighted |
| Does the source survive? | Breaks on rename or move | Link + coordinates live in the note; the note is self-contained |
| Figures and tables | Screenshot, name, and insert by hand | Drag a box; saved at full resolution |
| After 100 excerpts | Full-text search only | Side panel to jump through them, plus one-command export |

---

## Features

### 1. One-step excerpt with the source attached

Select any text → right-click → **Add to excerpts**. The plugin reads the selection from pdf.js's
text layer, merges it into per-line rectangles and normalizes them to 0–1 coordinates, then
① writes the note, ② draws the highlight on the original page, ③ flashes to confirm.

- The context menu is only taken over when you **actually have text selected**; otherwise Obsidian's own menu appears unchanged.
- The excerpt is text, stored as an Obsidian **quote callout** — it reads well in Reading view and is queryable with Dataview.
- Selecting the same passage twice is intercepted with "This passage has already been excerpted".

### 2. Every excerpt links back to the page

Each excerpt is followed by a **native** Obsidian PDF sub-path link:

```
[[papers/Attention Is All You Need.pdf#page=3&selection=12,0,14,44|Attention Is All You Need, page 3]]
```

`#page=N&selection=a,b,c,d` is built into Obsidian and **does not depend on this plugin** — even if
you disable the plugin later, those links still jump to the page and highlight the passage. Links
are produced by `app.fileManager.generateMarkdownLink()`, so they follow your "New link format"
setting (Wikilink / relative / absolute).

### 3. A visible highlight on the original page

Passages you have excerpted are shown as highlight blocks in the PDF, in a configurable color.
When you open a PDF the plugin reads the coordinates back and repaints them; pdf.js renders lazily,
so the plugin watches each page's `data-loaded` and paints as soon as a page appears — highlights
are there immediately, not only after scrolling.

The highlight layer is a `pointer-events: none` overlay, so it never gets in the way of selecting
more text in the PDF.

### 4. One self-contained folder per PDF (the most practical part)

```
PDF Excerpts/
└── Attention Is All You Need/
    ├── Attention Is All You Need.md                        ← the excerpt note
    ├── Attention Is All You Need.pdf                       ← the PDF, copied in automatically
    └── Attention Is All You Need-page3-20240506151200.png  ← screenshots for this PDF
```

When you add the **first** excerpt for a PDF, the plugin also copies the PDF itself into that
folder, and the note's `source` plus every jump link point at the copy (it is copied only once).
The folder is therefore **self-contained**:

- Copy the folder into another vault, into a sync drive, or send it to someone — note and source are both there.
- The original PDF can later be moved, renamed, or deleted without breaking anything.
- This also holds when the PDF already lives inside the excerpt folder, or when it is **outside the vault** (opened through `file:`).

Same-named PDFs never overwrite each other: the second one's folder is disambiguated with its
original parent folder name (`PDF Excerpts/Report (archive)/Report.md`), and a short path hash is
appended if that still collides.

If you upgraded from an older version and your notes are still flat, run the command
**"Tidy excerpt notes into folders"** — it moves them into their per-PDF folders and copies the
PDFs along with them.

### 5. Screenshot excerpts: figures, tables, formulas

Click the screenshot button in the panel → drag a box over the PDF page → release to save. The image
is cropped straight from the page canvas at **full resolution**, independent of the current zoom;
press `Esc` to cancel.

Screenshots record no position and take no part in duplicate detection, so you can capture as many
as you like from one page. Deleting a screenshot excerpt also deletes its PNG.

### 6. Side panel + one-command export

The panel follows the PDF you have open and lists all of its excerpts:

- **Click any card to jump back to the PDF** (a screenshot card jumps to its page and flashes the page border).
- Each card can be located, its text copied, or deleted.
- Title bar, right to left: screenshot, open excerpt note, **export the whole excerpt folder**, refresh.

Export goes through a **system dialog** where you choose the destination, and nothing is opened
afterwards:

- The panel's export button ships **the PDF's whole folder** (note + all screenshots), not a single `.md`.
- The command palette's "Export all PDF excerpts as …" aggregates the entire vault into **Markdown / CSV / JSON / HTML**.

---

## Installation

**From the community plugin directory** (once listed): Settings → Community plugins → Browse →
search for `PDF Excerpt`.

**Manually:**

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/MetaKnow/obsidian-pdf-excerpt/releases).
2. Put them in `<your vault>/.obsidian/plugins/pdf-excerpt/`.
3. Obsidian → Settings → Community plugins → turn off Restricted mode → enable **PDF Excerpt**.

---

## Quick start

1. Open any PDF in Obsidian.
2. Select a passage (multi-line and whole paragraphs are fine).
3. Right-click → **Add to excerpts**.
4. Done. The note opens in the main editor area in **Reading view** (can be turned off in settings), and every later excerpt is appended to the same note.

Panel entry points: the highlighter icon in the left ribbon, the button at the top of the right
sidebar, or the command **"PDF Excerpt: Open PDF excerpt panel"**.

> The plugin's interface is currently in Simplified Chinese. Command names are given below with
> their English meaning so you can find them.

---

## Commands

| Command (as shown in the palette) | What it does |
| --- | --- |
| 将选中的 PDF 文字加入摘录 *(Add selected PDF text to excerpts)* | Same as the right-click action |
| 截图并加入摘录笔记 *(Screenshot into the excerpt note)* | Drag a box on the PDF page to capture |
| 打开当前 PDF 的摘录笔记 *(Open the excerpt note for this PDF)* | Opens or creates the note |
| 打开 PDF 摘录面板 *(Open the PDF excerpt panel)* | Reveals the side panel |
| 显示 / 隐藏 PDF 中的摘录高亮 *(Show / hide excerpt highlights)* | Temporarily hides all highlights |
| 导出全部 PDF 摘录为 Markdown / CSV / JSON / HTML *(Export all PDF excerpts as …)* | Aggregates the whole vault |
| 迁移旧版摘录笔记（改为隐藏的几何数据） *(Migrate legacy excerpt notes)* | Rewrites the visible `<!-- -->` geometry comments of early notes into hidden `%%` form |
| 整理摘录笔记（移入以 PDF 命名的子文件夹） *(Tidy excerpt notes into folders)* | Moves flat notes into their per-PDF folders and copies the PDFs in |

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| 摘录文件夹 *(Excerpt folder)* | `摘录知识库` | Where each PDF's excerpt note is stored; leave empty for the vault root |
| 导出文件夹 *(Export folder)* | `摘录知识库/导出` | Fallback destination when no system dialog is available |
| 首次摘录时自动打开笔记 *(Open the note on the first excerpt)* | On | Opens the note in the main editor area the first time a PDF gets an excerpt |
| 以阅读视图打开摘录笔记 *(Open excerpt notes in Reading view)* | On | Uses Reading view instead of edit mode |
| 摘录后闪烁提示 *(Flash after excerpting)* | On | Flashes the corresponding spot in the original |
| 高亮颜色 *(Highlight color)* | `#ffd400` | Highlight color for excerpted areas in the PDF |
| 显示侧边栏图标 *(Show ribbon icons)* | On | Shows the panel buttons (left ribbon + top of the right sidebar) |

Opening an excerpt note reuses the tab that is already open instead of opening a second one;
"Open in Reading view" **takes precedence over** Obsidian's global "Default view for new tabs".

---

## Note format

```markdown
---
type: pdf-excerpt
source: "PDF Excerpts/Attention Is All You Need/Attention Is All You Need.pdf"
title: "Attention Is All You Need"
count: 2
created: "2024-05-06T07:08:00.000Z"
updated: "2024-05-06T07:09:12.000Z"
---

# 摘录 · Attention Is All You Need          ← "Excerpts · <title>"

> [!quote] 第 3 页 · 2024-05-06 15:08        ← "page 3 · <date>"
> The dominant sequence transduction models are based on complex recurrent
> or convolutional neural networks.
>
> [[Attention Is All You Need.pdf#page=3&selection=12,0,14,44|Attention Is All You Need, 第 3 页]]

%% pdf-excerpt {"id":"e4f2a91","page":3,"created":1714979280000,"rects":[[0.1103,0.1544,0.7831,0.0161]],"sel":"12,0,14,44"} %%

> [!quote] 截图 · 第 20 页 · 2024-05-06 15:12   ← "screenshot · page 20 · <date>"
> ![[PDF Excerpts/Attention Is All You Need/Attention Is All You Need-第20页-20240506151200.png]]
```

- The body is wrapped in quote callouts: it looks right in Reading view and is queryable with Dataview.
- Back-links come from `app.fileManager.generateMarkdownLink()`, so they follow your "New link
  format" setting. Because the note and the PDF copy sit in the same folder, the default setting
  produces a bare filename: `[[Attention Is All You Need.pdf#page=3&…]]`.
- The `%% … %%` line uses Obsidian's **comment syntax** — invisible in Reading view and Live
  Preview, visible only in source mode. The highlight coordinates live inside it, which is what
  makes the **note self-contained**: the body stays clean, and copying the note to another vault
  carries the highlight data with it.
- Coordinates are normalized (0–1) against the page canvas, so zooming, resizing the window, or
  re-rendering never shifts them.
- A screenshot excerpt has only an `id` and a page number — no `rects` — and takes no part in duplicate detection.

---

## Privacy and file access

- **No network.** The plugin makes no network requests, has no telemetry, requires no account, and uploads nothing.
- **During normal use it only reads and writes your vault, through Obsidian's own `Vault` API.** Excerpts, highlights, and screenshots are all handled inside the vault.
- **The only time it touches files outside the vault is when you export** — this is the only place the plugin uses Node's `fs` module. The panel's "export the excerpt folder" button opens the operating system's folder picker (`electron.dialog`, falling back to `@electron/remote`) and **you choose the destination yourself**; only after you confirm does the plugin copy that PDF's excerpt folder there with `fs.promises.cp()`. Outside of that action no file outside the vault is ever read or written, and a destination path is never chosen for you. If you never use the export buttons, no code outside the vault API runs.
- The plugin is marked `isDesktopOnly: true` precisely because it uses Node/Electron APIs — as is Obsidian's own PDF viewer.

---

## Known limitations

- **Desktop only.** Obsidian provides its PDF viewer on desktop only.
- Select within **one page at a time**; dragging across pages is not supported yet.
- Obsidian exposes no public API for its PDF viewer, so the plugin relies on some internal DOM
  shape (`.textLayer`, `.page`, pdf.js's render timing). Every access is defensive and degrades
  quietly to "do nothing" rather than throwing. If a future major Obsidian release changes the PDF
  viewer's structure, the highlight layer and selection coordinates are the most likely to be
  affected; the context menu and note writing rely on much more stable paths.
- The context menu takeover works because Obsidian's own handler starts with
  `if (e.defaultPrevented) return;`: the plugin listens for `contextmenu` on `document` in the
  **capture** phase and calls `preventDefault()` only when there really is a selection.

## Development

```bash
npm install
npm run dev        # watch build
npm run typecheck  # tsc --noEmit
npm test           # node --test (pure-function unit tests)
npm run build      # type check + production build
npm run deploy     # sync the artifacts to your Obsidian plugin folder

# End-to-end smoke test: loads the real main.js under jsdom and runs full user flows
cd tools/smoke && npm install && node harness.cjs
```

> `npm run build` only writes the artifacts to the repository root, while Obsidian loads the
> **copy** inside your vault. After changing code, run
> `npm run deploy -- --to "<your vault>/.obsidian/plugins/pdf-excerpt"` (or put the target in
> `.deploy-target` at the repository root and just run `npm run deploy`), then reload the app in
> Obsidian.

The smoke test needs no Obsidian window: it fakes a minimal vault, PDF viewer DOM, and `obsidian`
module, then checks the context menu, note paths on disk, the PDF copy, duplicate detection, the
highlight overlay, deletion, screenshots, export, the sidebar buttons, and whether `onunload`
cleans up.

Source layout:

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin entry: commands, context menu, highlight lifecycle, export, screenshots |
| `src/screenshot.ts` | Drag a box on a PDF page and crop a PNG from the page canvas |
| `src/pdf-view.ts` | Integration with Obsidian's PDF viewer internals, selection capture |
| `src/highlight-layer.ts` | The excerpt highlight overlay inside PDF pages |
| `src/excerpt-markdown.ts` | Serializing / parsing excerpt notes (pure functions, unit tested) |
| `src/excerpt-store.ts` | Note location, read/write, dedupe, cache, PDF copies |
| `src/sidebar.ts` | The right-side excerpt panel |
| `src/export.ts` | Aggregate export (Markdown / CSV / JSON / HTML) |
| `src/settings.ts` | Settings tab |

See [PUBLISHING.md](PUBLISHING.md) for the release process (in Chinese).

## License

[MIT](LICENSE)
