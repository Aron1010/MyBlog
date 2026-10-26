import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {fileURLToPath} from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8'));
export function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]).sort();
}
export function readPost(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('缺少 frontmatter: ' + file);
  return {raw, data:YAML.parse(match[1]), markdown:match[2].trim()};
}
function isoDate(value, fallback='') {
  const date = String(value || fallback).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error('无效日期: '+value);
  return date;
}
export function compile() {
  if (config.publishedPostIds !== undefined && !Array.isArray(config.publishedPostIds)) throw new Error('publishedPostIds 必须是文章 id 数组');
  const ids = new Set(), urls = new Set();
  const posts = [];
  for (const file of walk(path.join(root,'content','posts')).filter(f => /\.mdx?$/.test(f))) {
    const {data,markdown} = readPost(file);
    if (config.showPosts === false || data.draft === true || data.password || (config.publishedPostIds && !config.publishedPostIds.includes(data.id))) continue;
    const relative = path.relative(path.join(root,'content','posts'),file).split(path.sep).join('/');
    const id = data.id;
    const permalink = data.permalink;
    if (!id || !permalink?.startsWith('/posts/') || !permalink.endsWith('/') || /\.\.|[?#]/.test(permalink)) throw new Error('请设置唯一 id 和 /posts/.../ 格式的 permalink: '+file);
    if (ids.has(id) || urls.has(permalink)) throw new Error('文章 id 或地址重复: '+file);
    ids.add(id); urls.add(permalink);
    if (!data.title || !data.description || !data.category) throw new Error('请补齐标题、简介和分类: '+file);
    posts.push({id,title:data.title,desc:data.description,date:isoDate(data.published),category:data.category,tags:[...new Set((data.tags||[]).map(t=>String(t).trim()).filter(Boolean))],image:data.image||'anna-bookshop',minutes:Math.max(2,Math.ceil(markdown.length/650)),markdown,source:relative,url:permalink,author:data.author||config.author});
  }
  posts.sort((a,b)=>b.date.localeCompare(a.date)||a.source.localeCompare(b.source,'zh-CN',{numeric:true}));
  const bySource = new Map(posts.map(p=>[p.source,p]));
  for (const post of posts) {
    post.links = {};
    for (const match of post.markdown.matchAll(/\]\(([^\s)]+\.md(?:#[^\s)]*)?)\)/g)) {
      const [target,anchor] = match[1].split('#');
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(post.source),decodeURIComponent(target)));
      const linked = bySource.get(relative);
      if (!linked) throw new Error('失效站内文章链接: '+post.source+' → '+match[1]);
      post.links[match[1]] = '#post/'+linked.id+(anchor?'?heading='+encodeURIComponent(anchor):'');
    }
  }
  fs.writeFileSync(path.join(root,'assets','posts.js'), 'const SITE_CONFIG = '+JSON.stringify(config)+';\nconst BLOG_POSTS = '+JSON.stringify(posts)+';\n');
  return posts;
}
