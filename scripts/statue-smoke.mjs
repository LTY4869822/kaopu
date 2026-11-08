import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

// No backend is started. Every /api request is mocked, and unexpected writes fail.
// WebGL runs the production shaders. preserveDrawingBuffer is enabled only in
// this harness so readPixels can establish that actual ASCII pixels were drawn.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results', 'statue');
const screenshots = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(output, {recursive: true});
fs.mkdirSync(screenshots, {recursive: true});
const report = {started: new Date().toISOString(), isolatedApi: true, checks: [], layouts: [], frames: {}, assets: [], httpFailures: [], pageErrors: [], consoleErrors: [], apiWrites: [], failures: []};
let vite, browser, activePage;
const fullBody = process.env.PORTRAIT_FULL_BODY === '1';

function instrumentWebGL({fallback = false} = {}) {
  const native = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(kind, options) {
    if (!['webgl', 'webgl2', 'experimental-webgl'].includes(kind)) return native.call(this, kind, options);
    if (fallback) return null;
    const gl = native.call(this, kind, {...options, preserveDrawingBuffer: true});
    if (!gl || this.__statueInstrumented) return gl;
    this.__statueInstrumented = true;
    const record = {canvas: this, gl, draws: 0, uniforms: {}, images: []};
    window.__statue = record;
    const locations = new Map();
    const getLocation = gl.getUniformLocation.bind(gl);
    gl.getUniformLocation = (program, name) => {const location = getLocation(program, name); locations.set(location, name); return location;};
    for (const method of ['uniform1f', 'uniform2f', 'uniform4f']) {
      const original = gl[method].bind(gl);
      gl[method] = (location, ...values) => {record.uniforms[locations.get(location)] = values.length === 1 ? values[0] : values; return original(location, ...values);};
    }
    const upload = gl.texImage2D.bind(gl);
    gl.texImage2D = (...args) => {
      const image = args.at(-1);
      if (image instanceof HTMLImageElement && !record.images.some(item => item.src === image.src)) record.images.push({src: image.src, width: image.naturalWidth, height: image.naturalHeight});
      return upload(...args);
    };
    const draw = gl.drawArrays.bind(gl);
    gl.drawArrays = (...args) => {const result = draw(...args); record.draws++; return result;};
    return gl;
  };
}

async function context(options = {}, fallback = false) {
  const value = await browser.newContext({viewport: {width:1440,height:900}, locale:'zh-CN', timezoneId:'Asia/Shanghai', ...options});
  await value.addInitScript(instrumentWebGL, {fallback});
  await value.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') report.apiWrites.push({method:request.method(), path:url.pathname});
    if (url.pathname === '/api/auth/status' && request.method() === 'GET') {
      await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify({authenticated:false, accountExists:true})});
    } else await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'API disabled by isolated statue smoke test'})});
  });
  return value;
}

async function open(value) {
  const page = activePage = await value.newPage();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => {if(message.type()==='error')report.consoleErrors.push(message.text());});
  page.on('response', response => {if (response.status() >= 400 && !response.url().includes('/api/')) report.httpFailures.push({url:response.url(),status:response.status()});});
  await page.goto(report.appUrl, {waitUntil:'networkidle'});
  await page.locator('.auth-page').waitFor();
  return page;
}

async function ready(page) {
  await page.locator('.confucius-portrait canvas').waitFor({state:'visible'});
  await page.waitForFunction(() => window.__statue?.draws > 0 && window.__statue?.images.length >= 2, null, {timeout:20000});
  assert.equal(await page.locator('.portrait-fallback').count(), 0, 'production WebGL must render, not fallback');
  await page.waitForFunction(() => window.__statue.uniforms.uReveal >= 0.9999 && window.__statue.uniforms.uIntroColor >= 0.9999, null, {timeout:30000});
}

