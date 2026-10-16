# 发布到 Obsidian 社区插件市场

这份文档是给「自己动手推送」准备的：本地仓库、构建产物、CI 工作流都已经就绪，
你只要按顺序执行下面的命令即可。每一步都给了**验证方法**，做完能立刻确认是否成功。

> 约定：下面假设仓库地址是 `git@github.com:MetaKnow/obsidian-pdf-excerpt.git`。
> 如果你换了用户名或仓库名，全局替换 `MetaKnow/obsidian-pdf-excerpt` 即可。

---

## 0. 开始前的状态确认

已经就绪、**不需要你重复做**的事情：

| 项目 | 状态 |
| --- | --- |
| 源码 + 构建脚本 + 单元测试 | 就绪（17 个单元测试、16 项端到端冒烟检查全部通过）|
| `manifest.json` / `versions.json` / `styles.css` | 就绪，`author` 已设为 `MetaKnow` |
| `.github/workflows/release.yml` | 就绪，打 tag 后自动构建并发 Release |
| `LICENSE`（MIT）/ `README.md` / `CHANGELOG.md` | 就绪 |
| 本地 git 仓库 | 已 `git init` 并完成首次提交 |

只有三件事只能由你来做：**建远程仓库、推送、提 PR**。

先确认本地一切正常：

```bash
cd /Users/leckie/002开发项目/obsidianPlugin

npm run build     # 应该无输出并生成 main.js
npm test          # 应该显示 pass 17 / fail 0
git log --oneline # 应该能看到首次提交
```

---

## 1. 在 GitHub 上创建空仓库

打开 https://github.com/new ，按下面填写：

| 字段 | 值 |
| --- | --- |
| Repository name | `obsidian-pdf-excerpt` |
| Description | `Right-click selected text in a PDF to excerpt it into a per-PDF markdown note. Excerpts stay highlighted in the PDF, duplicates are blocked, and a side panel can export them` |
| 可见性 | **Public**（社区插件必须是公开仓库）|
| Initialize with README | **不勾**（本地已有文件，勾了会冲突）|
| Add .gitignore / license | **都不选**（本地已有）|

仓库名不必和插件 id 相同，但用 `obsidian-pdf-excerpt` 最直观。
**插件 id（`pdf-excerpt`）一旦发布就不能再改**，仓库名可以随便改。

---

## 2. 推送代码

```bash
cd /Users/leckie/002开发项目/obsidianPlugin

git remote add origin git@github.com:MetaKnow/obsidian-pdf-excerpt.git
git branch -M main
git push -u origin main
```

验证：刷新仓库页面，应该能看到 `src/`、`manifest.json`、`README.md` 等文件，
**但是看不到 `main.js`** —— 这是对的，`main.js` 是构建产物，已在 `.gitignore` 里排除，
由 CI 在发 Release 时生成并附到 Release 上。

> 为什么必须公开？Obsidian 客户端安装插件时是从你的 Release 下载三个文件的，
> 私有仓库会导致下载失败，审核也不会通过。

---

## 3. 打 tag，触发自动发布

`tag` 必须和 `manifest.json` 里的 `version` **完全一致**（`1.0.0`，不要写 `v1.0.0`）：

```bash
cd /Users/leckie/002开发项目/obsidianPlugin
git tag 1.0.0
git push origin 1.0.0
```

推送 tag 后，GitHub Actions 会自动：安装依赖 → 跑测试 → 构建 → 创建 Release
并把 `main.js`、`manifest.json`、`styles.css` 三个文件作为附件上传。

在仓库的 **Actions** 标签页可以看到运行进度，大约 1 分钟。

### 如果 Actions 失败，手动兜底

本地构建后手动创建 Release 也可以，效果完全一样：

```bash
cd /Users/leckie/002开发项目/obsidianPlugin
npm run build

# 需要先装 gh：brew install gh && gh auth login
gh release create 1.0.0 \
  --title "1.0.0" \
  --notes "首个版本：PDF 划选摘录、按 PDF 分文件、原文高亮、去重、侧边栏面板、多格式导出。" \
  main.js manifest.json styles.css
```

---

## 4. 验证 Release（这一步不能跳过）

打开 `https://github.com/MetaKnow/obsidian-pdf-excerpt/releases/tag/1.0.0`，确认：

- [ ] 标签名是 **`1.0.0`**，和 `manifest.json` 的 `version` 一字不差
- [ ] 附件里正好有 **`main.js`**、**`manifest.json`**、**`styles.css`** 三个文件
- [ ] `main.js` 大小约 42 KB（如果只有几百字节，说明构建产物不对）

还建议用 Obsidian 自己装一遍验证（不用手动拷文件）：

1. 打开 Obsidian → 设置 → 第三方插件 → **浏览**
2. 因为还没进市场，先改用 BRAT 插件：安装 **BRAT**，然后
   `Add Beta plugin` → 填 `MetaKnow/obsidian-pdf-excerpt` → 它会按 Release 安装
3. 装完打开一个 PDF，划词右键，确认「加入摘录」可用

> 这一步能提前发现 90% 的审核问题。官方也推荐用 BRAT 先发 beta 收集反馈。

---

## 5. 提交到 Obsidian 社区插件市场

### 5.1 Fork 并克隆

在浏览器打开 https://github.com/obsidianmd/obsidian-releases ，
点右上角 **Fork**。然后：

```bash
cd /tmp
git clone git@github.com:MetaKnow/obsidian-releases.git
cd obsidian-releases
git remote add upstream https://github.com/obsidianmd/obsidian-releases.git
```

