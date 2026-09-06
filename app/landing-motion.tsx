'use client';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './landing-experience.module.css';

type Stage = { name: string; short: string; phrase: string };
export function HeroSequence({ stages }: { stages: readonly Stage[] }) {
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const filmDialog = useRef<HTMLDialogElement>(null);
  const progress = useRef(0);
  const failed = useRef(false);
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string>();
  const [ready, setReady] = useState(false);
  const [watching, setWatching] = useState(false);
  const syncVideo = useCallback(() => {
    const element = video.current;
    if (paused || !element || element.seeking || !Number.isFinite(element.duration)) return;
    const target = Math.min(element.duration - .05, progress.current * element.duration);
    if (Math.abs(element.currentTime - target) > .09) element.currentTime = target;
  }, [paused]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    let frame = 0;
    function update() {
      frame = 0;
      if (!root.current) return;
      if (media.matches) {
        setVideoSrc(undefined); setReady(false); setStage(0);
        root.current.style.setProperty('--hero-progress', '0');
        return;
      }
      if (paused) return;
      const bounds = root.current.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
      progress.current = Math.min(1, Math.max(0, -bounds.top / Math.max(1, bounds.height - window.innerHeight)));
      root.current.style.setProperty('--hero-progress', String(progress.current));
      setStage(Math.min(stages.length - 1, Math.floor(progress.current * stages.length)));
      // Intentional scroll only. Reduced motion, data saving and skipped heroes keep the poster.
      if (progress.current > .01 && window.innerWidth > 760 && !saveData && !failed.current) {
        setVideoSrc((current) => current ?? '/film/lead-emergence-hero.mp4');
      }
      syncVideo();
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    media.addEventListener('change', schedule);
    schedule();
    return () => { window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); media.removeEventListener('change', schedule); cancelAnimationFrame(frame); };
  }, [paused, stages.length, syncVideo]);
  function closeFilm() { setWatching(false); }
  return <section ref={root} className={styles.heroSequence} data-paused={paused} aria-labelledby="hero-title">
    <div className={styles.heroPinned}>
      <div className={styles.heroImage}><Image src="/brand/leader-dusk.webp" alt="" fill sizes="100vw" preload /></div>
      {videoSrc ? <video ref={video} className={styles.heroVideo} data-ready={ready} src={videoSrc} muted playsInline preload="auto" aria-hidden="true" tabIndex={-1} onLoadedMetadata={syncVideo} onLoadedData={() => { setReady(true); syncVideo(); }} onSeeked={syncVideo} onError={() => { failed.current = true; setReady(false); setVideoSrc(undefined); }} /> : null}
      <div className={styles.heroShade} />
      <div className={styles.heroContent}><p className={styles.stageName}>{String(stage + 1).padStart(2,'0')} <span aria-hidden="true">—</span> {stages[stage].name}</p><h1 id="hero-title">Before you decide<br />what to do,</h1><p className={styles.heroLine}>you have to see what is actually here.</p><p className={styles.stagePhrase}>{stages[stage].phrase}</p></div>
      <div className={styles.heroBottom}><div className={styles.motionControls}><a href="#leader">Scroll into the work <span aria-hidden="true">↓</span></a><div><button className={styles.watchFilm} onClick={() => { setWatching(true); filmDialog.current?.showModal(); }}>Watch the film <span aria-hidden="true">↗</span></button><button className={styles.pauseMotion} onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? 'Resume visual motion' : 'Pause visual motion'}</button></div></div>
        <ol className={styles.stageLine} aria-label="The seven-stage Lead Emergence progression">{stages.map((item,index)=><li key={item.name} data-current={stage===index}><span className={styles.stageDot} aria-hidden="true"/><span aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span className={styles.stageFull}>{item.name}: {item.phrase}</span></li>)}</ol>
      </div>
    </div>
    <dialog ref={filmDialog} className={styles.filmDialog} aria-labelledby="film-title" onClose={closeFilm}><div><h2 id="film-title">Lead Emergence — See again</h2><button onClick={() => filmDialog.current?.close()} autoFocus>Close film</button></div>{watching ? <video controls autoPlay playsInline preload="metadata" src="/film/lead-emergence-seven-stages.mp4" aria-label="Silent seven-stage Lead Emergence brand film" /> : null}<p>A silent, 42-second visual journey. All seven stages are also available as text on this page.</p></dialog>
  </section>;
}

export function ConversationExample() {
  const [interfaceName, setInterfaceName] = useState<'Workspace'|'ChatGPT'>('Workspace');
  const [required, setRequired] = useState(false);
  const [prepared, setPrepared] = useState(false);
  return <div className={styles.exampleArea}>
    <div className={styles.interfaceSwitch} aria-label="Illustrated conversation interface">{(['Workspace','ChatGPT'] as const).map((label)=><button key={label} aria-pressed={interfaceName===label} onClick={()=>setInterfaceName(label)}>{label}</button>)}</div>
    <article className={styles.example} data-interface={interfaceName} aria-label="Fictional SOTF Bundle decision example">
      <header><span className={styles.conversationGlyph} aria-hidden="true">{interfaceName==='Workspace'?'↗':'◎'}</span><span>{interfaceName==='Workspace'?'Lead Emergence Workspace':'ChatGPT · SOTF Bundle'}<small>Fictional example · no account data</small></span><span className={styles.connectedDot} aria-hidden="true" /></header>
      <div className={styles.you}><small>You</small><p>This program role looks like a strong match. Should I pursue it?</p></div>
      <div className={styles.response}><small>SOTF Bundle</small><p>Your delivery experience fits. The question is whether the work gives you the <em>decision ownership</em> you said you wanted.</p><p>A practitioner describes coordination responsibility while functional leaders keep final authority. That is a question to resolve before investing more time.</p></div>
      <div className={styles.contextReview}><label><input type="checkbox" checked={required} onChange={(event)=>setRequired(event.target.checked)} />In this example, decision ownership is non-negotiable.</label><div className={styles.exampleDecision} data-recommendation={required?'NO':'MAYBE'}><strong>{required?'NO':'MAYBE'}</strong><p>{required?'The role conflicts with your confirmed non-negotiable. Pause pursuit unless the evidence changes.':'Strong experience is not enough to settle fit. Ask which decisions this person would actually own.'}</p></div><p className={styles.caption}>Same role. Same experience. Your confirmed criterion changes the decision.</p></div>
      <button className={styles.exampleAction} onClick={()=>setPrepared(!prepared)} aria-expanded={prepared}>{prepared?'Return to the decision':'Prepare the useful conversation'} <span aria-hidden="true">→</span></button>
      {prepared?<div className={styles.prepared}><small>For Morgan · fictional practitioner</small><p>“Which consequential decisions did a program lead make last month? Which required someone else’s approval?”</p><p className={styles.caption}>After the conversation: review the evidence, keep the follow-up promise, and revisit the decision. An outreach draft never means a message was sent.</p></div>:null}
      <footer><span>Decision → conversation → evidence → next move</span></footer>
    </article><p className={styles.caption}>Conversation helps you think. Workspace keeps the reviewed work connected.</p>
  </div>;
}
