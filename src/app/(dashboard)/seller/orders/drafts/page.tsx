"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { useCart } from '@/context/CartContext';
import { useLanguage } from '@/context/LanguageContext';
import { eligibleDraft, selectedDrafts, type SelectableDraft } from '@/lib/draft-selection';
import { submissionKey, clearSubmissionKey } from '@/lib/order-submission-client';
import { productImages } from '@/lib/product-images';
import ProductThumbnail from '@/components/seller/ProductThumbnail';

type Draft = SelectableDraft & { customerName: string; productName: string; city: string; product?: { images: string; sku: string } | null };
type Outcome = { order: Draft; status: 'success' | 'failed' | 'unknown' };
export default function DraftsPage() {
  const { sellerId, ready } = useCart();
  return <DraftsContent key={sellerId} sellerId={sellerId} ready={ready} />;
}
function DraftsContent({ sellerId, ready }: { sellerId: string; ready: boolean }) {
  const { lang, t: translate } = useLanguage();
  const t = (key: string) => translate('sellerDrafts.' + key);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [page, setPage] = useState(1);
  const lock = useRef(false);
  const pending = useRef<{ orders: Draft[]; key?: string } | null>(null);
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const pageCount = Math.max(1, Math.ceil(drafts.length / 50));
  const visible = drafts.slice((page - 1) * 50, page * 50);
  const choice = selectedDrafts(visible, selected);
  const displayedChoice = pending.current ? { count: pending.current.orders.length, units: pending.current.orders.reduce((sum, order) => sum + order.quantity, 0) } : choice;
  const eligible = visible.filter(eligibleDraft);
  const allSelected = eligible.length > 0 && choice.count === eligible.length;
  const disabled = busy || uncertain || loading || error;
  async function load() {
    const version = ++requestVersion.current;
    setLoading(true); setError(false);
    try {
      const response = await axios.get('/api/seller/orders/drafts');
      if (!Array.isArray(response.data.drafts)) throw new Error('Invalid list');
      if (!mounted.current || version !== requestVersion.current) return;
      setDrafts(response.data.drafts); setSelected([]); setPage(1);
    } catch { if (mounted.current && version === requestVersion.current) setError(true); }
    finally { if (mounted.current && version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => {
    const versionRef = requestVersion;
    mounted.current = true;
    if (ready && sellerId) void load();
    return () => { mounted.current = false; versionRef.current++; };
  }, [ready, sellerId]);
  async function submit() {
    if (lock.current || !sellerId || !ready || (!pending.current && !choice.count)) return;
    lock.current = true;
    const orders = pending.current?.orders ?? choice.orders;
    if (!pending.current && !window.confirm(t('confirm') + '\n' + orders.length + ' · ' + choice.units + ' PCS')) { lock.current = false; return; }
    pending.current ??= { orders: structuredClone(orders) };
    setBusy(true); setOutcomes([]);
    let sent = false;
    try {
      const payload = { orderIds: pending.current.orders.map(order => order.id).sort() };
      pending.current.key ??= await submissionKey(sellerId, 'draft-confirmation', payload);
      if (!mounted.current) return;
      sent = true;
      const response = await axios.post('/api/seller/orders/drafts/submit', payload, { headers: { 'Idempotency-Key': pending.current.key } });
      const ids: unknown = response.data.orderIds;
      if (!Array.isArray(ids) || JSON.stringify([...ids].sort()) !== JSON.stringify(payload.orderIds)) throw new Error('Unverified result');
      if (!mounted.current) return;
      setOutcomes(orders.map(order => ({ order, status: 'success' })));
      setDrafts(previous => previous.filter(order => !payload.orderIds.includes(order.id)));
      setSelected([]); setPage(1); setUncertain(false); pending.current = null;
      try { clearSubmissionKey(sellerId, 'draft-confirmation'); } catch { /* Verified receipt, no retry. */ }
    } catch (failure) {
      if (!mounted.current) return;
      const status = axios.isAxiosError(failure) ? failure.response?.status : undefined;
      const unknown = sent && (!status || status >= 500);
      setUncertain(unknown);
      setOutcomes(orders.map(order => ({ order, status: unknown ? 'unknown' : 'failed' })));
      if (!unknown) { pending.current = null; setSelected([]); }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const primary = 'min-h-12 rounded-xl bg-[#4361EE] px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-40';
  return <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="mx-auto max-w-6xl space-y-6 pb-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">{t('title')}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{t('subtitle')}</p></div><Link className={primary} href="/seller/orders/new">+ {t('new')}</Link></header>
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-7 text-blue-900">{t('rules')}<div className="mt-2 flex flex-wrap gap-4 text-xs font-bold"><Link className="underline" href="/seller/orders">{t('orders')}</Link><Link className="underline" href="/seller/batches">{t('batches')}</Link></div></div>
    {uncertain && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{t('reconcile')}</p>}
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-4"><button type="button" disabled={disabled || !eligible.length} onClick={() => setSelected(allSelected ? [] : eligible.map(order => order.id))} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold disabled:opacity-40">{allSelected ? t('deselectAll') : t('selectAll')}</button><p role="status" aria-live="polite" className="text-sm text-slate-500"><strong className="text-slate-900">{displayedChoice.count}</strong> {t('selected')} · <strong className="text-blue-700">{displayedChoice.units}</strong> {t('units')}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || loading || !ready || !sellerId} onClick={load} className="min-h-12 rounded-xl px-4 text-sm font-bold text-slate-600 disabled:opacity-40">{t('refresh')}</button><button type="button" disabled={busy || (!uncertain && (disabled || !choice.count))} onClick={submit} className={primary}>{busy ? t('sending') : uncertain ? t('retrySame') : t('send')}</button></div>
    </div>
    <p className="text-xs leading-6 text-slate-500">{t('atomic')}</p>
    {outcomes.length > 0 && <div role="status" aria-live="polite" className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-3 font-bold">{t('results')}</h2><ul className="divide-y divide-slate-100">{outcomes.map(({ order, status }) => <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="min-w-0 break-words">{order.customerName} · {order.city} · {order.quantity} PCS</span><span className={status === 'success' ? 'text-emerald-700' : status === 'unknown' ? 'text-amber-800' : 'text-red-700'}>{t(status)}</span></li>)}</ul></div>}
    {loading ? <p role="status" className="animate-pulse rounded-2xl border bg-white p-8 text-slate-500">{t('loading')}</p> : error ? <p role="alert" className="rounded-xl border border-rose-100 bg-rose-50 p-5 text-sm text-rose-700">{t('error')}</p> : !drafts.length ? <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center"><h2 className="text-lg font-bold">{t('empty')}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{t('emptyHint')}</p><Link href="/seller/orders" className="mt-5 inline-block text-sm font-bold text-blue-700">{t('orders')}</Link></div> :
      <ul className="space-y-3">{visible.map(order => { const eligible = eligibleDraft(order); return <li key={order.id} className={'flex items-start gap-4 rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ' + (selected.includes(order.id) ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200')}>
        <input type="checkbox" checked={selected.includes(order.id)} disabled={disabled || !eligible} onChange={() => setSelected(previous => previous.includes(order.id) ? previous.filter(id => id !== order.id) : [...previous, order.id])} aria-label={t('select') + ' ' + order.customerName} className="mt-3 size-5 shrink-0 accent-blue-600 disabled:opacity-30" />
        <ProductThumbnail src={order.product ? productImages(order.product.images)[0] : undefined} name={order.productName} />
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><Link href={'/seller/orders/' + order.id} className="break-words font-bold text-slate-900 hover:text-blue-700">{order.customerName}</Link><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{eligible ? t('draft') : t('ineligible')}</span></div><p className="mt-1 text-sm text-slate-500">{order.city}</p><p className="mt-3 break-words text-sm font-medium">{order.productName} <span className="text-blue-700">× {order.quantity} PCS</span></p>{order.product?.sku && <p className="mt-1 text-xs text-slate-400" dir="auto">{order.product.sku}</p>}</div>
      </li>; })}</ul>}
    {!loading && !error && pageCount > 1 && <nav aria-label={t('page')} className="flex flex-wrap items-center justify-center gap-4 text-sm"><button type="button" disabled={disabled || page <= 1} className="min-h-11 rounded-xl border bg-white px-4 disabled:opacity-40" onClick={() => { setPage(previous => previous - 1); setSelected([]); }}>{t('previous')}</button><span>{t('page')} {page} / {pageCount}</span><button type="button" disabled={disabled || page >= pageCount} className="min-h-11 rounded-xl border bg-white px-4 disabled:opacity-40" onClick={() => { setPage(previous => previous + 1); setSelected([]); }}>{t('nextPage')}</button></nav>}
  </div>;
}
