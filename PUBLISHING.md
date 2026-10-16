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
| 源码 + 构建脚本 + 单元测试 | 就绪（22 个单元测试、31 项端到端冒烟检查全部通过）|
| `manifest.json` / `versions.json` / `styles.css` | 就绪，`author` 已设为 `MetaKnow` |
| `.github/workflows/release.yml` | 就绪，打 tag 后自动构建并发 Release |
| `LICENSE`（MIT）/ `README.md` / `CHANGELOG.md` | 就绪 |
| 本地 git 仓库 | 已 `git init` 并完成首次提交 |

只有三件事只能由你来做：**建远程仓库、推送、在社区目录站提交**。

先确认本地一切正常：

```bash
cd /Users/leckie/002开发项目/obsidianPlugin

npm run build     # 应该无输出并生成 main.js
npm test          # 应该显示 pass 22 / fail 0
node tools/smoke/harness.cjs   # 冒烟检查：31/31 checks passed
                               # （首次运行需先在 tools/smoke 里 `npm i` 装 jsdom）
git log --oneline # 应该能看到全部提交
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
- [ ] `main.js` 大小约 62 KB（如果只有几百字节，说明构建产物不对）

还建议用 Obsidian 自己装一遍验证（不用手动拷文件）：

1. 打开 Obsidian → 设置 → 第三方插件 → **浏览**
2. 因为还没进市场，先改用 BRAT 插件：安装 **BRAT**，然后
   `Add Beta plugin` → 填 `MetaKnow/obsidian-pdf-excerpt` → 它会按 Release 安装
3. 装完打开一个 PDF，划词右键，确认「加入摘录」可用

> 这一步能提前发现 90% 的审核问题。官方也推荐用 BRAT 先发 beta 收集反馈。

---

## 5. 提交到 Obsidian 社区目录

> **提交方式已经变了**：`obsidianmd/obsidian-releases` 已**关闭 Pull Request**
> （打开 compare 页会看到 *An owner of this repository has disabled the ability to open
> pull requests.*），社区插件改为在 **https://community.obsidian.md** 提交。
> 不要再往那个仓库提 PR，也不要手动改 `community-plugins.json`——目录站会自己处理。

### 5.1 登录

1. 打开 https://community.obsidian.md
2. 右上角 **Sign in**，用 **Obsidian 账号**登录（没有就现场注册）

登录后落在你的 **Community profile** 页。

### 5.2 关联 GitHub 账号（不关联就不能提交）

在 profile 页的 **GitHub** 一栏点 **Connect**，跳转 GitHub 授权（只读取公开资料，
用来验证仓库归属）。要用**拥有本仓库的那个 GitHub 账号**授权。

顺便打开 **Action required notifications**，之后自动校验失败会发邮件通知你。

### 5.3 新增插件

左侧栏 **Plugins** → **New plugin**，填：

| 字段 | 值 |
| --- | --- |
| GitHub repository URL | `https://github.com/MetaKnow/obsidian-pdf-excerpt` |
| Owner | Myself |

勾选同意 Developer policies 与后续维护承诺 → **Submit**。

### 5.4 提交前必须同时成立的前提

目录站读取的是**默认分支 HEAD 上的 `manifest.json`**，再按 manifest 里的 `version`
去找对应 tag 的 Release 下载文件，所以这三条缺一不可：

- [ ] `manifest.json` 在默认分支上且准确（`id: pdf-excerpt`、`version: 1.0.0`）
- [ ] 存在 tag 与 `version` 一字不差的 Release（`1.0.0`）
- [ ] Release 里带着 `main.js`、`manifest.json`、`styles.css`

命名规则（表单里填的描述同样受约束）：

- `id` 必须和 `manifest.json` 一致，**不能包含 `obsidian`**，且全局唯一
- `name` 和描述里**不能出现 `Obsidian`** 这个词
- `id` 一旦发布就**不能再改**（仓库名可以随便改）

### 5.5 自动校验与后续

提交后目录站会立刻自动校验，结果直接显示在条目上：

- 有问题 → **改仓库 → 发布一个版本号递增的新 Release**（不是开新 PR）
- 全部通过并被审核后，用户就能在 Obsidian 里搜索安装

之后每次发新版本都**不需要**再回来提交一次，见下面第 7 节。

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
| 描述结尾没有句号 | 官方硬性要求必须以 `.` 结尾，已补 |
| README 里没有英文内容 | 目录站面向英文用户，`README.md` 已改为英文，中文版放在 `README.zh.md` |
| 直接访问文件系统（Node `fs`）| 政策**允许**，但必须在 README 里说明用途；已在「Privacy and file access」一节写清 |

> **复核流程**：目录站每次发 Release 后会重新扫描，结果分成 manifest / release 资源 / 源码 /
> 构建校验四组，每条分级为 error / warning / recommendation / pass。改完仓库后有两种触发方式：
> 在条目的 **⋯** 菜单里选 **Request review** 立即重扫（不必发新版本），
> 或选 **Review branch → Run preview scan**，先看扫描结果再决定要不要发新版本。

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
