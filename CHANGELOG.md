# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-10-16

### Added

- 在 PDF 中选中文字后右键 → **加入摘录**，写入该 PDF 专属的 Markdown 摘录笔记。
- 每个 PDF 一个独立笔记，全部平铺在仓库的 `摘录知识库` 文件夹中（不建子文件夹）。
- **截图摘录**：面板里的截图按钮，在 PDF 页面上拖拽框选，图片自动写进摘录笔记
  （直接从页面 canvas 裁切，全分辨率；不记录位置、不做重复判断）。
- 右侧边栏「PDF 摘录」面板：列出当前 PDF 的全部摘录，可定位、复制、删除。
- 导出走系统保存对话框，由用户选择保存位置，导出后不自动打开。
- 已摘录的文字在 PDF 中以高亮块显示，重复摘录会被自动拦截；打开 PDF 时自动重绘高亮。
- 高亮坐标藏在每条摘录末尾的 `%% pdf-excerpt {…} %%` 中：阅读视图和实时预览都不显示，
  源码模式才可见，因此笔记自包含、可随笔记一起搬走。
- 摘录笔记在主编辑区新标签页打开，不占用右侧面板。
- 命令面板命令：加入摘录、截图并加入摘录笔记、打开摘录笔记、打开摘录面板、
  显示/隐藏高亮、导出全部摘录、迁移旧版摘录笔记。
