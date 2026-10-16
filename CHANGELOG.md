# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-10-16

### Added

- 在 PDF 中选中文字后右键 → **加入摘录**，写入该 PDF 专属的 Markdown 摘录笔记。
- 每个 PDF 一个独立笔记，全部平铺在仓库的 `摘录知识库` 文件夹中（不建子文件夹）。
- 摘录笔记是干净的纯文档：只有 frontmatter、标题和引用块，不含任何注释或几何数据。
- 右侧边栏「PDF 摘录」面板：列出当前 PDF 的全部摘录，可定位、复制、删除。
- 可在面板中直接导出全部摘录（Markdown / CSV / JSON / HTML），并一键打开摘录笔记。
- 已摘录的文字在 PDF 中以高亮块显示，重复摘录会被自动拦截。
- 命令面板命令：加入摘录、打开摘录笔记、打开摘录面板、显示/隐藏高亮、导出全部摘录。
