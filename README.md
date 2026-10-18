# Aron 的清风日常

正式域名：**https://aron.xin**。以八奈见杏菜主题插画、海风背景和轻透卡片为视觉风格的个人博客，记录学习、实践与生活。

此目录目前只在本地整理，未上传或部署。旧站 `../Firefly` 保持原样。

## 内容

已从旧站源码完整迁移 **32 篇已发布文章**：Linux 6 篇、MySQL 4 篇、Redis 22 篇。保留原始标题、正文、发布日期、更新日期、分类和标签；两篇生活设计示例已从网站中移除。

迁移已经完成，正式文章以 `content/posts/` 中的 Markdown 为内容源。`migration/` 仅保存历史备份和迁移报告，不参与构建或检查，可以删除。迁移时将「多级缓存学习索引」中不存在的 Lua 文章链接改为了文字说明。

站点不再读取旧项目，文章 Markdown 是独立内容源。

## 本地使用

首次安装构建依赖：

```sh
npm ci
```

生成并检查正式静态网站：

```sh
npm run build
npm run check
```

本机预览：

```sh
npm run preview
```

打开 `http://127.0.0.1:4174/`。停止预览按 Ctrl+C。可部署的公开文件全部位于 **dist/**；应只发布该目录，不能发布整个项目目录，避免把草稿和原始备份一并公开。无需将全部地址回退到首页，每个文章地址都有真实的 HTML 页面；托管平台可使用 `404.html` 作为 404 页面。

独立离线预览：

```sh
python3 build_preview.py
```

打开「清风日常.html」。样式、文章、插画和图表脚本已内嵌。音乐仍从相邻 `assets/music/` 读取；移动预览文件时一并保留该目录。旧文件名「晴天手帐.html」保留相同版本，兼容早期本地链接。

## 写作与维护

- **写文章**：在 `content/posts/分类名/` 新建 `.md`，参考已有文章或 `content/文章模板.md.txt`。
- **标题、简介、日期、分类、标签**：编辑文章顶部 frontmatter。`published` 是首次发布日期；后续修订时只更新 `updated`。
- **地址**：`id` 和 `permalink` 必须唯一，发布后保持稳定。已迁移文章沿用旧站 `/posts/分类/文件名/` 地址，避免收藏与旧链接失效。
- **草稿**：`draft: true` 或设置密码的内容不会公开。`content/drafts/` 始终不参与构建；准备发布时移入 `content/posts/` 并检查 frontmatter。
- **内部文章链接**：使用相对 Markdown 路径，例如 `./另一篇文章.md`，构建时自动改为正式地址；不存在的站内文章链接会让构建失败，避免产生死链。
- **流程图**：支持 Mermaid flowchart 与 sequenceDiagram，页面使用本地图表脚本，附带可展开的源码。没有外部 CDN 依赖。
- **配置**：站名、作者、正式域名、简介、联系信息位于 `site.config.json`。
- **音乐**：放入上级 `music/` 后运行 `python3 prepare_music.py` 更新资源，再构建。音乐与歌词在站内路由切换时保持播放，不自动播放。
- **发布前**：运行构建、检查，再更新离线预览。单独运行 `build_preview.py` 不重新编译 Markdown。`npm run check` 根据当前正式文章检查正文、静态页面、站内链接、资源及 RSS。

首次迁移脚本和迁移专用校验命令已移除。日常写作使用 `npm run build` 和 `npm run check`，不需要旧站源码或迁移备份。

## 网站功能

首页、文章列表、分类专题、归档、标签筛选、全文搜索、左侧文章目录、代码高亮和复制、阅读进度、本地喜欢收藏、杏菜集与音乐播放器。桌面侧栏在左侧；手机端目录折叠、导航分行。

构建生成独立 HTML、canonical、Open Graph、BlogPosting 结构化数据、RSS、robots.txt 与 sitemap。关闭 JavaScript 时仍可阅读正文和归档；搜索、音乐、交互筛选与图表渲染需要 JavaScript。

## 目录

| 路径 | 用途 |
| --- | --- |
| `content/posts/` | 正式文章，主要维护入口 |
| `content/drafts/` | 未公开草稿，不进入构建 |
| `migration/`（可删除） | 历史备份、校验清单和迁移报告，不参与构建或检查 |
| `scripts/` | 文章处理、静态生成、完整性检查 |
| `dist/` | 构建生成的公开网站 |
| `index.html`、`app.js`、`style.css` | 页面壳、交互与样式 |
| `assets/` | 插画、音乐与本地运行脚本 |
| `output/` | 历次设计稿、生成提示词和验证截图，不公开 |

## 资源说明

9 幅杏菜主题画面为 AI 辅助绘制，提示词与原始图位于 `output/gallery/`；海风背景原图位于 `output/seaside-breeze-background.png`。头像、歌曲及封面沿用个人项目资源。

Markdown 使用 [Marked](https://github.com/markedjs/marked)，代码高亮使用 [highlight.js](https://highlightjs.org/)，图表使用 [Mermaid Tiny](https://mermaid.js.org/config/usage.html)。构建依赖版本固定于 `package-lock.json`。
