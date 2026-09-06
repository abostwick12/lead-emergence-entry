import Link from 'next/link';
import { HeroSequence, ConversationExample } from './landing-motion';
import styles from './landing-experience.module.css';

export const EMERGENCE_STAGES = [
  { name: 'SEE REALITY', short: 'SEE', phrase: 'Notice what is actually here.' },
  { name: 'REFRAME REALITY', short: 'REFRAME', phrase: 'The first interpretation is only a beginning.' },
  { name: 'ALIGN WITH REALITY', short: 'ALIGN', phrase: 'Find what can move together.' },
  { name: 'BUILD CAPABILITY', short: 'BUILD', phrase: 'Give clarity a way to become action.' },
  { name: 'PRODUCE VALUE', short: 'PRODUCE', phrase: 'Let the work change something real.' },
  { name: 'NEW REALITY', short: 'NEW REALITY', phrase: 'Stand somewhere you could not before.' },
  { name: 'SEE AGAIN', short: 'SEE AGAIN', phrase: 'A new vantage point. A better next question.' },
] as const;

export function MountainMark() {
  return <svg viewBox="0 0 52 30" fill="none" aria-hidden="true"><path d="M2 27 19 8l8 10M14 14 25 2l25 25M21 12l4 5 4-5M33 20l4-4" stroke="currentColor" strokeWidth="1.3" /></svg>;
}

export function LandingExperience() {
  return <main className={styles.page}>
    <a className={styles.skipLink} href="#leader">Skip the visual introduction</a>
    <header className={styles.nav}>
      <Link href="/" className={styles.wordmark} aria-label="Lead Emergence home"><MountainMark /><span>LEAD EMERGENCE</span></Link>
      <div className={styles.navActions}><a href="#sotf" className={styles.pilotNote}>SOTF fellows · 14 days free</a><Link className={styles.signIn} href="/login">Sign In</Link></div>
    </header>
    <HeroSequence stages={EMERGENCE_STAGES} />
    <div className={styles.narrative}>
      <svg className={styles.journeyThread} viewBox="0 0 1200 4200" preserveAspectRatio="none" fill="none" aria-hidden="true"><defs><linearGradient id="journey-color" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#72ccdc" /><stop offset=".7" stopColor="#72ccdc" /><stop offset="1" stopColor="#e7bd75" /></linearGradient></defs><path d="M84 0V150C84 240 120 270 120 350V650C120 740 500 690 500 820S980 950 980 1130V1330C980 1470 80 1440 80 1630V1920C80 2070 1060 2040 1060 2230V2520C1060 2700 180 2730 180 2900V3250C180 3460 920 3500 920 3730S820 4050 720 4200" stroke="url(#journey-color)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>
      <section className={`${styles.section} ${styles.leader}`} id="leader" aria-labelledby="leader-title">
        <div><p className={styles.eyebrow}>Leadership starts here</p><h2 id="leader-title">Everything starts<br />with the leader.</h2><p className={styles.lede}>With the way you pay attention, make meaning,<br className={styles.desktopBreak} /> and choose what comes next.</p></div>
        <div className={styles.threeMoves}><p><em>See</em> what is actually happening.</p><p><em>Name</em> what it means.</p><p><em>Move</em> with intention.</p><span>The next move creates a new reality.<br />Then you see again.</span></div>
      </section>
      <section className={`${styles.section} ${styles.conversation}`} id="conversation" aria-labelledby="conversation-title">
        <div className={styles.conversationIntro}><p className={styles.eyebrow}>Real conversation. Real coordination.</p><h2 id="conversation-title">The interface stays familiar.<br /><em>The work stays connected.</em></h2><p className={styles.lede}>Bring a decision, a conversation, or a question you cannot quite name. Lead Emergence gives the useful parts somewhere to go.</p>
          <ol className={styles.contextInputs}><li><span>01</span><div><h3>Your context</h3><p>The criteria, experience, and evidence you choose to confirm.</p></div></li><li><span>02</span><div><h3>A clearer decision</h3><p>See the fit, the tension, and what is still unknown.</p></div></li><li><span>03</span><div><h3>A useful next move</h3><p>Prepare the conversation. Keep the promise. Review what changed.</p></div></li><li><span>04</span><div><h3>Continuity</h3><p>Return to the decision with the learning already connected.</p></div></li></ol>
        </div>
        <ConversationExample />
      </section>
      <section className={`${styles.section} ${styles.interfaces}`} aria-labelledby="interfaces-title">
        <div><p className={styles.eyebrow}>Same work. Your way.</p><h2 id="interfaces-title">Work here—or work<br />through ChatGPT.</h2></div><div><p className={styles.lede}>Use conversation to think, research, rehearse, and decide. Use Workspace to review evidence, correct the details, and keep the next move connected.</p><p className={styles.quiet}>Your authorized connection can resume the transition work you deliberately saved. It does not automatically read all of your chats.</p><Link className={styles.lightButton} href="/login">Sign in to Lead Emergence <span aria-hidden="true">→</span></Link><p className={styles.caption}>After shared sign-in, choose an experience you can access.</p></div>
      </section>
      <section className={`${styles.section} ${styles.sotf}`} id="sotf" aria-labelledby="sotf-title">
        <div><p className={styles.eyebrow}>A concrete place to begin · SOTF Bundle</p><h2 id="sotf-title">Learn your way<br />into the right work.</h2><p className={styles.lede}>A transition becomes more useful when each conversation changes the next decision.</p></div>
        <div className={styles.pilotStory}><p>Bring a role that looks promising. Find the question your résumé cannot answer. Prepare a conversation with someone who can. Keep the evidence, the relationship, and what you promised connected.</p><p>Then arrive at your next coaching session with what changed, what is stuck, and the decision that needs a human perspective.</p><div className={styles.pilotInvitation}><strong>SOTF fellows · a free 14-day pilot</strong><p>Pilot access is offered by invitation. Your authorized destinations appear after shared sign-in.</p><Link className={styles.goldButton} href="/login">Start your SOTF Bundle <span aria-hidden="true">→</span></Link></div><p className={styles.caption}>The pilot prepares messages and invitations for your review; you complete them manually. It works with the transition information you deliberately save.</p></div>
      </section>
      <section className={`${styles.section} ${styles.questions}`} aria-labelledby="questions-title">
        <div><p className={styles.eyebrow}>Start wherever the work is</p><h2 id="questions-title">Bring the question<br />already in front of you.</h2></div><div>{['Help me decide what deserves my attention.', 'What am I assuming without realizing it?', 'Connect this opportunity to what I said I wanted.', 'Prepare me for this conversation.', 'Turn these notes into a clear next step.', 'What should change after what I learned this week?'].map((question) => <a key={question} href="#conversation">{question}<span aria-hidden="true">↗</span></a>)}</div>
      </section>
      <section className={styles.invitation} aria-labelledby="invitation-title">
        <Terrain /><div className={styles.invitationCopy}><h2 id="invitation-title">A clearer view.<br /><em>A more intentional next move.</em></h2><p>The work you bring is where we begin.</p><Link className={styles.lightButton} href="/login">Sign In <span aria-hidden="true">→</span></Link></div>
      </section>
    </div>
    <footer className={styles.footer}><Link href="/" className={styles.wordmark}><MountainMark /><span>LEAD EMERGENCE</span></Link><p>See. Reframe. Align. Build. Produce. See again.</p><span>A more human future.</span></footer>
  </main>;
}