async function frame(page, name) {
  const result = await page.evaluate(() => {
    const record = window.__statue, gl = record.gl, canvas = record.canvas;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let count = 0, colored = 0, sumR = 0, sumG = 0, sumB = 0, warmth = 0, hash = 2166136261;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let p = 0; p < pixels.length; p += 4) {
      if (pixels[p+3] < 20) continue;
      const x = (p / 4) % canvas.width, y = canvas.height - 1 - Math.floor(p / 4 / canvas.width);
      left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y);
      count++; sumR+=pixels[p]; sumG+=pixels[p+1]; sumB+=pixels[p+2]; warmth+=Math.abs(pixels[p]-pixels[p+1]);
      if (Math.max(pixels[p],pixels[p+1],pixels[p+2])-Math.min(pixels[p],pixels[p+1],pixels[p+2]) > 15) colored++;
      hash=Math.imul(hash ^ (pixels[p] + pixels[p+1]*257 + pixels[p+2]*65537 + p),16777619)>>>0;
    }
    return {draws:record.draws, uniforms:record.uniforms, width:canvas.width,height:canvas.height, pixels:count,colored, average:[sumR/count,sumG/count,sumB/count],warmth:warmth/count,hash,bounds:{left,top,right,bottom}};
  });
  assert.ok(result.pixels > 1000, `${name}: actual WebGL ASCII frame must contain visible glyph pixels`);
  report.frames[name] = result;
  return result;
}

async function examine(page, name, {fullBody = false, mobile = false} = {}) {
  const layoutCheck = (condition, message) => {if (!condition) report.failures.push(message);};
  const layout = await page.evaluate(async () => {
    const rect = node => {const r=node.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
    const record = window.__statue;
    const stage = rect(document.querySelector('.auth-portrait-stage'));
    let source;
    if(record?.images[0]) {
      const image = new Image(); image.src=record.images[0].src; await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const painter=canvas.getContext('2d');painter.drawImage(image,0,0);
      const pixels=painter.getImageData(0,0,canvas.width,canvas.height).data;
      let left=canvas.width,top=canvas.height,right=-1,bottom=-1,foreground=0,transparent=0;
      for(let p=0;p<pixels.length;p+=4){
        if(pixels[p+3]<10)transparent++;
        if(pixels[p+3]>30 && Math.max(pixels[p],pixels[p+1],pixels[p+2])>15){const x=(p/4)%canvas.width,y=Math.floor(p/4/canvas.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);foreground++;}
      }
      const bounds={left,top,right,bottom};
      const imageRect=record.uniforms.uImageRect;
      const [x,y,w,h]=imageRect;
      const subject={left:stage.left+(x+w*left/canvas.width)*stage.width,right:stage.left+(x+w*(right+1)/canvas.width)*stage.width,top:stage.top+(1-y-h+h*top/canvas.height)*stage.height,bottom:stage.top+(1-y-h+h*(bottom+1)/canvas.height)*stage.height};
      source={url:image.src,width:canvas.width,height:canvas.height,bounds,foreground,transparent,subject};
    }
    const heading=document.querySelector('.auth-hero-copy h1');
    const copy=document.querySelector('.auth-hero-copy');
    const fields=[...document.querySelectorAll('.auth-form input')].map(node=>({type:node.type,font:getComputedStyle(node).fontSize,...rect(node)}));
    return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,stage,source,heading:heading&&rect(heading),copy:copy&&rect(copy),footer:rect(document.querySelector('.auth-footer')),fields,canvasOpacity:getComputedStyle(document.querySelector('.auth-portrait-stage')).opacity};
  });
  report.layouts.push({name,...layout});
  layoutCheck(Math.max(layout.documentWidth,layout.bodyWidth)<=layout.width+1, `${name}: horizontal overflow`);
  for(const field of layout.fields){layoutCheck(field.left>=-1&&field.right<=layout.width+1,`${name}: form field outside viewport`);layoutCheck(field.width>=240,`${name}: form field too narrow`);layoutCheck(parseFloat(field.font)>=16,`${name}: mobile input font readability`);}
  if(fullBody){
    const {source}=layout;
    assert.ok(source,`${name}: source not uploaded to WebGL`);
    layoutCheck(source.transparent>source.width*source.height*.05,`${name}: statue asset must have a transparent surrounding`);
    layoutCheck(source.bounds.top>1&&source.bounds.bottom<source.height-2,`${name}: source head/feet silhouette touches image edge`);
    layoutCheck(source.subject.top>=55&&source.subject.bottom<=layout.height-25,`${name}: whole statue must fit within visible page`);
    layoutCheck(source.subject.left>=0&&source.subject.right<=layout.width,`${name}: whole statue must fit horizontally`);
    if(mobile&&layout.heading) layoutCheck(source.subject.bottom<=layout.heading.top-5,`${name}: statue feet overlap heading`);
    if(!mobile) layoutCheck(source.subject.bottom<=layout.footer.top-5,`${name}: statue feet overlap footer controls`);
  }
  return layout;
}

