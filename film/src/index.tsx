import { AbsoluteFill, Composition, Img, interpolate, registerRoot, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { FC } from 'react';

const FPS = 24;
const STAGE_FRAMES = 6 * FPS;
const stages = [
  { label: 'SEE REALITY', title: 'Before the next move,\nsee what is here.', image: 'leader-dusk.webp', scale: [1, 1.035], focus: '63% 44%' },
  { label: 'REFRAME REALITY', title: 'A different view\nchanges the question.', image: 'reframe.webp', scale: [1.09, 1.025], focus: '65% 65%' },
  { label: 'ALIGN WITH REALITY', title: 'Find what can\nmove together.', image: 'alignment.webp', scale: [1.035, 1.065], focus: '65% 48%' },
  { label: 'BUILD CAPABILITY', title: 'Give clarity\na way to move.', image: 'reframe.webp', scale: [1.19, 1.09], focus: '72% 75%' },
  { label: 'PRODUCE VALUE', title: 'Let the work change\nsomething real.', image: 'alignment.webp', scale: [1.11, 1.015], focus: '66% 55%' },
  { label: 'NEW REALITY', title: 'Stand somewhere\nnew.', image: 'new-reality.webp', scale: [1.055, 1], focus: '66% 47%' },
  { label: 'SEE AGAIN', title: 'From here,\nsee again.', image: 'new-reality.webp', scale: [1, 1.025], focus: '61% 51%' },
] as const;

const BrandFilm: FC<{ titles: boolean }> = ({ titles }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const portrait = height > width;
  const stageIndex = Math.min(6, Math.floor(frame / STAGE_FRAMES));
  const localFrame = frame % STAGE_FRAMES;
  const progress = frame / (durationInFrames - 1);
  const titleOpacity = interpolate(localFrame, [0, 22, STAGE_FRAMES - 28, STAGE_FRAMES - 1], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cyan = stageIndex > 4 ? '#b9d1ca' : '#8ad2dd';
  return <AbsoluteFill style={{ backgroundColor: '#05101a', overflow: 'hidden' }}>
    {stages.map((stage, index) => {
      const start = index * STAGE_FRAMES;
      const sceneFrame = frame - start;
      if (sceneFrame < -24 || sceneFrame > STAGE_FRAMES + 24) return null;
      const opacity = index === 0 && frame < STAGE_FRAMES - 24 ? 1 : interpolate(sceneFrame, [-24, 20, STAGE_FRAMES - 24, STAGE_FRAMES + 20], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      const scale = interpolate(sceneFrame, [0, STAGE_FRAMES], [...stage.scale], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      return <AbsoluteFill key={stage.label} style={{ opacity }}><Img src={staticFile('brand/' + stage.image)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: portrait ? '67% 50%' : stage.focus, transform: `scale(${scale})`, transformOrigin: stage.focus }} /></AbsoluteFill>;
    })}
    <AbsoluteFill style={{ background: 'linear-gradient(90deg,rgba(1,8,15,.25),transparent 65%),linear-gradient(0deg,rgba(5,16,26,.8),transparent 38%)' }} />
    {stageIndex >= 5 ? <AbsoluteFill style={{ background: 'linear-gradient(115deg,transparent 35%,rgba(221,178,109,.055) 65%,transparent)', opacity: Math.min(1,(frame-5*STAGE_FRAMES)/36) }} /> : null}
    <svg width={width} height={height} viewBox="0 0 1280 720" preserveAspectRatio="none" style={{ position:'absolute',inset:0 }} aria-hidden="true">
      <defs><filter id="thread-glow"><feGaussianBlur stdDeviation="2" /></filter></defs>
      <path d="M70 650C260 606 390 708 590 646S975 575 1120 590C1190 600 1170 686 1010 685H170Q70 685 70 720" pathLength="1" stroke={cyan} strokeWidth="2.4" opacity=".19" filter="url(#thread-glow)" fill="none" strokeDasharray="1" strokeDashoffset={1-progress} />
      <path d="M70 650C260 606 390 708 590 646S975 575 1120 590C1190 600 1170 686 1010 685H170Q70 685 70 720" pathLength="1" stroke={cyan} strokeWidth=".9" opacity=".65" fill="none" strokeDasharray="1" strokeDashoffset={1-progress} />
    </svg>
    {titles ? <div style={{ position:'absolute',left:width*.055,top:height*.54,width:width*(portrait?.85:.65),color:'#edf0e9',opacity:titleOpacity,transform:`translateY(${interpolate(localFrame,[0,28],[9,0],{extrapolateRight:'clamp'})}px)` }}>
      <div style={{ fontFamily:'Arial, sans-serif',fontSize:portrait?12:14,letterSpacing:'.22em',marginBottom:22,color:stageIndex>4?'#e6c18d':'#d5e7e8' }}>{String(stageIndex+1).padStart(2,'0')} — {stages[stageIndex].label}</div>
      <div style={{ fontFamily:'Georgia, serif',fontSize:portrait?42:62,lineHeight:1.08,letterSpacing:'-.025em',whiteSpace:'pre-line',textShadow:'0 2px 18px rgba(0,0,0,.4)' }}>{stages[stageIndex].title}</div>
    </div> : null}
  </AbsoluteFill>;
};

function Root() {
  return <>
    <Composition id="Hero-Desktop" component={BrandFilm} width={1280} height={720} fps={FPS} durationInFrames={STAGE_FRAMES*7} defaultProps={{ titles:false }} />
    <Composition id="Hero-Mobile" component={BrandFilm} width={540} height={960} fps={FPS} durationInFrames={STAGE_FRAMES*7} defaultProps={{ titles:false }} />
    <Composition id="Brand-Film" component={BrandFilm} width={1280} height={720} fps={FPS} durationInFrames={STAGE_FRAMES*7} defaultProps={{ titles:true }} />
  </>;
}
registerRoot(Root);
