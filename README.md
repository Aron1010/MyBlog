# 清风日常 · Aron's Little Days

认真生活，也慢慢记录。

Aron 的个人博客，记录后端开发、AI 编程与日常生活。以八奈见杏菜、蓝天与海风为主题，搭配浅蓝透明卡片，收藏学习过程中的收获和喜欢的画面。

[访问博客](https://aron.xin) · [订阅 RSS](https://aron.xin/rss.xml) · [GitHub 仓库](https://github.com/Aron1010/MyBlog)

## 内容与功能

源码保留 **43 篇文章**，目前公开《计算机科学导论》的前两章，Linux 入门指南 10 篇、MySQL 入门指南 9 篇、Redis 22 篇继续隐藏；杏菜集保留 **10 张动画截图**。

- **阅读与检索**：文章列表、分类专题、日期归档、标签筛选和全文搜索。
- **文章阅读**：目录导航、阅读进度、代码高亮与复制、Mermaid 流程图，以及保存在本机的喜欢记录。
- **杏菜集**：首页晾衣绳照片墙、独立图库、缩略图延迟加载、点击查看大图和左右切换，图片下方不显示说明文字。
- **音乐播放器**：本地歌曲、播放列表、同步歌词、音量调节，以及顺序播放、单曲循环和随机播放；站内切换页面时保持播放，不自动播放。
- **手机布局**：独立竖屏背景、紧凑个人介绍卡片、右上角悬浮导航菜单和小型音乐面板；照片墙支持横向滑动，末尾可进入杏菜集。

网站使用 HTML、CSS 和原生 JavaScript，构建脚本将 Markdown 文章预渲染为独立静态页面。正文与归档在关闭 JavaScript 时仍可阅读，搜索、音乐及图库交互需要启用 JavaScript。

## 本地运行

准备 Node.js 22 和 npm。通过本地预览命令启动服务或生成离线预览时，还需要 Python 3。

在项目目录中依次运行：

```sh
npm ci
npm run build
npm run check
npm run preview
```

浏览器打开 <http://127.0.0.1:4174/>，按 `Ctrl+C` 停止服务。修改文章、配置、图片或页面代码后，重新构建并刷新浏览器。

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁定版本安装构建依赖 |
| `npm run build` | 编译文章、预渲染页面并生成 `dist/` |
| `npm run check` | 检查正文、页面元数据、站内链接、资源与 RSS |
| `npm run preview` | 在本机预览 `dist/` 中的网站 |

## 写作

当前 `site.config.json` 中的 `showPosts` 为 `true`，`publishedPostIds` 只允许 `cs-intro-01`、`cs-intro-02` 公开。未列入名单的文章不会进入页面、搜索、RSS、站点地图或公开文章数据，原始 Markdown 保留。发布后续文章时，将新文章的 `id` 加入名单，再构建、检查并部署。设置 `showPosts: false` 可以隐藏全部文章；删除 `publishedPostIds` 字段会恢复公开所有符合条件的文章。草稿与密码排除规则始终有效。

当前系列：

- [第一章：认识计算机与计算机科学](https://aron.xin/posts/computer-science/01-introduction/)
- [第二章：数字系统、位权与进制转换](https://aron.xin/posts/computer-science/02-number-systems/)

两篇文章的封面保存在 `assets/cs-intro-01.jpg`、`assets/cs-intro-02.jpg`，正文示意图位于 `assets/diagrams/`。正文保留原笔记，另加系列导航、来源说明和自测题。

[Linux 入门指南](content/posts/Linux/00-Linux入门指南.md)由一篇导读和九章正文组成，覆盖目录与文件、文本处理、软件与服务、网络资源、用户权限、SSH、Shell 脚本与定时任务、磁盘挂载与备份恢复。各章包含示例、常见问题和速查，不设置自测与练习；当前保留为本地内容，未加入公开文章名单。

[MySQL 入门指南](content/posts/MySQL/00-MySQL入门指南.md)由一篇导读和八章正文组成，以 MySQL 8.4、InnoDB 和统一的部门员工示例串联 DDL、增删改查、函数约束、多表查询、权限事务、索引与执行计划、视图与窗口函数、应用连接、备份恢复。各章保留示例和速查，不设置自测与练习；当前未加入公开文章名单。

在 `content/posts/分类名/` 中创建 Markdown 文件，可复制 [文章模板](content/文章模板.md.txt)，然后修改顶部的 frontmatter：

```yaml
---
title: 一篇新的学习笔记
description: 记录遇到的问题、解决过程和自己的理解。
published: 2026-10-19
updated: 2026-10-19
category: Linux
tags: [Linux, 学习笔记]
id: my-new-note
permalink: /posts/linux/my-new-note/
image: anna-bookshop
author: Aron
draft: false
---
```

`id` 和 `permalink` 必须唯一；地址以 `/posts/` 开头、以 `/` 结尾，发布后尽量保持稳定。`published` 记录首次发布日期，修订时更新 `updated`。

尚未完成的文章可以设为 `draft: true`，或放在 `content/drafts/` 中。草稿和设置了 `password` 字段的文章会被排除，不生成公开页面。

文章之间使用相对 Markdown 链接，例如 `[另一篇笔记](./另一篇笔记.md)`。构建时会转换为站内地址，引用不存在的文章会报错。

## 图片与音乐维护

### 杏菜集

杏菜集的 10 张动画截图统一配置在 [assets/gallery/photos.js](assets/gallery/photos.js)，`app.js` 直接使用该清单。每条记录包含图片名称、分类、缩略图、大图及来源链接。

新增图片时，将缩略图放入 `assets/gallery/thumbnails/`，大图放入 `assets/gallery/full/`，并在 `GALLERY_PHOTOS` 数组中添加记录：

```js
{
  id: 'anna-new-photo',
  title: '八奈见杏菜 · 日常',
  category: '插画',
  thumb: 'assets/gallery/thumbnails/anna-new-photo.webp',
  full: 'assets/gallery/full/anna-new-photo.webp',
  width: 1600,
  height: 2400,
  source: '图片来源链接'
}
```

图片名称用于无障碍描述，不会显示在照片下方。图库列表加载缩略图，打开预览后加载大图；图片总数会自动更新。首页从杏菜集随机抽取四张不重复的照片，每次刷新重新抽取，同一次访问中切换页面时保持不变。

图库仅保留选定的 10 张动画截图及其缩略图。整理后的原始文件与来源表保存在项目外的 `../ya/`；站内使用 WebP 副本，构建和部署不依赖该外部目录。

### 音乐

歌曲、封面、歌词和曲目数据位于 `assets/music/`，播放器逻辑位于 `music.js`。使用现有本地音乐库重新整理资源时，运行：

```sh
python3 prepare_music.py
npm run build
npm run check
```

整理脚本读取项目上级的 `music/` 文件夹，使用 macOS 的 `afinfo` 获取歌曲时长。普通构建与网页播放只使用站内资源，不需要运行这个脚本；新增歌曲时需同步调整脚本中的曲目清单。

## 构建与部署

[GitHub Pages 工作流](.github/workflows/pages.yml) 在推送到 `main` 分支时自动运行，也可以从仓库的 Actions 页面手动触发：

```text
安装依赖 → 构建静态网站 → 完整性检查 → 部署 dist/
```

仓库的 Pages 发布来源使用 **GitHub Actions**。站点地址与联系信息配置在 [site.config.json](site.config.json)，当前正式域名为 `https://aron.xin`；自定义域名和 DNS 在 GitHub Pages 设置及域名服务商处管理。

`dist/` 是部署产物，包含各页面的 HTML、公开资源、RSS、站点地图、robots.txt 和 404 页面。部署时只发布该目录，无需将所有路径回退到首页。`dist/` 与 `node_modules/` 已加入 Git 忽略规则，可以通过构建和安装命令重新生成。

## 离线预览

需要一个可以直接双击打开的本地预览文件时，运行：

```sh
npm run build
python3 build_preview.py
```

生成的 `清风日常.html` 内嵌样式、文章、图片和图表脚本，文件较大，适合本地查看。音乐文件仍从相邻的 `assets/music/` 读取，移动预览文件时需一并保留该目录。离线预览不用于 GitHub Pages 部署。

## 项目结构

| 路径 | 用途 |
| --- | --- |
| `content/posts/` | 正式文章的 Markdown 内容源 |
| `content/drafts/` | 可选的草稿目录，不参与公开构建 |
| `content/文章模板.md.txt` | 新文章模板 |
| `index.html` | 页面结构、导航和弹窗 |
| `app.js` | 路由、文章展示、搜索和图库交互 |
| `style.css` | 桌面与手机端样式 |
| `music.js` | 音乐播放器交互 |
| `site.config.json` | 站名、域名、作者及联系信息 |
| `assets/` | 背景、头像、插画和本地脚本 |
| `assets/gallery/` | 收藏图片清单、缩略图及大图 |
| `assets/music/` | 歌曲、封面和曲目数据 |
| `assets/posts.js` | 构建生成的文章数据，请从 Markdown 修改文章 |
| `scripts/` | 内容编译、静态生成与检查脚本 |
| `.github/workflows/pages.yml` | GitHub Pages 自动构建与部署 |
| `dist/` | 可重新生成的公开网站 |
| `清风日常.html` | 可重新生成的离线预览 |

## 资源与依赖

原有主题插画由 AI 辅助绘制，新增收藏包含插画、动画截图、合照和 Q 版素材，来源链接记录在图片清单中，图片保留原有署名与标记。头像、歌曲和封面沿用个人项目资源。

Markdown 解析使用 Marked，代码高亮使用 highlight.js，图表使用 Mermaid Tiny；构建还使用 linkedom 和 YAML。运行时脚本随站点资源提供，npm 依赖版本由 `package-lock.json` 锁定。
