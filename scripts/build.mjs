import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {parseHTML,DOMParser} from 'linkedom';
import {root,config,compile} from './content.mjs';

const require = createRequire(import.meta.url);
const marked = require(path.join(root,'assets/marked.min.js'));
const posts = compile();
const output = path.join(root,'dist');
fs.mkdirSync(output,{recursive:true});
// Only generated public files belong here. Source drafts and migration backups never enter dist.
for (const entry of fs.readdirSync(output)) fs.rmSync(path.join(output,entry),{recursive:true,force:true});
fs.copyFileSync(path.join(root,'node_modules/@mermaid-js/tiny/dist/mermaid.tiny.js'),path.join(root,'assets/mermaid.min.js'));
for (const file of ['app.js','music.js','style.css']) fs.copyFileSync(path.join(root,file),path.join(output,file));
fs.cpSync(path.join(root,'assets'),path.join(output,'assets'),{recursive:true});
const original = fs.readFileSync(path.join(root,'index.html'),'utf8');
const template = original.replace('data-routing="hash"','data-routing="path"').replaceAll('src="assets/','src="/assets/').replaceAll('href="assets/','href="/assets/').replace('href="style.css"','href="/style.css"').replace('src="music.js"','src="/music.js"').replace('src="app.js"','src="/app.js"');
const app = fs.readFileSync(path.join(root,'app.js'),'utf8');
const sources = ['assets/posts.js','assets/music/tracks.js','music.js'].map(file=>[file,fs.readFileSync(path.join(root,file),'utf8')]);
const categories = [...new Set(posts.map(p=>p.category))];
const tags = [...new Set(posts.flatMap(p=>p.tags))];
const routes = ['/', '/articles/', '/topics/', '/archive/', '/gallery/', '/about/', ...posts.map(p=>p.url), ...categories.map(c=>'/categories/'+encodeURIComponent(c)+'/'), ...tags.map(t=>'/tags/'+encodeURIComponent(t)+'/')];
export function render(urlPath) {
  const {window,document} = parseHTML(template);
  const location = new URL('https://aron.xin'+urlPath);
  const history = {state:null,replaceState(){},pushState(){},scrollRestoration:'manual'};
  window.__PRERENDER__=true;
  window.scrollTo=()=>{};
  window.location=location;
  window.matchMedia=()=>({matches:true});
  const audio = document.querySelector('#blog-audio'); audio.paused=true;audio.currentTime=0;
  const context = vm.createContext({window,document,location,history,marked,DOMParser,URL,URLSearchParams,console,setTimeout,clearTimeout,matchMedia:window.matchMedia,localStorage:{getItem(){return null;},setItem(){}},innerHeight:900,scrollY:0});
  for (const [name,code] of sources) vm.runInContext(code,context,{filename:name});
  context.BlogMusic = window.BlogMusic;
  vm.runInContext(app,context,{filename:'app.js'});
  document.body.classList.add('prerendered');
  // Keep the actual shell and prerendered content; JS adds search, music, filters and transitions.
  const noscript = document.createElement('noscript');
  noscript.innerHTML='<p class="noscript-note">当前以静态模式阅读。搜索、音乐和图片查看需要启用 JavaScript。</p>';
  document.querySelector('footer').prepend(noscript);
  return '<!DOCTYPE html>\n'+document.documentElement.outerHTML;
}
for (const route of [...routes,'/404/']) {
  const file = route === '/404/' ? path.join(output,'404.html') : path.join(output,decodeURIComponent(route),'index.html');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,render(route));
}
const xml = value=>String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const absolute = route=>config.url+encodeURI(decodeURI(route));
const latest = posts.reduce((max,p)=>p.updated>max?p.updated:max,posts[0].date);
const sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+routes.map(route=>'<url><loc>'+xml(absolute(route))+'</loc><lastmod>'+(posts.find(p=>p.url===route)?.updated||latest)+'</lastmod></url>').join('')+'</urlset>\n';
fs.writeFileSync(path.join(output,'sitemap.xml'),sitemap);
fs.writeFileSync(path.join(output,'sitemap-0.xml'),sitemap);
fs.writeFileSync(path.join(output,'sitemap-index.xml'),'<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>'+xml(config.url+'/sitemap.xml')+'</loc></sitemap></sitemapindex>\n');
fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nAllow: /\nSitemap: '+config.url+'/sitemap.xml\n');
fs.writeFileSync(path.join(output,'rss.xml'),'<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>'+xml(config.author+' 的'+config.name)+'</title><link>'+xml(config.url+'/')+'</link><description>'+xml(config.description)+'</description><language>zh-CN</language><atom:link href="'+xml(config.url+'/rss.xml')+'" rel="self" type="application/rss+xml"/>'+posts.map(p=>'<item><title>'+xml(p.title)+'</title><link>'+xml(absolute(p.url))+'</link><guid isPermaLink="true">'+xml(absolute(p.url))+'</guid><pubDate>'+new Date(p.date+'T00:00:00+08:00').toUTCString()+'</pubDate><description>'+xml(p.desc)+'</description><category>'+xml(p.category)+'</category></item>').join('')+'</channel></rss>\n');
// Native static hosting can serve this status page; no all-path SPA fallback is needed.
fs.writeFileSync(path.join(output,'_redirects'),'/index.html / 301\n');
console.log(`已生成 ${posts.length} 篇文章、${categories.length} 个分类、${tags.length} 个标签，共 ${routes.length} 个独立页面。正式域名：${config.url}`);
