import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const filmDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(filmDir, '..');
const localDir = resolve(projectDir, '.film-local');
mkdirSync(localDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: resolve(filmDir,'src/index.tsx'), publicDir: resolve(projectDir,'public'), outDir: resolve(localDir,'bundle') });
const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const variants = [ ['Hero-Desktop','lead-emergence-hero.mp4'], ['Hero-Mobile','lead-emergence-hero-mobile.mp4'], ['Brand-Film','lead-emergence-seven-stages.mp4'] ];
const evidence = [];
for (const [id, filename] of variants) {
  const composition = await selectComposition({ serveUrl, id, browserExecutable });
  let lastQuarter = -1;
  const outputLocation = resolve(projectDir,'public/film',filename);
  await renderMedia({ composition, serveUrl, codec:'h264', outputLocation, browserExecutable, concurrency:2, crf:25, pixelFormat:'yuv420p',
    ffmpegOverride: ({ args }) => [...args.slice(0,-1),'-g','24','-movflags','+faststart',args.at(-1)],
    onProgress: ({ progress }) => { const quarter=Math.floor(progress*4); if(quarter!==lastQuarter){lastQuarter=quarter;console.log(id+': '+Math.round(progress*100)+'%');} }
  });
  evidence.push({ id, file:'public/film/'+filename, bytes:statSync(outputLocation).size, width:composition.width, height:composition.height, fps:composition.fps, seconds:composition.durationInFrames/composition.fps });
  if(id==='Brand-Film') for(let stage=0;stage<7;stage++) await renderStill({ composition, serveUrl, output:resolve(localDir,'stage-'+(stage+1)+'.png'), frame:stage*144+70, browserExecutable });
}
writeFileSync(resolve(filmDir,'render-evidence.json'),JSON.stringify({ renderedAt:new Date().toISOString(),renderer:'Remotion 4.0.521',source:'Generated illustrative keyframes; no claim of captured live-action footage',variants:evidence },null,2)+'\n');
console.log(JSON.stringify(evidence));
