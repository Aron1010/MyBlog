import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {root,config,walk,readPost,hash} from './content.mjs';
const dist = path.join(root,'dist');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/posts.js'),'utf8')+';this.posts=BLOG_POSTS;',context);
const posts = context.posts;
const audit = process.argv.includes('--migration');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'migration/manifest.json'),'utf8'));
assert.equal(manifest.filter(m=>!m.draft).length,32);
assert.equal(manifest.filter(m=>m.draft).length,13);
if (audit) assert.equal(posts.length,32,'本次应迁移全部 32 篇正式文章');
for (const entry of manifest) {
  const archived = readPost(path.join(root,'migration/source-posts',entry.source));
  assert.equal(hash(archived.raw),entry.sourceHash,'原始备份完整性: '+entry.source);
  const current = audit ? readPost(path.join(root,entry.target)) : null;
  if (audit) assert.equal(hash(current.markdown),entry.migratedBodyHash,'迁移正文完整性: '+entry.source);
  if (!entry.correction) assert.equal(entry.bodyHash,entry.migratedBodyHash);
  if (audit && entry.draft) assert(!posts.some(p=>p.source===entry.source),'草稿不得进入公开数据');
}
const pages = walk(dist).filter(f=>f.endsWith('.html'));
const docs = new Map();
for (const file of pages) docs.set(file,parseHTML(fs.readFileSync(file,'utf8')).document);
let checkedLinks=0, checkedAssets=0;
for (const [file,doc] of docs) {
  const base = new URL('https://aron.xin/'+path.relative(dist,file).split(path.sep).join('/'));
  assert(doc.querySelector('main')?.textContent.trim(),'页面应有预渲染正文: '+file);
  assert(doc.querySelector('h1'),'页面应有主标题: '+file);
  assert(!/生活示例|生活手帐 · 示例|访问原博客|aronblake\.cloud/.test(doc.body.textContent),'不得保留过期预览内容: '+file);
  const canonical = doc.querySelector('[rel=canonical]')?.getAttribute('href');
  assert(canonical?.startsWith(config.url+'/'),'canonical 使用正式域名');
  assert(doc.querySelector('meta[name=description]')?.content,'页面应有描述');
  assert(doc.querySelector('#structured-data'),'页面应有结构化数据');
  for (const element of doc.querySelectorAll('a[href],img[src],script[src],link[href],audio[src]')) {
    const raw = element.getAttribute(element.hasAttribute('src')?'src':'href');
    if (!raw || /^(mailto:|data:|tel:)/.test(raw)) continue;
    const url = new URL(raw,base);
    if (url.origin!==base.origin) continue;
    let target = path.join(dist,decodeURIComponent(url.pathname));
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target=path.join(target,'index.html');
    assert(fs.existsSync(target),'站内链接或资源不存在: '+path.relative(dist,file)+' → '+raw);
    if (element.tagName==='A') {
      checkedLinks++;
      if (url.hash && !url.search && target.endsWith('.html')) {
        const id=decodeURIComponent(url.hash.slice(1));
        assert(docs.get(target)?.getElementById(id),'章节链接不存在: '+raw);
      }
    } else checkedAssets++;
  }
}
for (const post of posts) {
  const file = path.join(dist,post.url,'index.html');
  const doc = docs.get(file);
  assert(doc,'独立文章页面应存在: '+post.url);
  assert.equal(doc.querySelector('.article-header h1').textContent,post.title);
  const data = JSON.parse(doc.querySelector('#structured-data').textContent);
  assert.equal(data['@type'],'BlogPosting');
  assert.equal(data.datePublished.slice(0,10),post.date);
  assert(doc.querySelector('#article-body')?.textContent.length>200,'正文不得截断');
}
const archive=docs.get(path.join(dist,'archive/index.html'));
assert.equal(archive.querySelectorAll('.archive-row').length,posts.length);
const counts=Object.fromEntries([...new Set(posts.map(p=>p.category))].map(c=>[c,posts.filter(p=>p.category===c).length]));
if (audit) assert.deepEqual(counts,{MySQL:4,Redis:22,Linux:6});
const rss = fs.readFileSync(path.join(dist,'rss.xml'),'utf8');
assert.equal((rss.match(/<item>/g)||[]).length,posts.length);
for (const post of posts) assert(rss.includes(encodeURI(config.url+post.url)),'RSS 包含全部文章');
for (const file of walk(dist)) assert(!/^(?:content|migration|node_modules|output)\/|sample-posts\.json|encrypted-demo/.test(path.relative(dist,file)),'公开产物不得包含草稿或备份');
console.log(JSON.stringify({published:posts.length,draftsPreserved:13,categories:counts,staticPages:pages.length,internalLinks:checkedLinks,assetReferences:checkedAssets,sourceBodiesVerified:audit?manifest.length:0,rssItems:posts.length},null,2));