async function shot(page, name) {await page.screenshot({path:path.join(screenshots,`statue-${name}.png`),fullPage:true});}

try {
  if(process.env.UI_TEST_URL)report.appUrl=process.env.UI_TEST_URL;
  else {const {createServer}=await import('vite');vite=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});await vite.listen();report.appUrl=`http://127.0.0.1:${vite.httpServer.address().port}`;}
  const executablePath=[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,chromium.executablePath(),...['1228','1223'].map(version=>path.join(os.homedir(),'AppData','Local','ms-playwright',`chromium-${version}`,'chrome-win64','chrome.exe'))].find(candidate=>candidate&&fs.existsSync(candidate));
  assert.ok(executablePath,'Install Chromium with npx playwright install chromium');
  browser=await chromium.launch({headless:true,executablePath,args:['--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
  const desktop=await context({reducedMotion:'no-preference'});
  let page=await open(desktop);await ready(page);
  const orange=await frame(page,'desktop-orange');
  report.assets=await page.evaluate(()=>window.__statue.images);
  assert.equal(report.assets.length,2,'portrait and depth textures must both load');
  if (!fullBody) assert.ok(report.assets[0].src.endsWith('/sites/good-fella-com-0c318826/root-8a5edab2/confucius-sculpture.png'), 'the original face close-up must be restored');
  assert.equal(report.assets[0].width,report.assets[1].width,'depth width matches source');assert.equal(report.assets[0].height,report.assets[1].height,'depth height matches source');
  await examine(page,'1440 intro',{fullBody});await shot(page,'desktop');
  report.checks.push('desktop: portrait and matching depth load into real WebGL; visible ASCII portrait glyphs render');
  const box=await page.locator('.confucius-portrait').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.35);
  await page.waitForFunction(()=>window.__statue.uniforms.uHover>.8);
  const hover=await frame(page,'desktop-hover');
  assert.notEqual(orange.hash,hover.hash,'hover must change actual rendered pixels');
  assert.ok(hover.uniforms.uParallax.some(value=>Math.abs(value)>.001),'hover must engage depth parallax');await shot(page,'hover');
  await page.mouse.move(5,80);await page.waitForFunction(()=>window.__statue.uniforms.uHover<.01);
  await page.locator('.confucius-portrait canvas').click({position:{x:box.width*.5,y:box.height*.35}});
  await page.mouse.move(5,80);await page.waitForFunction(()=>window.__statue.uniforms.uSourceMode===1&&window.__statue.uniforms.uSweep===-1,null,{timeout:20000});
  const silver=await frame(page,'desktop-silver');
  assert.notEqual(orange.hash,silver.hash,'click must change actual rendered pixels');
  assert.ok(silver.warmth<orange.warmth*.7,'click must visibly switch orange glyphs to stone source colors');await shot(page,'silver');
  report.checks.push('desktop: hover changes glyph pixels and depth parallax; click completes orange-to-stone color sweep');
  await page.getByRole('button',{name:'暂停动效',exact:true}).click();
  const paused=await frame(page,'paused');await page.mouse.move(box.x+box.width*.65,box.y+box.height*.5);await page.waitForTimeout(450);
  const pausedAfter=await frame(page,'paused-after-pointer');assert.equal(paused.hash,pausedAfter.hash,'paused pixels must remain stable on pointermove');assert.equal(paused.draws,pausedAfter.draws,'paused WebGL must stop drawing');
  assert.equal(await page.getByRole('button',{name:'开启动效',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'开启动效',exact:true}).click();await page.mouse.move(box.x+box.width*.4,box.y+box.height*.45);await page.waitForFunction(()=>window.__statue.uniforms.uHover>.5);
  report.checks.push('pause: pointer movement leaves actual pixels and draw count unchanged; resume restores hover');
  await page.locator('.auth-primary').click();await page.locator('.auth-form').waitFor();await examine(page,'1440 login');await shot(page,'login-desktop');
  await page.locator('.auth-nav-action').click();await page.locator('.auth-form').waitFor();await examine(page,'1440 registration');await shot(page,'register-desktop');
  await desktop.close();

  const reduced=await context({reducedMotion:'reduce'});page=await open(reduced);await ready(page);
  const reducedFrame=await frame(page,'reduced-motion');const reducedBox=await page.locator('.confucius-portrait').boundingBox();await page.mouse.move(reducedBox.x+reducedBox.width*.5,reducedBox.y+reducedBox.height*.3);await page.waitForTimeout(350);const reducedAfter=await frame(page,'reduced-after-pointer');
  assert.equal(reducedFrame.hash,reducedAfter.hash);assert.equal(reducedAfter.uniforms.uHover,0);assert.deepEqual(reducedAfter.uniforms.uParallax,[0,0]);assert.equal(reducedFrame.draws,reducedAfter.draws);
  await page.getByRole('button',{name:'切换肖像色彩',exact:true}).click();const reducedClick=await frame(page,'reduced-click');assert.notEqual(reducedClick.hash,reducedFrame.hash);assert.equal(reducedClick.uniforms.uSweep,-1);await shot(page,'reduced-motion');
  report.checks.push('reduced motion: static real WebGL frame, no hover/depth/animation; color button switches immediately');await reduced.close();

  const compact=await context({viewport:{width:1024,height:768},reducedMotion:'reduce'});page=await open(compact);await ready(page);await frame(page,'1024-intro');await examine(page,'1024 intro',{fullBody});await shot(page,'compact-desktop');await page.locator('.auth-primary').click();await page.locator('.auth-form').waitFor();await examine(page,'1024 login');await shot(page,'login-1024');await compact.close();
  report.checks.push('1024px compact desktop: restored portrait and readable login layout');

  for(const viewport of [{width:390,height:844},{width:320,height:740},{width:768,height:1024}]){
    const mobile=await context({viewport,reducedMotion:'reduce',isMobile:true,hasTouch:true});page=await open(mobile);await ready(page);await frame(page,`${viewport.width}-intro`);await examine(page,`${viewport.width} intro`,{fullBody,mobile:true});await shot(page,`mobile-${viewport.width}`);
    await page.locator('.auth-primary').click();await page.locator('.auth-form').waitFor();await examine(page,`${viewport.width} login`);await shot(page,`login-${viewport.width}`);
    await page.locator('.auth-nav-action').click();await page.locator('.auth-form').waitFor();await examine(page,`${viewport.width} registration`);await shot(page,`register-${viewport.width}`);await mobile.close();
  }
  report.checks.push('390/320/768px mobile: restored face composition, no horizontal overflow; login and registration inputs readable');
  const fallback=await context({reducedMotion:'reduce'},true);page=await open(fallback);await page.locator('.portrait-fallback').waitFor({state:'visible'});assert.equal(await page.locator('.confucius-portrait canvas').isVisible(),false);assert.ok(await page.locator('.portrait-fallback').evaluate(image=>image.complete&&image.naturalWidth>0));await shot(page,'fallback');await fallback.close();report.checks.push('fallback: blocked WebGL displays loaded source portrait');
  assert.deepEqual(report.httpFailures,[],'no failed static asset requests');assert.deepEqual(report.pageErrors,[],'no browser page errors');assert.deepEqual(report.consoleErrors,[],'no browser console errors');assert.deepEqual(report.apiWrites,[],'test must not attempt account writes');assert.deepEqual(report.failures,[],'layout and silhouette checks');report.passed=true;
  console.log(`Statue smoke passed: ${report.checks.length} groups, ${report.layouts.length} layouts, ${Object.keys(report.frames).length} real WebGL frame checks.`);
} catch(error){report.passed=false;report.failures.push(error.stack||error.message);console.error(error.stack||error.message);process.exitCode=1;if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});}
finally {report.finished=new Date().toISOString();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await vite?.close();}
