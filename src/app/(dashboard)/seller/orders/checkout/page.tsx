"use client";
import { useRef, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { useCart } from '@/context/CartContext';
import { allocationInput, allocationOrders, allocationTotals } from '@/lib/customer-allocation';
import { submissionKey, clearSubmissionKey } from '@/lib/order-submission-client';
import { MOROCCAN_CITIES } from '@/lib/moroccan-cities';
import CitySelect from '@/components/ui/CitySelect';
import { useLanguage } from '@/context/LanguageContext';
import ProductPicker from '@/components/seller/ProductPicker';
import ProductThumbnail from '@/components/seller/ProductThumbnail';
import type { CartItem } from '@/lib/cart';

type Customer = { id: string; customerName: string; customerPhone: string; city: string; address: string; codAmount: string; allocations: { productId: string; quantity: string }[] };
const emptyCustomer = (productId = '', quantity = ''): Customer => ({ id: crypto.randomUUID(), customerName: '', customerPhone: '', city: '', address: '', codAmount: '', allocations: productId ? [{ productId, quantity }] : [] });
export default function CheckoutPage() {
  const { lang, t: translate } = useLanguage();
  const t = (key: string) => translate('sellerCheckout.' + key);
  const { items, removeItem, ready, sellerId } = useCart();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [savedCards, setSavedCards] = useState<{ id: string; customer: Customer; product?: CartItem }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const pending = useRef<{ payload: { checkout: { cart: { productId: string; quantity: number }[]; customers: Customer[] } }; cartIds: string[]; products: CartItem[] } | null>(null);
  const totals = allocationTotals(items, []);
  // Derived first customer avoids an effect that could reset entered customer data.
  const initial = useRef<Customer | null>(null);
  if (!initial.current && items.length) initial.current = emptyCustomer(totals[0].productId, String(totals[0].total));
  const clients = pending.current?.payload.checkout.customers ?? customers ?? (initial.current ? [initial.current] : []);
  const cart = pending.current?.payload.checkout.cart ?? items.map(item => ({ productId: item.productId, quantity: item.quantity }));
  const summary = allocationTotals(cart, clients);
  const total = summary.reduce((sum, row) => sum + row.total, 0);
  const allocated = summary.reduce((sum, row) => sum + row.allocated, 0);
  const products = pending.current?.products ?? items;
  const pickerProducts = summary.map(row => products.find(item => item.productId === row.productId)!).filter(Boolean);
  function update(id: string, patch: Partial<Customer>) {
    if (lock.current || uncertain) return;
    setCustomers(clients.map(customer => customer.id === id ? { ...customer, ...patch } : customer));
    setErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !Object.keys(patch).some(field => key === id + ':' + field))));
  }
  function allocate(id: string, productId: string, value: string) {
    if (value !== '' && (!/^\d+$/.test(value) || Number(value) < 1)) { setErrors(previous => ({ ...previous, [id + ':quantity']: t('quantityLimit') })); return; }
    const other = clients.filter(row => row.id !== id).flatMap(row => row.allocations).filter(line => line.productId === productId).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    if (Number(value) + other > (summary.find(row => row.productId === productId)?.total ?? 0)) { setErrors(previous => ({ ...previous, [id + ':quantity']: t('quantityLimit') })); return; }
    setErrors(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id + ':quantity')));
    update(id, { allocations: [{ productId, quantity: value }] });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || !sellerId || saved) return;
    lock.current = true;
    let sent = false;
    try {
      const payload = pending.current?.payload ?? { checkout: { cart, customers: clients } };
      const validation = allocationInput.safeParse(payload.checkout);
      if (!validation.success) {
        const nextErrors: Record<string, string> = {};
        for (const issue of validation.error.issues) {
          const index = issue.path[1];
          const field = issue.path.at(-1);
          if (typeof index === 'number' && payload.checkout.customers[index]) nextErrors[payload.checkout.customers[index].id + ':' + String(field)] = t('fieldError');
        }
        setErrors(nextErrors);
        throw new Error(t('review'));
      }
      setErrors({});
      allocationOrders(payload.checkout); // The server repeats this exact validation.
      pending.current ??= { payload: structuredClone(payload), cartIds: items.map(item => item.cartId), products: structuredClone(items) };
      setBusy(true); setMessage('');
      const key = await submissionKey(sellerId, 'checkout', payload);
      sent = true;
      const response = await axios.post('/api/seller/orders/create-bulk', payload, { headers: { 'Idempotency-Key': key } });
      const ids: unknown = response.data.orderIds;
      if (!Array.isArray(ids) || ids.length !== payload.checkout.customers.length || !ids.every(id => typeof id === 'string' && !!id) || new Set(ids).size !== ids.length) throw new Error('Invalid save receipt');
      setSavedCards(ids.map((id, index) => ({ id, customer: pending.current!.payload.checkout.customers[index], product: pending.current!.products.find(item => item.productId === pending.current!.payload.checkout.customers[index].allocations[0].productId) })));
      setSaved(response.data.orderIds);
      try { pending.current.cartIds.forEach(removeItem); clearSubmissionKey(sellerId, 'checkout'); }
      catch { setMessage(t('savedWarning')); }
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const unknown = sent && (!status || status >= 500);
      setUncertain(unknown);
      if (!unknown) pending.current = null;
      setMessage(unknown ? t('uncertain') : !sent ? t('review') : t('failed'));
      lock.current = false;
    } finally { setBusy(false); }
  }
  const direction = lang === 'ar' ? 'rtl' : 'ltr';
  const button = 'inline-flex min-h-12 items-center justify-center rounded-xl bg-[#4361EE] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50';
  const control = 'mt-2 block min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-3 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100';
  if (saved) return <div dir={direction} className="mx-auto max-w-5xl space-y-6 py-4">
    <div className="rounded-3xl border border-emerald-100 bg-white p-6 shadow-sm sm:p-8"><span aria-hidden="true" className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-600">✓</span>
      <h1 className="text-2xl font-extrabold text-slate-900">{t('success')}</h1><p role="status" className="mt-2 font-semibold text-emerald-700">{saved.length} {t('saved')}</p>
      <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">{t('successNotice')} {t('next')}</p>
      <div className="mt-6 flex flex-wrap gap-3"><Link className={button} href="/seller/orders/drafts">{t('viewDrafts')}</Link><Link className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700" href="/seller/orders/new">{t('products')}</Link></div>
    </div>
    {message && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{message}</p>}
    <ul className="grid gap-4 sm:grid-cols-2">{savedCards.map(card => <li key={card.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-bold text-slate-900">{card.customer.customerName}</p><p className="mt-1 text-sm text-slate-500">{card.customer.city}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{t('draft')}</span></div>
      <div className="flex items-center gap-3"><ProductThumbnail src={card.product?.productImage} name={card.product?.productName ?? t('product')} /><div className="min-w-0"><p className="break-words text-sm font-semibold">{card.product?.productName ?? t('product')}</p>{card.product?.sku && <p className="text-xs text-slate-500" dir="auto">{card.product.sku}</p>}<p className="mt-1 text-sm text-slate-500">{card.customer.allocations[0].quantity} PCS</p></div></div>
      <Link className="mt-4 inline-block text-sm font-bold text-blue-700 underline-offset-4 hover:underline" href={'/seller/orders/' + card.id}>{t('viewOrder')}<span className="sr-only"> · {card.customer.customerName}</span></Link>
    </li>)}</ul>
  </div>;
  if (!ready) return <p role="status" dir={direction} className="animate-pulse rounded-2xl border bg-white p-8 text-slate-500">{t('loading')}</p>;
  if (!items.length && !pending.current) return <div dir={direction} className="mx-auto max-w-lg rounded-3xl border bg-white p-10 text-center shadow-sm"><h1 className="text-2xl font-bold">{t('empty')}</h1><p className="my-4 text-sm text-slate-500">{t('emptyHint')}</p><Link className={button} href="/seller/orders/new">{t('products')}</Link></div>;
  return <form onSubmit={submit} noValidate dir={direction} className="mx-auto max-w-7xl space-y-6 pb-8" aria-busy={busy}>
    <nav aria-label={t('step2')}><ol className="flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-400">{['step1', 'step2', 'step3'].map((step, index) => <li key={step} aria-current={index === 1 ? 'step' : undefined} className={'flex items-center gap-2 ' + (index === 1 ? 'text-blue-700' : '')}><span className={'flex size-7 items-center justify-center rounded-full ' + (index === 1 ? 'bg-blue-600 text-white' : 'bg-slate-100')}>{index + 1}</span>{t(step)}</li>)}</ol></nav>
    <header><h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{t('title')}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{t('subtitle')}</p></header>
    {message && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message} <Link className="font-bold underline" href="/seller/orders/drafts">{t('viewDrafts')}</Link></div>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <fieldset disabled={busy || uncertain} className="min-w-0 space-y-5"><legend className="sr-only">{t('step2')}</legend>
        {clients.map((customer, index) => { const line = customer.allocations[0]; const err = (field: string) => errors[customer.id + ':' + field]; return <section key={customer.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><h2 className="flex items-center gap-3 font-bold text-slate-800"><span className="flex size-8 items-center justify-center rounded-xl bg-blue-50 text-sm text-blue-700">{index + 1}</span>{t('customer')} {index + 1}</h2><button type="button" disabled={clients.length === 1} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-30" onClick={() => setCustomers(clients.filter(row => row.id !== customer.id))}>{t('remove')}</button></div>
          <div className="space-y-5 p-5 sm:p-6"><div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
            <ProductPicker products={pickerProducts} value={line?.productId ?? ''} onChange={productId => update(customer.id, { allocations: [{ productId, quantity: '' }] })} name={customer.id + '-product'} label={t('product')} placeholder={t('choose')} error={err('productId')} />
            <label className="block text-xs font-bold text-slate-600">{t('quantity')}<input className={control} type="number" min="1" max={(summary.find(row => row.productId === line?.productId)?.total ?? 0) - clients.filter(row => row.id !== customer.id).flatMap(row => row.allocations).filter(other => other.productId === line?.productId).reduce((sum, other) => sum + Number(other.quantity || 0), 0)} step="1" value={line?.quantity ?? ''} onChange={event => allocate(customer.id, line?.productId ?? '', event.target.value)} required aria-invalid={!!err('quantity')} aria-describedby={err('quantity') ? customer.id + '-quantity-error' : undefined} />{err('quantity') && <span id={customer.id + '-quantity-error'} className="mt-1 block text-xs text-red-700">{err('quantity')}</span>}</label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">{(['customerName', 'customerPhone'] as const).map(field => <label key={field} className="block text-xs font-bold text-slate-600">{t(field)}<input className={control} type={field === 'customerPhone' ? 'tel' : 'text'} autoComplete={field === 'customerPhone' ? 'tel' : 'name'} placeholder={field === 'customerPhone' ? '06 12 34 56 78' : undefined} value={customer[field]} onChange={event => update(customer.id, { [field]: event.target.value })} required aria-invalid={!!err(field)} aria-describedby={err(field) ? customer.id + '-' + field + '-error' : undefined} />{err(field) && <span id={customer.id + '-' + field + '-error'} className="mt-1 block text-xs text-red-700">{err(field)}</span>}</label>)}</div>
          <div className="grid gap-4 sm:grid-cols-2"><CitySelect id={customer.id + '-city'} label={t('city')} placeholder={t('chooseCity')} value={customer.city} onChange={city => update(customer.id, { city })} cities={MOROCCAN_CITIES} error={err('city')} />
            <label className="block text-xs font-bold text-slate-600">{t('codAmount')}<input className={control} type="number" min="0" step="any" value={customer.codAmount} onChange={event => update(customer.id, { codAmount: event.target.value })} required aria-invalid={!!err('codAmount')} aria-describedby={err('codAmount') ? customer.id + '-cod-error' : undefined} />{err('codAmount') && <span id={customer.id + '-cod-error'} className="mt-1 block text-xs text-red-700">{err('codAmount')}</span>}</label></div>
          <label className="block text-xs font-bold text-slate-600">{t('address')}<input className={control} autoComplete="street-address" value={customer.address} onChange={event => update(customer.id, { address: event.target.value })} required aria-invalid={!!err('address')} aria-describedby={err('address') ? customer.id + '-address-error' : undefined} />{err('address') && <span id={customer.id + '-address-error'} className="mt-1 block text-xs text-red-700">{err('address')}</span>}</label>
          <p className="rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-500">{t('estimate')} : {(() => { const product = products.find(item => item.productId === line?.productId); return product && line?.quantity ? (product.sellerPrice * Number(line.quantity)).toFixed(2) + ' MAD' : '—'; })()} · {t('estimateHint')}</p>
          </div></section>; })}
        <button type="button" disabled={clients.length >= 500} className="min-h-14 w-full rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-4 text-sm font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-50" onClick={() => { const remaining = summary.find(row => row.remaining > 0); setCustomers([...clients, emptyCustomer(remaining?.productId, remaining ? String(remaining.remaining) : '')]); }}>{t('add')}</button>
      </fieldset>
      <aside className="order-first min-w-0 space-y-4 lg:order-last lg:sticky lg:top-6"><div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">{t('summary')}</h2>
        <ul className="my-5 space-y-4">{summary.map(row => { const product = products.find(item => item.productId === row.productId); return <li key={row.productId} className="flex items-center gap-3"><ProductThumbnail src={product?.productImage} name={product?.productName ?? t('product')} /><div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{product?.productName ?? t('product')}</p><p className="mt-1 text-xs text-slate-500">{row.allocated} / {row.total} PCS · {row.remaining} {t('remaining')}</p></div></li>; })}</ul>
        <dl role="status" aria-live="polite" className="space-y-3 border-t border-slate-100 pt-4 text-sm">{[[t('total'), total], [t('allocated'), allocated], [t('remaining'), total - allocated]].map(([label, count]) => <div key={label} className="flex items-center justify-between gap-3"><dt className="text-slate-500">{label}</dt><dd className="font-bold text-slate-900">{count}</dd></div>)}</dl>
        <p className="my-4 text-xs leading-6 text-slate-500">{t('allocationHint')}</p><button type="submit" disabled={busy || (!uncertain && summary.some(row => row.remaining !== 0))} className={button + ' w-full'}>{busy ? t('saving') : uncertain ? t('retrySame') : t('save')}</button>
        <p className="mt-3 text-xs leading-6 text-slate-500">{t('safety')}</p></div><div className="rounded-2xl bg-blue-50 p-5 text-xs leading-6 text-blue-900">{t('limit')}<p className="mt-3">{t('next')}</p></div>
      </aside>
    </div>
  </form>;
}
