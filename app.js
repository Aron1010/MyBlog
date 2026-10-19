const IMAGE_DATA = {};
const REDRAW_IMAGES = {station:'anna-station',summer:'anna-summer',rooftop:'anna-rooftop',soda:'anna-soda',hello:'anna-hello',evening:'anna-evening'};
const imageSrc = name => { const key = REDRAW_IMAGES[name] || name; return IMAGE_DATA[key] || (pathRouting ? '/' : '') + 'assets/' + key + '.jpg'; };
const entries = BLOG_POSTS;
const realPosts = entries;
const categories = ['全部', ...new Set(entries.map(e => e.category))];
const photos = [
  {image:'station',title:'等一班开往夏天的列车',label:'a little journey'},
  {image:'summer',title:'今天的快乐，冰冰凉凉',label:'sweet summer'},
  {image:'rooftop',title:'风刚好，心情也是',label:'a breezy day'},
  {image:'soda',title:'蓝色是一种好心情',label:'blue moments'},
  {image:'hello',title:'你好，又是晴朗的一天',label:'hello sunshine'},
  {image:'evening',title:'把温柔留给傍晚',label:'after the rain'},
  {image:'seaside-breeze',title:'海风吹来的晴天',label:'a breeze from the sea'},
  {image:'anna-bookshop',title:'把午后留给一本书',label:'a quiet afternoon'},
  {image:'anna-hydrangea',title:'雨天也有蓝色心情',label:'a little blue in the rain'},
  ...GALLERY_PHOTOS
];
const main = document.querySelector('#main');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => String(value || '').replaceAll('-', '.');
const pathRouting = document.documentElement.dataset.routing === 'path' && location.protocol !== 'file:';
const sectionRoutes = {home:'/',diary:'/articles/',topics:'/topics/',archive:'/archive/',gallery:'/gallery/',about:'/about/'};
function publicLink(hash) {
  if (!pathRouting || !/^#(?:home|diary|topics|archive|gallery|about|post\/|category\/|tag\/)/.test(hash)) return hash;
  const [route, query=''] = hash.slice(1).split('?');
  const [kind, ...parts] = route.split('/');
  const value = decodeURIComponent(parts.join('/'));
  const target = kind === 'post' ? entries.find(e => e.id === value)?.url : kind === 'category' ? '/categories/' + encodeURIComponent(value) + '/' : kind === 'tag' ? '/tags/' + encodeURIComponent(value) + '/' : sectionRoutes[kind];
  if (!target) return hash;
  const params = new URLSearchParams(query);
  const chapter = params.get('section') || params.get('heading');
  return encodeURI(decodeURI(target)) + (chapter ? '#' + encodeURIComponent(chapter) : query ? '?' + query : '');
}
function enhanceLinks() {
  document.querySelectorAll('a[href^="#"]').forEach(a => a.setAttribute('href',publicLink(a.getAttribute('href'))));
}
let selected = '全部', limit = 6, activeTag = '', articleHeadings = [];
let renderedHash = '', restoringView = false, scrollFrame = 0;
const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
function routeInfo() {
  let full = location.hash.slice(1);
  if (!/^(?:(?:home|diary|topics|archive|gallery|about)(?:$|[/?])|(?:post|category|tag)\/)/.test(full)) {
    let pathname;
    try { pathname = decodeURIComponent(location.pathname).replace(/index\.html$/, '').replace(/\/$/,'') || '/'; } catch { pathname = '/404'; }
    const post = entries.find(e => e.url.replace(/\/$/,'') === pathname);
    const category = pathname.match(/^\/categories\/(.+)$/);
    const tag = pathname.match(/^\/tags\/(.+)$/);
    const section = Object.entries(sectionRoutes).find(([,url]) => (url.replace(/\/$/,'') || '/') === pathname)?.[0];
    full = post ? 'post/' + post.id : category ? 'category/' + encodeURIComponent(category[1]) : tag ? 'tag/' + encodeURIComponent(tag[1]) : section || (pathRouting ? '404' : 'home');
    const params = new URLSearchParams(location.search);
    if (section === 'archive' && params.has('category')) full = 'category/' + encodeURIComponent(params.get('category'));
    if (section === 'archive' && params.has('tag')) full = 'tag/' + encodeURIComponent(params.get('tag'));
    if (post && location.hash) params.set('heading',decodeURIComponent(location.hash.slice(1)));
    full += params.size ? '?' + params.toString() : '';
  }
  const [path, queryString = ''] = full.split('?');
  const params = new URLSearchParams(queryString);
  let value = path.slice(path.indexOf('/') + 1);
  try { value = decodeURIComponent(value); } catch { value = ''; }
  return {path, params, value};
}
function saveView() {
  if (!window.__PRERENDER__ && !restoringView) history.replaceState({...history.state, sunny: {y: scrollY, limit}}, '');
}
function navigate(hash, preserveScroll = false, focusFilter = '') {
  hash = publicLink(hash);
  saveView();
  const y = preserveScroll ? scrollY : 0;
  const state = {...history.state, sunny: {y, limit: 6}};
  if (location.hash === hash) history.replaceState(state, '', hash);
  else history.pushState(state, '', hash);
  limit = 6;
  render(false);
  window.scrollTo({top: y, behavior: 'instant'});
  const focus = focusFilter ? [...main.querySelectorAll('[data-filter]')].find(b => b.dataset.filter === focusFilter) : main;
  focus?.focus({preventScroll: true});
  saveView();
}
function tocLinks(id) {
  return articleHeadings.map(h => `<a class="toc-link ${h.level === 'H3' ? 'toc-sub' : ''}" data-scroll="${h.id}" href="#post/${id}?section=${h.id}">${esc(h.title)}</a>`).join('');
}
function jumpToSection(id, animate = true) {
  const heading = document.getElementById(id) || main.querySelector('[data-section="' + CSS.escape(id) + '"]');
  if (!heading || !articleHeadings.some(h => h.id === heading.id)) return;
  main.querySelector('.mobile-toc')?.removeAttribute('open');
  heading.setAttribute('tabindex', '-1');
  heading.focus({preventScroll: true});
  heading.scrollIntoView({behavior: animate ? motion() : 'instant'});
}

let liked = [];
try { liked = JSON.parse(localStorage.getItem('aron-sunny-hearts') || '[]'); if (!Array.isArray(liked)) liked = []; } catch {}
function heart(id) {
  const active = liked.includes(id);
  return `<button class="heart" data-like="${id}" aria-label="${active ? '取消喜欢' : '喜欢这篇文章'}" aria-pressed="${active}">${active ? '♥' : '♡'}</button>`;
}
function tagLink(tag) { return `<a href="#tag/${encodeURIComponent(tag)}" class="tag">${esc(tag)}</a>`; }
function card(e) {
  return `<article class="blog-row"><a class="row-thumbnail" href="#post/${e.id}" aria-label="阅读：${esc(e.title)}"><img src="${imageSrc(e.image)}" alt="" loading="lazy"></a><div class="row-copy"><div class="post-meta"><a href="#category/${encodeURIComponent(e.category)}" class="category-label">${esc(e.category)}</a><span class="dot"></span><time datetime="${e.date}">${date(e.date)}</time></div><h3><a href="#post/${e.id}">${esc(e.title)}</a></h3><p>${esc(e.desc)}</p><div class="row-bottom"><div class="row-tags">${e.tags.slice(0, 2).map(tagLink).join('')}</div><span class="read-time">${e.minutes} 分钟阅读 ${heart(e.id)}</span></div></div></article>`;
}
function filters() {
  return `<div class="filter-row" role="group" aria-label="文章分类">${categories.map(c => `<button data-filter="${esc(c)}" class="${selected === c ? 'active' : ''}" aria-pressed="${selected === c}">${esc(c)}</button>`).join('')}</div>`;
}
function profileCard() {
  return `<section class="profile-card"><img class="profile-avatar" src="${imageSrc('aron')}" alt="Aron 的头像"><h2>Hello, I'm Aron.</h2><p>持续学习，也认真生活。<br>记录后端开发、AI 编程，<br>以及折腾个人网站的点滴。</p><div class="profile-stats"><a href="#archive"><strong>${realPosts.length}</strong><span>篇文章</span></a><a href="#diary"><strong>${new Set(realPosts.map(e => e.category)).size}</strong><span>个分类</span></a><a href="#gallery"><strong>${photos.length}</strong><span>张图片</span></a></div><div class="profile-social"><a href="${esc(SITE_CONFIG.github)}" target="_blank" rel="noopener">GitHub ↗</a><a href="mailto:${esc(SITE_CONFIG.email)}">Email ↗</a></div></section>`;
}
function sidebar() {
  const counts = new Map();
  realPosts.forEach(p => p.tags.forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  const tags = [...counts].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'zh-CN')).slice(0,12).map(([t])=>t);
  return `<aside class="sidebar">${profileCard()}<div class="music-card">${BlogMusic.markup('侧边栏')}</div><section class="sidebar-block"><h3>沿着兴趣，慢慢读 <span>↗</span></h3>${categories.filter(c=>c !== '全部').map(c => `<a class="category-row" href="#category/${c}"><span>${c}</span><span>${realPosts.filter(e => e.category === c).length} 篇</span></a>`).join('')}</section><section class="sidebar-block"><h3>标签 <span>#</span></h3><div class="tag-cloud">${tags.map(tagLink).join('')}</div></section></aside>`;
}
function filteredPosts() { return entries.filter(e => (selected === '全部' || e.category === selected) && (!activeTag || e.tags.includes(activeTag))); }
function diary() {
  const list = filteredPosts();
  return `<section id="diary-section" class="diary-section"><div class="diary-heading"><div class="section-top"><div><div class="kicker">NOTES, DAYS & LITTLE DISCOVERIES</div><h2 class="section-title">${activeTag ? '# ' + esc(activeTag) : selected === '全部' ? '最近更新' : esc(selected)} <span class="post-count">${list.length} 篇</span></h2></div><p class="latest-note">LATEST NOTE / <time datetime="${realPosts[0].date}">${date(realPosts[0].date)}</time></p></div>${filters()}${activeTag ? '<button id="clear-tag" class="clear-filter">清除标签筛选 ×</button>' : ''}</div><div class="diary-layout"><div class="blog-list">${list.length ? list.slice(0, limit).map(card).join('') : '<p class="empty">这个标签下暂时还没有文章。<a href="#diary">查看全部文章 ↗</a></p>'}${list.length > limit ? '<button class="more-button" id="load-more">再翻几页 ↓</button>' : '<p class="list-end">— 读到这里，歇一小会儿 ☁ —</p>'}</div>${sidebar()}</div></section>`;
}
function photoSrc(photo, full = false) {
  const asset = full ? photo.full : photo.thumb;
  return asset ? IMAGE_DATA[asset] || (pathRouting ? '/' : '') + asset : imageSrc(photo.image);
}
function galleryCard(p, i) {
  return `<button type="button" class="gallery-card" data-photo="${i}" aria-label="查看大图：${esc(p.title)}"><figure><div class="gallery-art"><img src="${photoSrc(p)}" alt="${esc(p.title)}" loading="lazy" decoding="async"><span class="gallery-expand" aria-hidden="true">↗</span></div></figure></button>`;
}
let activePhoto = 0;
function showPhoto(index, open = false) {
  activePhoto = (index + photos.length) % photos.length;
  const photo = photos[activePhoto];
  const image = document.querySelector('#large-image');
  image.src = photoSrc(photo, true);
  image.alt = photo.title;
  if (open) document.querySelector('#image-dialog').showModal();
}
function featuredGallery() {
  const featured = [0, 1, 7, 8];
  return `<section class="gallery-section home-gallery" aria-label="晴天照片墙"><div class="gallery-grid gallery-preview photo-clothesline" role="region" aria-label="晾晒晴天照片，可横向滚动" tabindex="0"><svg class="photo-rope" viewBox="0 0 1200 44" preserveAspectRatio="none" aria-hidden="true"><path d="M0 10 Q600 40 1200 10"/></svg>${featured.map(i => galleryCard(photos[i], i)).join('')}<a class="gallery-visit-link" href="#gallery">前往杏菜集 <span aria-hidden="true">↗</span></a></div></section>`;
}
function topics() {
  const descriptions = {Linux:'从目录与路径到网络排查，记下日常使用的基础与方法。', MySQL:'梳理数据库基础、SQL 查询、多表关联、权限与事务。', Redis:'从数据结构到分布式锁、多级缓存和集群，记录缓存的原理与实践。'};
  const topicEntries = categories.filter(c=>c !== '全部').map(name=>[name,descriptions[name] || '记录' + name + '中的见闻、思考与实践。']);
  return `<div class="content topics-page"><div class="view-intro"><div class="kicker">EXPLORE BY TOPIC</div><h1>沿着兴趣，慢慢读。</h1><p>${topicEntries.length} 个专题 · ${realPosts.length} 篇学习笔记</p></div><div class="topic-grid">${topicEntries.map(([name, description]) => { const posts = realPosts.filter(e => e.category === name); return `<section class="topic-card"><div class="topic-heading"><h2><a href="#category/${name}">${name}</a></h2><span>${posts.length} 篇文章</span></div><p>${description}</p><ul>${posts.slice(0,4).map(e => `<li><a href="#post/${e.id}">${esc(e.title)} <span aria-hidden="true">↗</span></a></li>`).join('')}</ul><a class="topic-more" href="#category/${name}">查看全部 ${posts.length} 篇 <span aria-hidden="true">→</span></a></section>`; }).join('')}</div></div>`;
}
function home() {
  return `<div class="hero-wrap"><section class="hero hero-breeze" aria-label="杏菜与海风主题首页"><div class="cinema-copy"><div class="kicker">A LITTLE CORNER OF MY WORLD</div><h1>认真生活，<br><em>也慢慢记录。</em></h1><p>我是 Aron，记录学习与生活。<br>在平凡日子里，收藏一点喜欢。</p><a class="cinema-link" href="#diary">从一篇文章开始 <span aria-hidden="true">↗</span></a></div><span class="cinema-caption">Stay curious. Stay gentle.</span><button class="hero-scroll" type="button" data-home-scroll aria-label="向下浏览文章"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 9 7 7 7-7"/></svg></button></section></div><div class="content"><div class="mobile-home-profile" aria-label="关于 Aron">${profileCard()}</div>${diary()}${featuredGallery()}</div>`;
}
function archive() {
  let month = '';
  return `<div class="content"><div class="view-intro"><div class="kicker">THE ARCHIVE</div><h1>写过的，都在这里。</h1><p>${realPosts.length} 篇文章 · 按发布日期排列</p></div><div class="archive-layout"><section class="archive-list">${realPosts.map(e => { const current = e.date.slice(0, 7); const heading = current !== month ? `<h2 class="archive-month">${current.replace('-', ' / ')} <small>${realPosts.filter(p => p.date.startsWith(current)).length} 篇</small></h2>` : ''; month = current; return heading + `<a class="archive-row" href="#post/${e.id}"><time datetime="${e.date}">${e.date.slice(5).replace('-', '.')}</time><span>${esc(e.title)}</span><small>${esc(e.category)} ↗</small></a>`; }).join('')}</section>${sidebar()}</div></div>`;
}
function gallery() {
  return `<div class="content collection-page"><div class="view-intro"><div class="kicker">ANNA YANAMI / LITTLE DAYS IN BLUE</div><h1>杏菜集</h1><p>蓝天、微风，和那些闪闪发亮的日常。${photos.length} 张图片，慢慢看。</p></div><div class="gallery-grid gallery-collection">${photos.map(galleryCard).join('')}</div><p class="collection-credit">收藏八奈见杏菜的日常：主题插画、动画画面与 Q 版小表情。部分主题插画由 AI 辅助绘制。</p></div>`;
}
function about() {
  return `<div class="content"><div class="about-page"><div class="view-intro"><div class="kicker">THE PERSON BEHIND THE NOTES</div><h1>你好，我是 Aron。</h1><p>持续学习，持续实践，也认真生活。</p></div><img src="${imageSrc('rooftop')}" alt="杏菜与晴空"><div class="prose"><h2>关于我</h2><p>你好，我是 <strong>Aron</strong>，一名正在持续学习和实践的技术爱好者。</p><p>我对后端开发和 AI 编程等方向感兴趣，也喜欢把学习过程中遇到的问题、验证过的解决方法以及自己的思考整理成文字。相比单纯收藏资料，我更愿意通过写作重新梳理知识，让零散的经验逐渐形成清晰、可复用的体系。</p><p>技术之外，我也享受折腾个人网站、优化使用体验，以及探索各种有趣的工具。这个博客既是我的学习笔记，也是我在互联网中保留的一小块个人空间。</p><h2>为什么写博客</h2><p>写下来的过程，也是重新思考的过程。我希望这个博客能够帮助自己沉淀知识、记录成长，也希望这些内容能为遇到相似问题的人提供一点参考。</p><h2>关于清风日常</h2><p>清风日常是我的个人博客，记录后端开发、AI 编程与日常生活。这里的文章不追求堆砌概念，而是希望说明问题的背景、背后的原理和实际操作方法，也会随着新的理解和实践持续补充。蓝天、微风与八奈见杏菜主题插画，陪这些文字一起留在这里。</p><h2>找到我</h2><p><a href="${esc(SITE_CONFIG.github)}" target="_blank" rel="noopener">GitHub ↗</a> &nbsp; / &nbsp; <a href="mailto:${esc(SITE_CONFIG.email)}">Email ↗</a></p></div></div></div>`;
}
function markdownContent(e) {
  const doc = new DOMParser().parseFromString('<html><body>' + marked.parse(e.markdown) + '</body></html>', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(n => Array.from(n.attributes).forEach(a => {
    if (a.name.startsWith('on') || /^(?:javascript|vbscript|data):/i.test(a.value.trim())) n.removeAttribute(a.name);
  }));
  articleHeadings = [];
  const used = new Map();
  doc.querySelectorAll('h2,h3').forEach((h, i) => {
    const base = h.textContent.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '').replace(/\s/g, '-') || 'heading';
    const n = used.get(base) || 0; used.set(base,n+1);
    h.id = base + (n ? '-' + n : '');
    h.dataset.section = 'section-' + i;
    articleHeadings.push({id: h.id, title: h.textContent, level: h.tagName});
  });
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    let decoded = href; try { decoded = decodeURIComponent(href); } catch {}
    if (e.links[href] || e.links[decoded]) a.setAttribute('href',e.links[href] || e.links[decoded]);
    else if (href.startsWith('#')) a.setAttribute('href','#post/' + e.id + '?heading=' + encodeURIComponent(href.slice(1)));
    if (/^https?:/.test(href)) a.setAttribute('rel','noopener noreferrer');
  });
  doc.querySelectorAll('pre > code.language-mermaid').forEach(code => {
    const pre = code.parentElement;
    const figure = doc.createElement('figure'); figure.className = 'diagram-figure';
    const diagram = doc.createElement('div'); diagram.className = 'diagram'; diagram.dataset.diagram = ''; diagram.textContent = code.textContent;
    const details = doc.createElement('details'); details.className = 'diagram-source';
    const summary = doc.createElement('summary'); summary.textContent = '查看图表源码';
    pre.replaceWith(figure); figure.append(diagram,details); details.append(summary,pre);
  });
  doc.querySelectorAll('table').forEach(table => {
    const wrap = doc.createElement('div'); wrap.className = 'table-scroll';
    table.replaceWith(wrap); wrap.appendChild(table);
  });
  doc.querySelectorAll('pre').forEach((pre, i) => {
    const wrap = doc.createElement('div'); wrap.className = 'code-block';
    const language = pre.querySelector('code')?.className.replace('language-', '') || 'text';
    const bar = doc.createElement('div'); bar.className = 'code-toolbar';
    const label = doc.createElement('span'); label.textContent = language;
    const button = doc.createElement('button'); button.dataset.copy = String(i); button.textContent = '复制';
    button.setAttribute('aria-label', '复制第 ' + (i + 1) + ' 段代码');
    bar.append(label, button); pre.replaceWith(wrap); wrap.append(bar, pre);
  });
  return doc.body.innerHTML;
}
function article(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return `<div class="content empty">这篇文章没有找到。<a href="#diary">回到文章列表 ↗</a></div>`;
  const content = markdownContent(e);
  const siblings = entries.filter(p => p.category === e.category && p.id !== e.id);
  const next = siblings[0] || realPosts.find(p => p.id !== e.id);
  return `<div class="content"><div class="article-breadcrumb"><a href="#home">首页</a><span>/</span><a href="#category/${encodeURIComponent(e.category)}">${esc(e.category)}</a><span>/</span><span>正文</span></div><div class="reading-layout"><article class="article-wrap"><header class="article-header"><div class="post-meta"><a class="category-label" href="#category/${encodeURIComponent(e.category)}">${esc(e.category)}</a><span class="dot"></span><time datetime="${e.date}">${date(e.date)}</time><span class="dot"></span>${e.minutes} 分钟阅读</div><h1>${esc(e.title)}</h1><p class="article-description">${esc(e.desc)}</p><div class="article-byline"><img src="${imageSrc('aron')}" alt=""><span>Aron <small>学习笔记</small></span><div class="byline-tags">${e.tags.slice(0, 4).map(tagLink).join('')}</div></div></header>${articleHeadings.length ? `<details class="mobile-toc"><summary>文章目录 <span>${articleHeadings.length} 个章节</span></summary><nav aria-label="手机文章目录">${tocLinks(e.id)}</nav></details>` : ''}<div class="prose article-prose" id="article-body">${content}</div><div class="article-attribution"><strong>Aron 的清风日常</strong><p>作者 ${esc(e.author)} · 发布于 ${date(e.date)}${e.updated !== e.date ? ' · 更新于 ' + date(e.updated) : ''}</p><p>愿这份记录能为你提供一点参考。发现问题，欢迎通过 <a href="${esc(SITE_CONFIG.github)}" target="_blank" rel="noopener">GitHub</a> 或 <a href="mailto:${esc(SITE_CONFIG.email)}">邮件</a>交流。</p></div><div class="article-end"><p>如果这篇记录对你有用，留下一份喜欢。</p>${heart(e.id)}</div><div class="article-next"><a href="#diary">← 所有文章</a><a href="#post/${next.id}"><small>继续阅读</small>${esc(next.title)} →</a></div></article><aside class="article-aside"><div class="toc"><div class="toc-title">这一页的目录 <span>☁</span></div><nav aria-label="文章目录">${tocLinks(e.id)}</nav><a class="toc-back" href="#diary">← 回到文章列表</a></div></aside></div><button class="back-top" id="back-top" aria-label="回到顶部">↑</button></div>`;
}
function updateMetadata(view, id) {
  const post = view === 'post' ? entries.find(p => p.id === id) : null;
  const url = post?.url || (activeTag ? '/tags/' + encodeURIComponent(activeTag) + '/' : selected !== '全部' ? '/categories/' + encodeURIComponent(selected) + '/' : sectionRoutes[view] || '/');
  const canonical = SITE_CONFIG.url + encodeURI(decodeURI(url));
  const description = post?.desc || (activeTag ? '带有“' + activeTag + '”标签的文章，共 ' + filteredPosts().length + ' 篇。' : selected !== '全部' ? selected + ' 分类的学习笔记与实践，共 ' + filteredPosts().length + ' 篇。' : SITE_CONFIG.description);
  const setMeta = (name, content, property = false) => {
    const attr = property ? 'property' : 'name';
    let element = document.head.querySelector('meta[' + attr + '="' + name + '"]');
    if (!element) { element = document.createElement('meta'); element.setAttribute(attr,name); document.head.append(element); }
    element.content = content;
  };
  setMeta('description',description);
  setMeta('robots', view === '404' || view === 'post' && !post ? 'noindex,follow' : 'index,follow');
  setMeta('og:title',document.title,true); setMeta('og:description',description,true);
  setMeta('og:url',canonical,true); setMeta('og:site_name',SITE_CONFIG.name,true);
  setMeta('og:type',post?'article':'website',true);
  setMeta('og:image',SITE_CONFIG.url + '/assets/' + (post ? REDRAW_IMAGES[post.image] || post.image : 'seaside-breeze') + '.jpg',true);
  setMeta('og:locale','zh_CN',true);
  setMeta('twitter:card','summary_large_image');
  document.querySelectorAll('meta[property^="article:"]').forEach(n=>n.remove());
  if (post) {setMeta('article:published_time',post.date+'T00:00:00+08:00',true);setMeta('article:modified_time',post.updated+'T00:00:00+08:00',true);}
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {link=document.createElement('link');link.rel='canonical';document.head.append(link);}
  link.href = canonical;
  let structured = document.querySelector('#structured-data');
  if (!structured) {structured = document.createElement('script');structured.id='structured-data';structured.type='application/ld+json';document.head.append(structured);}
  const data = post ? {'@context':'https://schema.org','@type':'BlogPosting',headline:post.title,description,datePublished:post.date+'T00:00:00+08:00',dateModified:post.updated+'T00:00:00+08:00',author:{'@type':'Person',name:post.author,url:SITE_CONFIG.url+'/about/'},mainEntityOfPage:canonical,url:canonical,image:SITE_CONFIG.url+'/assets/'+(REDRAW_IMAGES[post.image]||post.image)+'.jpg',inLanguage:'zh-CN',keywords:post.tags.join(', ')} : {'@context':'https://schema.org','@type':'WebSite',name:SITE_CONFIG.name,url:SITE_CONFIG.url+'/',description,inLanguage:'zh-CN',author:{'@type':'Person',name:SITE_CONFIG.author}};
  structured.textContent = JSON.stringify(data).replace(/</g,'\\u003c');
}
let diagramLibrary, diagramSerial = 0;
async function renderDiagrams() {
  const nodes = [...main.querySelectorAll('[data-diagram]')];
  if (!nodes.length) return;
  try {
    if (!window.mermaid) {
      diagramLibrary ||= new Promise((resolve,reject) => {
        const script = document.createElement('script'); script.src = (pathRouting ? '/' : '') + 'assets/mermaid.min.js';
        script.onload = resolve; script.onerror = () => {script.remove();diagramLibrary=null;reject(new Error('图表组件加载失败'));}; document.head.append(script);
      });
      await diagramLibrary;
    }
    window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',fontFamily:'Arial, PingFang SC, Microsoft YaHei, sans-serif',themeVariables:{primaryColor:'#e6f2fa',primaryTextColor:'#305570',primaryBorderColor:'#8bb2cc',lineColor:'#6a91ac',secondaryColor:'#fff8de',tertiaryColor:'#f4f9fc'},flowchart:{htmlLabels:false},sequence:{useMaxWidth:true}});
    for (const node of nodes) {
      if (!node.isConnected) continue;
      const source = node.textContent;
      try {
        const result = await window.mermaid.render('breeze-diagram-' + (++diagramSerial),source);
        if (!node.isConnected) continue;
        node.innerHTML=result.svg; node.dataset.rendered='true';
        const svg=node.querySelector('svg');if(svg){svg.setAttribute('role','img');svg.setAttribute('aria-label','文章架构流程图');}
      } catch {
        if (node.isConnected) {node.textContent='图表暂时无法显示，可展开下方源码查看。';node.dataset.error='true';node.nextElementSibling.open=true;}
      }
    }
    updateProgress();
  } catch {
    nodes.forEach(node=>{if(node.isConnected){node.textContent='图表组件暂未加载，可展开下方源码查看。';node.nextElementSibling.open=true;}});
  }
}

