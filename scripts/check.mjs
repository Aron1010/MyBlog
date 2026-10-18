import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {root,config,walk,readPost} from './content.mjs';
const dist = path.join(root,'dist');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(root,'assets/posts.js'),'utf8')+';this.posts=BLOG_POSTS;',context);
const posts = context.posts;
const sourcePosts = walk(path.join(root,'content','posts')).filter(file=>/\.mdx?$/.test(file)).map(file=>({file,...readPost(file)}));
const publishedSources = sourcePosts.filter(({data})=>data.draft!==true && !data.password);
assert.equal(posts.length,publishedSources.length,'公开文章数量应与当前内容源一致');
for (const {file,data,markdown} of publishedSources) {
  const post = posts.find(post=>post.source===path.relative(path.join(root,'content','posts'),file).split(path.sep).join('/'));
  assert(post,'正式文章应进入公开数据: '+file);
  assert.equal(post.id,data.id,'文章 id 应与当前内容源一致: '+file);
  assert.equal(post.markdown,markdown,'正文应与当前内容源一致: '+file);
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
const rss = fs.readFileSync(path.join(dist,'rss.xml'),'utf8');
assert.equal((rss.match(/<item>/g)||[]).length,posts.length);
for (const post of posts) assert(rss.includes(encodeURI(config.url+post.url)),'RSS 包含全部文章');
for (const file of walk(dist)) assert(!/^(?:content|migration|node_modules|output)\/|sample-posts\.json|encrypted-demo/.test(path.relative(dist,file)),'公开产物不得包含草稿或备份');
console.log(JSON.stringify({published:posts.length,categories:counts,staticPages:pages.length,internalLinks:checkedLinks,assetReferences:checkedAssets,sourceBodiesVerified:publishedSources.length,rssItems:posts.length},null,2));