### 5.2 在 `community-plugins.json` 末尾追加一条

用编辑器打开 `community-plugins.json`（这是个 9000 多行的数组），
在**最后一个 `}` 后面加一个英文逗号**，然后插入：

```json
  {
    "id": "pdf-excerpt",
    "name": "PDF Excerpt",
    "author": "MetaKnow",
    "description": "Right-click selected text in a PDF to excerpt it into a per-PDF markdown note. Excerpts stay highlighted in the PDF, duplicates are blocked, and a side panel can export them",
    "repo": "MetaKnow/obsidian-pdf-excerpt"
  }
```

字段要求（照抄上面的就行，但知道规则以后改描述不会踩坑）：

- `id` 必须和 `manifest.json` 的 `id` 完全一致，且**不能包含 `obsidian`**
- `name` 里**不能出现 `Obsidian`** 这个词
- `description` 里**不能出现 `Obsidian`**，也不能以句号结尾（市场页会自己加）
- `repo` 是 `用户名/仓库名`，指向上面第 1 步建的仓库
- **描述不要用 Markdown**，就是纯文本一行
- **数组顺序无所谓**，追加到末尾即可（很多人以为要按字母排序，不用）

验证 JSON 没写坏（这个命令必须有输出且能解析成功）：

```bash
python3 -c "import json;d=json.load(open('community-plugins.json'));print(len(d),'plugins OK');print([p for p in d if p['id']=='pdf-excerpt'])"
```

### 5.3 提交并推送

```bash
git add community-plugins.json
git commit -m "Add plugin: PDF Excerpt"
git push origin master      # 如果分支是 main 就写 main
```

### 5.4 开 PR

回到你 fork 的页面，应该会出现 **Compare & pull request** 按钮。点它。

- **标题**：`Add plugin: PDF Excerpt`
- **正文**：GitHub 会自动套用模板。如果模板给出
  `Please switch to Preview and select one of the following links: Community Plugin / Community Theme`，
  就切到 **Preview** 标签页，点 **Community Plugin**，它会填入正式模板。
  按模板勾选即可，典型内容是：

  ```
  # I am submitting a new Community Plugin

  ## Repo URL
  https://github.com/MetaKnow/obsidian-pdf-excerpt

  ## Release Checklist
  - [x] I have tested the plugin on
    - [x] Windows
    - [x] macOS
    - [ ] Linux
    - [ ] Android
    - [ ] iOS
  - [x] My GitHub release contains all required files
    - [x] main.js
    - [x] manifest.json
    - [x] styles.css (optional)
  - [x] GitHub release name matches the exact version number specified in my manifest.json
  - [x] The `id` in my `manifest.json` matches the `id` in the `community-plugins.json` file
  - [x] My README.md describes the plugin's purpose and provides clear usage instructions
  - [x] I have read the developer policies and my plugin complies with them
  ```

  > 本插件是 `isDesktopOnly: true`，所以移动端那几项**留空不勾**是正确的，
  > 不要为了好看勾上——审核会核对 `manifest.json`。

**只提交你的插件这一条记录**，不要顺手改别的插件或者格式化整个文件，
否则 diff 会很乱，PR 容易被要求重做。

之后就是等。Obsidian 团队一般几天内处理；合并后你会在插件市场里看到它，
大约几小时后刷新可用。合并时官方会把你的条目改成
`"author": "MetaKnow"` 这类规范化形式，属于正常操作。

---

## 6. 审核常见被拒原因（发布前自查）

| 风险点 | 本插件的情况 |
| --- | --- |
| 描述或名字里出现 `Obsidian` | 已避开 |
| `id` 含 `obsidian` 或与仓库不符 | `pdf-excerpt`，一致 |
| Release 里缺 `main.js` | CI 会自动附上 |
| tag 和 `manifest.json` 版本不一致 | 都是 `1.0.0` |
| 仓库没 README / 没说明怎么用 | README.md 已写全 |
| 没有 LICENSE | MIT 已加 |
| 移动端插件却标 `isDesktopOnly` | 本插件依赖 Electron 的 PDF 视图，标 `true` 正确 |
| 提交了构建产物 `main.js` 到仓库 | 已 `.gitignore` |
| 用 `innerHTML` 拼 HTML（XSS 风险）| 全部用 `createEl` / `createDiv` / `setText` |

还有一个隐性要求：**插件不能自动发起网络请求**。本插件完全离线，
只读写你仓库里的 markdown 文件，不依赖任何服务器。

---

## 7. 以后发新版本

每次改动后：

```bash
cd /Users/leckie/002开发项目/obsidianPlugin

# 1. 同步改版本号：manifest.json、package.json、versions.json、CHANGELOG.md
#    versions.json 新增一行，映射到该版本要求的最低 Obsidian 版本
#    {"1.0.0": "1.5.0", "1.1.0": "1.5.0"}

npm run build && npm test

git add -A
git commit -m "1.1.0: 简述本次改动"
git push

# 2. 打 tag 触发自动 Release
git tag 1.1.0
git push origin 1.1.0
```

**不需要**再提 PR。市场会定期读取你仓库里的 `manifest.json` 来发现新版本，
所以只要 `manifest.json` 的版本号、tag、Release 三者一致，用户就能收到更新。

`versions.json` 的作用：如果新版本要求更高的 Obsidian 版本，
旧版 Obsidian 用户会被自动引导安装最后一个兼容版本，而不是直接报错。