function closeMobileMenu() {
  const menu = document.querySelector('#mobile-menu');
  menu?.hidePopover();
}
function render(scroll = true) {
  if (!window.__PRERENDER__) closeMobileMenu();
  const {path: route, params, value} = routeInfo();
  selected = route.startsWith('category/') ? value : route === 'home' ? params.get('category') || '全部' : '全部';
  activeTag = route.startsWith('tag/') ? value : '';
  const view = route.startsWith('post/') ? 'post' : route.startsWith('category/') || route.startsWith('tag/') ? 'diary' : route;
  document.querySelectorAll('[data-nav]').forEach(a => {
    const active = a.dataset.nav === view || view === 'post' && a.dataset.nav === 'diary';
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.body.classList.toggle('is-reading', view === 'post');
  document.body.classList.toggle('is-home', view === 'home');
  main.innerHTML = view === 'post' ? article(value) : view === 'gallery' ? gallery() : view === 'topics' ? topics() : view === 'archive' ? archive() : view === 'about' ? about() : view === '404' ? `<div class="content empty"><h1>这页记录暂时没有找到。</h1><p>可以搜索文章，或<a href="#home">回到首页 ↗</a>。</p></div>` : view === 'diary' ? `<div class="content"><div class="view-intro"><div class="kicker">ALL MY NOTES</div><h1>一点一滴，写下来。</h1><p>学习笔记、生活片段，还有那些值得留下的思考。</p></div>${diary()}</div>` : home();
  enhanceLinks();
  BlogMusic.refresh();
  if (!window.__PRERENDER__) renderDiagrams();
  if (view === 'post' && window.hljs) main.querySelectorAll('pre code').forEach(block => {
    const lang = block.className.replace('language-', '');
    if (lang !== 'mermaid' && (!lang || hljs.getLanguage(lang))) hljs.highlightElement(block);
  });
  renderedHash = location.href;
  if (scroll && !window.__PRERENDER__) {
    window.scrollTo({top: 0, behavior: 'instant'});
    if (view === 'post' && (params.has('section') || params.has('heading'))) jumpToSection(params.get('section') || params.get('heading'), false);
  }
  const names = {home: 'Aron 的清风日常', diary: '文章', topics: '专题', archive: '文章归档', gallery: '杏菜集', about: '关于 Aron', '404':'页面未找到'};
  const title = view === 'post' ? entries.find(e => e.id === value)?.title || '文章未找到' : activeTag ? '# ' + activeTag : selected !== '全部' ? selected : names[view] || names.home;
  document.title = view === 'home' ? 'Aron 的清风日常 · 记录学习与生活' : title + ' · 清风日常';
  updateMetadata(view, value);
  updateProgress();
}
let toastTimer;
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2400); }
function updateProgress() {
  if (window.__PRERENDER__) return;
  const body = document.querySelector('#article-body');
  const bar = document.querySelector('#reading-progress');
  if (!body) { bar.style.width = '0%'; return; }
  const headerHeight = document.querySelector('.header').offsetHeight;
  const start = scrollY + body.getBoundingClientRect().top - headerHeight;
  const distance = Math.max(1, body.scrollHeight - innerHeight + headerHeight);
  const progress = Math.max(0, Math.min(100, (scrollY - start) / distance * 100));
  bar.style.width = progress + '%';
  let active = articleHeadings[0]?.id;
  for (const h of articleHeadings) {
    if (document.getElementById(h.id)?.getBoundingClientRect().top <= headerHeight + 100) active = h.id;
    else break;
  }
  main.querySelectorAll('.toc-link').forEach(link => {
    if (link.dataset.scroll === active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#back-top')?.classList.toggle('visible', scrollY > 400);
}
if (!window.__PRERENDER__) {
const mobileMenu = document.querySelector('#mobile-menu');
const menuToggle = document.querySelector('#menu-open');
menuToggle.addEventListener('click', () => {
  document.querySelector('#music-panel').hidePopover();
});
mobileMenu.addEventListener('toggle', event => {
  menuToggle.setAttribute('aria-expanded', String(event.newState === 'open'));
  if (event.newState === 'closed') mobileMenu.querySelectorAll('details[open]').forEach(group => { group.open = false; });
});
mobileMenu.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (link && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) closeMobileMenu();
});
window.addEventListener('resize', () => { if (matchMedia('(min-width: 721px)').matches) closeMobileMenu(); });
window.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; updateProgress(); saveView(); });
}, {passive: true});
window.addEventListener('resize', updateProgress);
document.addEventListener('click', async event => {
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    const category = filter.dataset.filter;
    const homeView = routeInfo().path === 'home';
    const hash = homeView ? '#home' + (category === '全部' ? '' : '?category=' + encodeURIComponent(category)) : category === '全部' ? '#diary' : '#category/' + encodeURIComponent(category);
    navigate(hash, true, category);
  }
  if (event.target.closest('#clear-tag')) navigate('#diary', true);
  if (event.target.closest('#load-more')) {
    const oldLimit = limit, y = scrollY;
    limit += 6; render(false); window.scrollTo({top: y, behavior: 'instant'});
    main.querySelectorAll('.row-copy h3 a')[oldLimit]?.focus({preventScroll: true}); saveView();
  }
  const like = event.target.closest('[data-like]');
  if (like) { const id = like.dataset.like; liked = liked.includes(id) ? liked.filter(v => v !== id) : [...liked, id]; try { localStorage.setItem('aron-sunny-hearts', JSON.stringify(liked)); } catch {} document.querySelectorAll('[data-like="' + id + '"]').forEach(b => { b.textContent = liked.includes(id) ? '♥' : '♡'; b.setAttribute('aria-pressed', String(liked.includes(id))); b.setAttribute('aria-label', liked.includes(id) ? '取消喜欢' : '喜欢这篇文章'); }); if (liked.includes(id)) toast('这一份喜欢，收好啦 ♡'); }
  const photo = event.target.closest('[data-photo]');
  if (photo) showPhoto(Number(photo.dataset.photo), true);
  const galleryStep = event.target.closest('[data-gallery-step]');
  if (galleryStep) showPhoto(activePhoto + Number(galleryStep.dataset.galleryStep));
  const scroll = event.target.closest('[data-scroll]');
  if (scroll && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    history.replaceState(history.state, '', scroll.getAttribute('href'));
    renderedHash = location.href;
    jumpToSection(scroll.dataset.scroll);
    return;
  }
  if (event.target.closest('#back-top')) window.scrollTo({top: 0, behavior: motion()});
  if (event.target.closest('[data-home-scroll]')) {
    const nextSection = matchMedia('(max-width: 720px)').matches ? main.querySelector('.mobile-home-profile') : main.querySelector('#diary-section');
    nextSection?.scrollIntoView({behavior: motion(), block: 'start'});
  }
  const copy = event.target.closest('[data-copy]');
  if (copy) { const code = copy.closest('.code-block').querySelector('code').textContent; try { await navigator.clipboard.writeText(code); copy.textContent = '已复制'; setTimeout(() => { if (copy.isConnected) copy.textContent = '复制'; }, 1800); } catch { const range = document.createRange(); range.selectNodeContents(copy.closest('.code-block').querySelector('code')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('代码已选中，按 ⌘C / Ctrl+C 复制'); } }
  const close = event.target.closest('[data-close]'); if (close) close.closest('dialog').close();
  const candidate = event.target.closest('a[href]');
  const href = candidate?.getAttribute('href') || '';
  const internal = href.startsWith('#') || (pathRouting && href.startsWith('/') && !href.startsWith('//') && !/\.[a-z0-9]+(?:[?#]|$)/i.test(href));
  const anchor = internal ? candidate : null;
  if (anchor && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
    event.preventDefault();
    const hash = anchor.getAttribute('href');
    if (hash === '#main') { main.focus({preventScroll: true}); main.scrollIntoView({behavior: motion()}); }
    else navigate(hash);
  }
});
const searchDialog = document.querySelector('#search-dialog'), query = document.querySelector('#query');
const searchIndex = entries.map(e => ({
  entry: e,
  text: e.markdown.replace(/```[^\n]*\n/g, '').replace(/```|[#*_>|`]/g, '').replace(/\s+/g, ' ').trim(),
}));
function highlighted(text, queryText) {
  if (!queryText) return esc(text);
  const index = text.toLowerCase().indexOf(queryText);
  return index < 0 ? esc(text) : esc(text.slice(0, index)) + '<mark>' + esc(text.slice(index, index + queryText.length)) + '</mark>' + esc(text.slice(index + queryText.length));
}
function search() {
  const q = query.value.trim().toLowerCase();
  const results = searchIndex.filter(({entry: e, text}) => (e.title + ' ' + e.category + ' ' + e.desc + ' ' + e.tags.join(' ') + ' ' + text).toLowerCase().includes(q));
  document.querySelector('#search-results').innerHTML = `<div class="search-result-count" role="status">${q ? '找到' : '全部'} ${results.length} 篇文章</div>` + (results.length ? results.map(({entry: e, text}) => {
    const match = q ? text.toLowerCase().indexOf(q) : -1;
    const start = Math.max(0, match - 28);
    const excerpt = match >= 0 ? (start ? '…' : '') + text.slice(start, start + 120) + (text.length > start + 120 ? '…' : '') : e.desc;
    return `<a class="search-result" href="#post/${e.id}"><strong>${highlighted(e.title, q)}</strong><span>${esc(e.category)} · ${date(e.date)} · ${e.minutes} 分钟</span><p>${highlighted(excerpt, q)}</p></a>`;
  }).join('') : '<p class="empty">没有找到这条记录。换个关键词试试吧 ☁</p>');
  enhanceLinks();
}
function openSearch() { searchDialog.showModal(); query.value = ''; search(); query.focus(); }
document.querySelector('#search-open').addEventListener('click', openSearch);
query.addEventListener('input', search);
searchDialog.addEventListener('click', e => { if (e.target.closest('.search-result')) searchDialog.close(); });
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close(); } }));
document.addEventListener('keydown', e => {
  if (document.querySelector('#image-dialog[open]') && !e.metaKey && !e.ctrlKey && !e.altKey && ['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); showPhoto(activePhoto + (e.key === 'ArrowLeft' ? -1 : 1)); }
  if (e.key === '/' && !document.querySelector('dialog[open]') && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); openSearch(); }
});
history.scrollRestoration = 'manual';
window.addEventListener('popstate', () => {
  restoringView = true;
  const saved = history.state?.sunny;
  limit = saved?.limit || 6;
  render(!saved);
  if (saved) window.scrollTo({top: saved.y, behavior: 'instant'});
  main.focus({preventScroll: true});
  restoringView = false;
  updateProgress();
});
window.addEventListener('hashchange', () => {
  if (renderedHash === location.href) return;
  limit = 6; render(); saveView();
});
render();
saveView();
} else { render(false); }
