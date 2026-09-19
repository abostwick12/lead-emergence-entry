'use client';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './landing-experience.module.css';

type Stage = { name: string; short: string; philosophy: string; description: string };
export function HeroSequence({ stages }: { stages: readonly Stage[] }) {
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const failed = useRef(false);
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string>();
  const [ready, setReady] = useState(false);
  const syncStage = useCallback(() => {
    const element = video.current;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
    setStage(Math.min(stages.length - 1, Math.floor((element.currentTime / element.duration) * stages.length)));
  }, [stages.length]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    function updateSource() {
      const canUseMotion = !media.matches && !saveData && !failed.current;
      setVideoSrc(canUseMotion ? window.innerWidth > 760 ? '/film/lead-emergence-hero.mp4' : '/film/lead-emergence-hero-mobile.mp4' : undefined);
      setReady(false);
      if (!canUseMotion) setStage(0);
    }
    media.addEventListener('change', updateSource);
    window.addEventListener('resize', updateSource);
    updateSource();
    return () => { media.removeEventListener('change', updateSource); window.removeEventListener('resize', updateSource); };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element || !ready) return;
    if (paused) element.pause();
    else void element.play().catch(() => undefined);
  }, [paused, ready, videoSrc]);
  return <section ref={root} className={styles.heroSequence} data-paused={paused} aria-labelledby="hero-title">
    <div className={styles.heroPinned}>
      <div className={styles.heroImage}><Image src="/brand/leader-dusk.webp" alt="" fill sizes="100vw" preload /></div>
      {videoSrc ? <video ref={video} className={styles.heroVideo} data-ready={ready} src={videoSrc} muted loop autoPlay playsInline preload="metadata" aria-hidden="true" tabIndex={-1} onLoadedMetadata={syncStage} onCanPlay={() => { setReady(true); syncStage(); }} onTimeUpdate={syncStage} onError={() => { failed.current = true; setReady(false); setVideoSrc(undefined); setStage(0); }} /> : null}
      <div className={styles.heroShade} />
      <div className={styles.heroContent}><p className={styles.stageName}>{String(stage + 1).padStart(2,'0')} <span aria-hidden="true">—</span> {stages[stage].name}</p><h1 id="hero-title">{stages[stage].philosophy}</h1><p className={styles.heroDescription} data-hero-description>{stages[stage].description}</p></div>
      <div className={styles.heroBottom}><div className={styles.motionControls}><a href="#leader">Scroll into the work <span aria-hidden="true">↓</span></a><button className={styles.pauseMotion} onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? 'Resume visual motion' : 'Pause visual motion'}</button></div>
        <ol className={styles.stageLine} aria-label="The seven-stage Lead Emergence progression">{stages.map((item,index)=><li key={item.name} data-current={stage===index}><span className={styles.stageDot} aria-hidden="true"/><span aria-hidden="true">{String(index+1).padStart(2,'0')}</span><span className={styles.stageFull}>{item.name}: {item.philosophy} {item.description}</span></li>)}</ol>
      </div>
    </div>
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
