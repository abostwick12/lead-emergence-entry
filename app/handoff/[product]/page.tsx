import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PRODUCTS, PRODUCT_COPY, type Product } from '@/lib/identity/products';
import { createProductHandoff } from '@/lib/handoff/server';
import { createProductOAuthStart } from '@/lib/oauth/server';

export default async function HandoffPage({ params }: { params: Promise<{ product: string }> }) {
  const product = (await params).product.toUpperCase() as Product;
  if (!PRODUCTS.includes(product)) notFound();
  if (product === 'PERSONAL' || product === 'CONSULTING') {
    const destination = await createProductOAuthStart(product);
    if (destination) redirect(destination);
    const productName = PRODUCT_COPY[product].name;
    return <main><div className="shell" style={{padding:'48px 0'}}><section style={{maxWidth:600,margin:'16vh auto'}}><p className="eyebrow" style={{color:'var(--gold)'}}>Lead Emergence</p><h1 className="serif" style={{fontSize:'clamp(2.6rem, 7vw, 5rem)',fontWeight:400}}>{productName} is not available</h1><p style={{fontSize:'1.15rem',lineHeight:1.7}}>This Lead Emergence account does not currently have active access to {productName}. No product session was created.</p><Link className="button secondary" href="/workspaces">Return to your products</Link></section></div></main>;
  }
  const copy = PRODUCT_COPY[product];
  const { destination, token } = await createProductHandoff(product);
  return <main><div className="shell" style={{padding:'48px 0'}}><Link href="/workspaces" className="eyebrow">Lead Emergence</Link><section style={{maxWidth:600,margin:'16vh auto'}}><p className="eyebrow" style={{color:'var(--gold)'}}>{product}</p><h1 className="serif" style={{fontSize:'clamp(2.6rem, 7vw, 5rem)',fontWeight:400}}>{copy.tagline}</h1><p style={{fontSize:'1.15rem',lineHeight:1.7}}>Your secure handoff is ready.</p><form method="post" action={destination}><input type="hidden" name="handoff" value={token} /><button className="button" type="submit">Continue to {copy.name} →</button></form></section></div></main>;
}
