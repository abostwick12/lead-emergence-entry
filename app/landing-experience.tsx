import Link from 'next/link';
import styles from './landing-experience.module.css';

const CONSULTING_URL = process.env.NEXT_PUBLIC_CONSULTING_URL || 'https://consulting.leademergence.com';

const stages = [
  ['01', 'SEE', 'Start with reality.', 'Notice what is actually happening before reaching for a solution.'],
  ['02', 'REFRAME', 'Make meaning clear.', 'Name the pattern, challenge the assumption, and find a better question.'],
  ['03', 'ALIGN', 'Create coherence.', 'Put people, purpose, and systems into a relationship that can hold.'],
  ['04', 'BUILD', 'Grow capability.', 'Turn insight into practice, rhythm, and structures people can use.'],
  ['05', 'PRODUCE', 'Let results emerge.', 'Create value that strengthens both the work and the people doing it.'],
] as const;

export function LandingExperience() {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.wordmark} aria-label="Lead Emergence home"><i>Lead</i> Emergence<span>PEOPLE · PURPOSE · SYSTEMS</span></Link>
        <nav aria-label="Main navigation"><a href="#approach">Approach</a><a href="#products">Products</a><Link className={styles.navButton} href="/login">Sign in <span aria-hidden="true">→</span></Link></nav>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroRule} aria-hidden="true" />
        <p className={styles.eyebrow}>LEADERSHIP TECHNOLOGY</p>
        <h1 id="hero-title">Lead from reality,<br /><em>not reaction.</em></h1>
        <p className={styles.heroCopy}>Lead Emergence helps leaders see clearly, make better decisions, and build organizations where people, purpose, and systems can flourish together.</p>
        <div className={styles.heroActions}><Link className={styles.primaryButton} href="/login">Sign in to Lead Emergence <span aria-hidden="true">→</span></Link><a className={styles.textLink} href={`${CONSULTING_URL}/intake/consulting`}>Talk with a consultant <span aria-hidden="true">→</span></a></div>
        <p className={styles.heroNote}><span aria-hidden="true">◆</span> One identity. Separate product permissions. Your data stays in the workspace it belongs to.</p>
      </section>

      <section className={styles.approach} id="approach" aria-labelledby="approach-title">
        <div className={styles.sectionIntro}><p className={styles.eyebrow}>THE EMERGENCE ROADMAP</p><h2 id="approach-title">A continuous practice for the work that matters.</h2><p>Technology is most useful when it helps people pay attention, reason together, and act with intention. The roadmap keeps those moves connected.</p></div>
        <div className={styles.stageGrid}>{stages.map(([number, label, title, copy]) => <article key={number}><span>{number}</span><p className={styles.stageLabel}>{label}</p><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className={styles.products} id="products" aria-labelledby="products-title">
        <div className={styles.sectionIntro}><p className={styles.eyebrow}>CHOOSE YOUR NEXT STEP</p><h2 id="products-title">One sign-in. The right place to continue.</h2><p>Lead Emergence checks your access once, then lets you choose among the products you are authorized to use.</p></div>
        <div className={styles.productGrid}>
          <article className={styles.productCard}><div className={styles.cardIcon} aria-hidden="true">◎</div><p className={styles.eyebrow}>TRANSFORMATION</p><h3>Lead Emergence Consulting</h3><p>Work with a consultant to understand your organization, align the people doing the work, and make change traceable.</p><div className={styles.cardActions}><a className={styles.primaryButton} href={`${CONSULTING_URL}/intake/consulting`}>Start client intake <span aria-hidden="true">→</span></a><Link className={styles.secondaryLink} href="/login">Sign in to Lead Emergence</Link></div></article>
          <article className={`${styles.productCard} ${styles.workspaceCard}`}><div className={styles.cardIcon} aria-hidden="true">✦</div><p className={styles.eyebrow}>PERSONAL WORKSPACE</p><h3>Lead from your own workspace</h3><p>Build a durable personal operating system for leadership, reflection, and the next decision in front of you.</p><div className={styles.cardActions}><Link className={styles.primaryButton} href="/login">Sign in to Lead Emergence <span aria-hidden="true">→</span></Link><Link className={styles.secondaryLink} href="/signup">Create your identity</Link></div></article>
        </div>
      </section>

      <footer className={styles.footer}><span className={styles.wordmark}><i>Lead</i> Emergence<span>PEOPLE · PURPOSE · SYSTEMS</span></span><p>See clearly. Align deliberately. Build what matters.</p><Link href="/login">Sign in <span aria-hidden="true">→</span></Link></footer>
    </main>
  );
}
