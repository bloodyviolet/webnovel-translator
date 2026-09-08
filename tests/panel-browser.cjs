// Real Chromium layout/input regression. Chrome messaging and inference are simulated.
// CHROMIUM_EXECUTABLE=/path/to/chromium node tests/panel-browser.cjs
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
 const server = http.createServer((req,res) => {
  if(req.url === '/panel.css') return setTimeout(()=>{res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(root,'panel.css')));},120);
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body style="margin:0;min-height:3000px"><article id="source" style="width:700px;height:1400px;margin:40px"><p>'+ 'A source sentence about the mountain and the sword. '.repeat(30)+'</p></article></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 let browser;
 try {
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE || undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // First prove the CSS defect independently of extension APIs.
 await page.goto(base);
 const broken=await page.evaluate(()=>{const host=document.createElement('div');document.documentElement.append(host);host.style.cssText='all:initial!important;position:fixed!important;right:12px!important;bottom:12px!important;display:block!important;';host.innerHTML='<div style="width:400px;height:300px"></div>';host.style.left='50px';host.style.top='60px';host.style.right='auto';host.style.bottom='auto';const rect=host.getBoundingClientRect();return {left:rect.left,top:rect.top};});
 assert.ok(broken.top>800,'Old normal-priority insets put host below the viewport');console.log('Reproduced old CSS failure:',broken);
 let prefs={left:5000,top:5000,width:2000,height:1000,fontSize:22};const calls=[];let visible=true;let job;
 await page.exposeFunction('bridge',async msg=>{
  calls.push(msg.type);
  if(msg.type==='SITE_STATE')return {ok:true,visible,story:'127.0.0.1/story',settings:{mode:'general',auto:false},modes:[{id:'general',label:'General'}],targetLang:'English',selector:'#source'};
  if(msg.type==='PANEL_PREFS_GET'){await new Promise(r=>setTimeout(r,200));return {ok:true,prefs};}
  if(msg.type==='PANEL_PREFS_SAVE'){prefs=msg.patch.reset?null:{...prefs,...msg.patch};return {ok:true};}
  if(msg.type==='JOB_START'){job={id:'job-1',status:'done',completed:msg.paragraphs.length,units:msg.paragraphs.map((text,paragraph)=>({text,paragraph})),results:msg.paragraphs.map(()=> 'Translated text. '.repeat(80))};return {ok:true,job};}
  if(msg.type==='JOB_GET')return {ok:true,job};
  if(msg.type==='SITE_HIDE'){visible=false;return {ok:true};}
  return {ok:true};
 });
 async function load(){
  await page.goto(base+'/novel/story');
  await page.evaluate(base=>{const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(o){const r=attach.call(this,o);if(this.dataset.wntUi==='reader')window.testShadow=r;return r;};window.chrome={runtime:{getURL:p=>base+'/'+p,sendMessage:msg=>window.bridge(msg),onMessage:{addListener(fn){window.notify=fn;}}}};},base);
  for(const file of ['shared.js','extract.js','content.js'])await page.addScriptTag({path:path.join(root,file)});
  await page.waitForFunction(()=>{const h=document.querySelector('[data-wnt-ui="reader"]');return h&&getComputedStyle(h).visibility==='visible';});
  await page.waitForTimeout(100);
 }
 async function bounds(){return page.evaluate(()=>{const r=testShadow.getElementById('panel').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight};});}
 async function fits(){const b=await bounds();assert.ok(b.x>=-1&&b.y>=-1&&b.x+b.w<=b.vw+1&&b.y+b.h<=b.vh+1,JSON.stringify(b));return b;}
 async function click(id){await page.evaluate(id=>testShadow.getElementById(id).click(),id);}
 await load();await fits();assert.equal(prefs.geometryVersion,2);console.log('PASS old oversized preferences migrate and stay visible after CSS load');
 await click('resetView');await page.waitForTimeout(80);await fits();assert.equal(prefs,null);
 const before=await page.evaluate(()=>document.querySelector('#source').innerHTML);
 const header=await page.evaluate(()=>{const r=testShadow.querySelector('header strong').getBoundingClientRect();return {x:r.x+20,y:r.y+12};});
 await page.mouse.move(header.x,header.y);await page.mouse.down();await page.mouse.move(110,90,{steps:5});await page.mouse.up();await page.waitForTimeout(80);await fits();assert.ok(prefs.left<200);console.log('PASS drag before completion saves real coordinates');
 await click('translate');await page.waitForFunction(()=>testShadow.getElementById('status').textContent.startsWith('done:'));await page.waitForTimeout(80);
 const completed=await fits();assert.equal(Math.round(completed.w),700);assert.equal(Math.round(completed.h),776);assert.equal(await page.evaluate(()=>document.querySelector('#source').innerHTML),before);console.log('PASS completion fits chosen source with viewport clamp and preserves source HTML');
 const h2=await page.evaluate(()=>{const r=testShadow.querySelector('header strong').getBoundingClientRect();return {x:r.x+20,y:r.y+12};});
 await page.mouse.move(h2.x,h2.y);await page.mouse.down();await page.mouse.move(1250,780,{steps:5});await page.mouse.up();await fits();
 await page.evaluate(()=>{const f=testShadow.getElementById('fontSize');f.value='26';f.dispatchEvent(new Event('change'));});await page.waitForTimeout(80);assert.equal(prefs.fontSize,26);
 await page.setViewportSize({width:360,height:420});await page.waitForTimeout(150);await fits();assert.ok(await page.evaluate(()=>testShadow.getElementById('reader').clientHeight>=80));console.log('PASS drag after completion, font selection and narrow viewport');
 await click('min');await page.waitForTimeout(80);await fits();assert.ok((await bounds()).h<100);await click('min');await page.waitForTimeout(80);await fits();
 await load();await fits();assert.equal(await page.evaluate(()=>getComputedStyle(testShadow.getElementById('reader')).fontSize),'26px');console.log('PASS minimize/restore and reload preserve font and usable geometry');
 await click('resetView');await page.waitForTimeout(80);await fits();assert.equal(prefs,null);assert.equal(calls.includes('SITE_HIDE'),false);assert.equal(errors.length,0,errors.join('\n'));
 await page.screenshot({path:path.join(process.env.WNT_QA_OUTPUT || '/tmp','wnt-reader-2.1.7.png')});
 console.log('PASS Reset view, no accidental site-hide request, no uncaught browser errors');
 } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
