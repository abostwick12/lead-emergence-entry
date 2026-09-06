import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
const results=[];
for (const mobile of [false,true]) {
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
  const page=await context.newPage(); const cdp=await context.newCDPSession(page); const system=await browser.newBrowserCDPSession();
  await cdp.send('Performance.enable'); await cdp.send('Network.enable');
  if(mobile){await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:1.6*1024*1024/8,uploadThroughput:750*1024/8});}
  await page.addInitScript(()=>{window.__landingMetrics={lcp:0,longTasks:[]};new PerformanceObserver(list=>{window.__landingMetrics.lcp=list.getEntries().at(-1).startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(list=>{window.__landingMetrics.longTasks.push(...list.getEntries().map(entry=>entry.duration));}).observe({type:'longtask',buffered:true});});
  const media=[];page.on('request',request=>{if(request.url().includes('.mp4'))media.push(request.url());});
  await page.goto(process.env.FRONTDOOR_URL??'http://localhost:3109',{waitUntil:'networkidle'});
  await page.screenshot({path: 'test-results/performance-' + (mobile?'mobile':'desktop') + '.png'}); await page.waitForTimeout(500);
  const initial=await page.evaluate(()=>({lcpMs:window.__landingMetrics.lcp,initialEncodedBytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.encodedBodySize,0)+performance.getEntriesByType('navigation')[0].encodedBodySize,resourceCount:performance.getEntriesByType('resource').length,longTasks:window.__landingMetrics.longTasks,overflow:document.documentElement.scrollWidth>innerWidth}));
  initial.videoRequests=media.length;
  await page.evaluate(()=>scrollTo(0,80));
  if (!mobile) { await page.locator('video[aria-hidden="true"]').waitFor();await page.waitForFunction(()=>document.querySelector('video[aria-hidden="true"]')?.readyState>=2,{},{timeout:60000}); }
  const before=await cdp.send('Performance.getMetrics');const gpuBefore=(await system.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='GPU').reduce((n,p)=>n+p.cpuTime,0);
  const started=Date.now();
  const distance=await page.locator('section[aria-labelledby="hero-title"]').evaluate(element=>element.getBoundingClientRect().height-innerHeight);
  for(let i=1;i<=24;i++){await page.evaluate(y=>scrollTo(0,y),distance*i/24);await page.waitForTimeout(100);}
  const elapsed=(Date.now()-started)/1000;const after=await cdp.send('Performance.getMetrics');const gpuAfter=(await system.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='GPU').reduce((n,p)=>n+p.cpuTime,0);
  const delta=name=>(after.metrics.find(item=>item.name===name)?.value??0)-(before.metrics.find(item=>item.name===name)?.value??0);
  results.push({profile:mobile?'390px mobile emulation; 4x CPU slowdown; 1.6 Mbps; 100ms RTT':'1440px desktop; unthrottled loopback',...initial,scroll:{elapsedSeconds:elapsed,mainThreadTaskSeconds:delta('TaskDuration'),scriptSeconds:delta('ScriptDuration'),layoutSeconds:delta('LayoutDuration'),mainThreadBusyFraction:delta('TaskDuration')/elapsed,gpuProcessCpuSeconds:gpuAfter-gpuBefore,hardwareGpuUtilization:'Not exposed by this headless test; GPU-process CPU time is not GPU utilization.'},videoRequestsAfterScroll:media.length});
  await browser.close();
}
await fs.mkdir('docs',{recursive:true});await fs.writeFile('docs/frontdoor-performance.json',JSON.stringify({measuredAt:new Date().toISOString(),environment:'Local production build in headless Chrome on Windows. Synthetic lab measurements, not field or physical-device results.',results},null,2)+'\n');console.log(JSON.stringify(results));