function Terrain() {
  return <svg className={styles.terrain} viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" fill="none" aria-hidden="true"><defs><linearGradient id="terrain-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#112d46" /><stop offset="1" stopColor="#06111b" /></linearGradient><radialGradient id="terrain-light"><stop stopColor="#efc88b" stopOpacity=".7" /><stop offset=".17" stopColor="#d9a859" stopOpacity=".2" /><stop offset="1" stopColor="#d9a859" stopOpacity="0" /></radialGradient></defs><path d="M0 205 60 220 120 167 184 197 235 174 310 248 400 204 502 239 610 223 703 253 804 191 895 226 1006 170 1120 74 1220 129 1305 119 1440 180V560H0Z" fill="url(#terrain-fill)" />{Array.from({length:14},(_,i)=><path key={i} d={`M0 ${255+i*21}C200 ${140+i*25} 280 ${370+i*12} 510 ${330+i*13}S820 ${260+i*16} 1120 ${74+i*16}Q1290 ${200+i*15} 1440 ${214+i*20}`} stroke={i===4?'#a88d61':'#31516a'} strokeWidth={i===4?1.4:.7} opacity={i===4?.8:.5} />)}<ellipse cx="1120" cy="80" rx="140" ry="90" fill="url(#terrain-light)"/><path d="M0 454C250 488 340 330 535 380S820 510 1120 80" stroke="#ddbd84" strokeWidth="1.5"/><circle cx="1120" cy="80" r="3" fill="#fff0ca" /></svg>;
}
