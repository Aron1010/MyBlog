import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import {fileURLToPath} from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const config = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8'));
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]).sort();
}
export function readPost(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('缺少 frontmatter: ' + file);
  return {raw, data:YAML.parse(match[1]), markdown:match[2].trim()};
}
const selected = {
  'MySQL/01-概述与DDL.md':['mysql-ddl','rooftop'],
  'MySQL/04-用户权限与事务.md':['mysql-transactions','station'],
  'Redis/01-Redis键值与数据结构最佳实践.md':['redis-keys','soda'],
  'Redis/02-Redis批处理与Pipeline最佳实践.md':['redis-pipeline','hello'],
  'Linux/05-网络进程和系统资源排查.md':['linux-network','evening'],
  'Linux/01-Linux目录结构与路径基础.md':['linux-paths','summer']
};
const pictures = ['station','summer','rooftop','soda','hello','evening','anna-bookshop','anna-hydrangea'];
const missingLink = '[Lua 语法入门：整理与补充](./Lua语法入门-整理与补充.md)';
export function migrate(source) {
  const destination = path.join(root,'content');
  if (fs.existsSync(destination)) throw new Error('content 已存在，迁移不会覆盖新站文章。日常更新请使用 npm run build。');
  const archive = path.join(root,'migration','source-posts');
  fs.mkdirSync(path.dirname(archive), {recursive:true});
  fs.cpSync(source, archive, {recursive:true});
  const manifest = [];
  for (const file of walk(source).filter(f => /\.mdx?$/.test(f))) {
    const relative = path.relative(source,file).split(path.sep).join('/');
    const {raw,data,markdown} = readPost(file);
    const draft = data.draft === true || !!data.password;
    const target = path.join(destination, draft ? 'drafts' : 'posts', relative);
    fs.mkdirSync(path.dirname(target), {recursive:true});
    const [id,image] = selected[relative] || ['post-' + hash(relative).slice(0,10), pictures[manifest.length % pictures.length]];
    const normalized = {...data, id, permalink:'/posts/' + relative.replace(/\.mdx?$/, '').toLowerCase() + '/', image, author:'Aron'};
    let body = markdown;
    if (!draft && body.includes(missingLink)) body = body.replace(missingLink, 'Lua 语法入门：整理与补充（原文链接缺失，暂未收录）');
    fs.writeFileSync(target, '---\n' + YAML.stringify(normalized) + '---\n\n' + body + '\n');
    manifest.push({source:relative,target:path.relative(root,target),title:data.title,draft,sourceHash:hash(raw),bodyHash:hash(markdown),migratedBodyHash:hash(body),permalink:normalized.permalink,correction:body !== markdown ? '将不存在的 Lua 文章链接改为文字说明，其他正文保留。' : null});
  }
  fs.writeFileSync(path.join(root,'migration','manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
function isoDate(value, fallback='') {
  const date = String(value || fallback).slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error('无效日期: '+value);
  return date;
}
export function compile() {
  const ids = new Set(), urls = new Set();
  const posts = [];
  for (const file of walk(path.join(root,'content','posts')).filter(f => /\.mdx?$/.test(f))) {
    const {data,markdown} = readPost(file);
    if (data.draft === true || data.password) continue;
    const relative = path.relative(path.join(root,'content','posts'),file).split(path.sep).join('/');
    const id = data.id;
    const permalink = data.permalink;
    if (!id || !permalink?.startsWith('/posts/') || !permalink.endsWith('/') || /\.\.|[?#]/.test(permalink)) throw new Error('请设置唯一 id 和 /posts/.../ 格式的 permalink: '+file);
    if (ids.has(id) || urls.has(permalink)) throw new Error('文章 id 或地址重复: '+file);
    ids.add(id); urls.add(permalink);
    if (!data.title || !data.description || !data.category) throw new Error('请补齐标题、简介和分类: '+file);
    posts.push({id,title:data.title,desc:data.description,date:isoDate(data.published),updated:isoDate(data.updated,data.published),category:data.category,tags:[...new Set((data.tags||[]).map(t=>String(t).trim()).filter(Boolean))],image:data.image||'anna-bookshop',minutes:Math.max(2,Math.ceil(markdown.length/650)),markdown,source:relative,url:permalink,author:data.author||config.author});
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
if (process.argv[2] === '--migrate') {
  const manifest = migrate(path.resolve(process.argv[3] || path.join(root,'../Firefly/src/content/posts')));
  console.log(`已保存 ${manifest.filter(p=>!p.draft).length} 篇正式文章、${manifest.filter(p=>p.draft).length} 篇草稿。`);
  compile();
}
