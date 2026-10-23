"use client";
import { useRef, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { useCart } from '@/context/CartContext';
import { allocationOrders, allocationTotals } from '@/lib/customer-allocation';
import { submissionKey, clearSubmissionKey } from '@/lib/order-submission-client';
import { MOROCCAN_CITIES } from '@/lib/moroccan-cities';
import CitySelect from '@/components/ui/CitySelect';

type Customer = { id: string; customerName: string; customerPhone: string; city: string; address: string; codAmount: string; allocations: { productId: string; quantity: string }[] };
const emptyCustomer = (productId = '', quantity = ''): Customer => ({ id: crypto.randomUUID(), customerName: '', customerPhone: '', city: '', address: '', codAmount: '', allocations: productId ? [{ productId, quantity }] : [] });
export default function CheckoutPage() {
  const { items, removeItem, ready, sellerId } = useCart();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);
  const lock = useRef(false);
  const pending = useRef<{ payload: { checkout: { cart: { productId: string; quantity: number }[]; customers: Customer[] } }; cartIds: string[] } | null>(null);
  const totals = allocationTotals(items, []);
  // Derived first customer avoids an effect that could reset entered customer data.
  const initial = useRef<Customer | null>(null);
  if (!initial.current && items.length) initial.current = emptyCustomer(totals[0].productId, String(totals[0].total));
  const clients = pending.current?.payload.checkout.customers ?? customers ?? (initial.current ? [initial.current] : []);
  const cart = pending.current?.payload.checkout.cart ?? items.map(item => ({ productId: item.productId, quantity: item.quantity }));
  const summary = allocationTotals(cart, clients);
  const total = summary.reduce((sum, row) => sum + row.total, 0);
  const allocated = summary.reduce((sum, row) => sum + row.allocated, 0);
  function update(id: string, patch: Partial<Customer>) {
    if (lock.current || uncertain) return;
    setCustomers(clients.map(customer => customer.id === id ? { ...customer, ...patch } : customer));
  }
  function allocate(id: string, productId: string, value: string) {
    if (value !== '' && (!/^\d+$/.test(value) || Number(value) < 1)) return;
    const other = clients.filter(row => row.id !== id).flatMap(row => row.allocations).filter(line => line.productId === productId).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    if (Number(value) + other > (summary.find(row => row.productId === productId)?.total ?? 0)) return;
    update(id, { allocations: [{ productId, quantity: value }] });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || !sellerId || saved) return;
    lock.current = true;
    let sent = false;
    try {
      const payload = pending.current?.payload ?? { checkout: { cart, customers: clients } };
      allocationOrders(payload.checkout); // The server repeats this exact validation.
      pending.current ??= { payload: structuredClone(payload), cartIds: items.map(item => item.cartId) };
      setBusy(true); setMessage('');
      const key = await submissionKey(sellerId, 'checkout', payload);
      sent = true;
      const response = await axios.post('/api/seller/orders/create-bulk', payload, { headers: { 'Idempotency-Key': key } });
      setSaved(response.data.orderIds);
      try { pending.current.cartIds.forEach(removeItem); clearSubmissionKey(sellerId, 'checkout'); }
      catch { setMessage('Enregistré. Vérifiez vos brouillons avant tout nouvel envoi.'); }
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const unknown = sent && (!status || status >= 500);
      setUncertain(unknown);
      if (!unknown) pending.current = null;
      setMessage(unknown ? 'Résultat incertain. Réessayez avec les mêmes données ou vérifiez vos brouillons.' : axios.isAxiosError(error) ? error.response?.data?.error ?? 'Enregistrement impossible' : error instanceof Error ? error.message : 'Vérifiez les données');
      lock.current = false;
    } finally { setBusy(false); }
  }
  if (saved) return <section className="space-y-4"><h1 className="text-2xl font-bold">{saved.length} brouillon(s) enregistré(s)</h1><p>Aucun débit ni acceptation Admin. Confirmez les commandes, puis soumettez au moins 5 PCS à la revue Admin.</p>{message && <p role="alert">{message}</p>}<ul>{saved.map(id => <li key={id}><Link href={'/seller/orders/' + id}>{id}</Link></li>)}</ul><Link href="/seller/orders/drafts">Voir les brouillons</Link></section>;
  if (!ready) return <p role="status">Chargement du panier…</p>;
  if (!items.length && !pending.current) return <Link href="/seller/orders/new">Panier vide — choisir des produits</Link>;
  return <form onSubmit={submit} noValidate className="max-w-3xl mx-auto space-y-4" aria-busy={busy}>
    <h1 className="text-2xl font-bold">Répartir le panier entre vos clients</h1>
    <p>Un COD indépendant par client. Un SKU par commande dans le modèle actuel ; pour plusieurs SKU, créez des commandes distinctes avec leur propre COD. Aucun paiement ni réservation de stock ici.</p>
    <div role="status" className="p-4 rounded-xl border bg-white"><strong>{allocated} unités allouées · {total - allocated} restantes · {total} PCS au total</strong>
      {summary.map(row => <p key={row.productId}>{items.find(item => item.productId === row.productId)?.productName ?? row.productId} : {row.allocated} / {row.total} · restantes {row.remaining}</p>)}
    </div>
    {message && <p role="alert" className="text-red-700">{message} <Link href="/seller/orders/drafts">Voir les brouillons</Link></p>}
    <fieldset disabled={busy || uncertain} className="space-y-4">
      <legend>Clients et quantités</legend>
      {clients.map((customer, index) => <section key={customer.id} className="border rounded-xl bg-white p-4 space-y-3">
        <h2 className="font-bold">Client {index + 1}</h2>
        <label className="block">Produit / SKU<select className="block border p-3 w-full" value={customer.allocations[0]?.productId ?? ''} onChange={event => update(customer.id, { allocations: [{ productId: event.target.value, quantity: '' }] })}>
          <option value="">Choisir un SKU</option>{summary.map(row => <option key={row.productId} value={row.productId}>{items.find(item => item.productId === row.productId)?.productName ?? row.productId}</option>)}
        </select></label>
        <label className="block">Quantité pour ce client<input className="block border p-3 w-full" type="number" min="1" step="1" value={customer.allocations[0]?.quantity ?? ''} onChange={event => allocate(customer.id, customer.allocations[0]?.productId ?? '', event.target.value)} required /></label>
        {(['customerName', 'customerPhone', 'address', 'codAmount'] as const).map(field => <label key={field} className="block">{{ customerName: 'Nom complet', customerPhone: 'Téléphone marocain', address: 'Adresse complète', codAmount: 'COD de ce client (MAD)' }[field]}
          <input className="block border p-3 w-full" type={field === 'codAmount' ? 'number' : field === 'customerPhone' ? 'tel' : 'text'} min={field === 'codAmount' ? '0' : undefined} step={field === 'codAmount' ? 'any' : undefined} value={customer[field]} onChange={event => update(customer.id, { [field]: event.target.value })} required />
        </label>)}
        <CitySelect id={customer.id + '-city'} value={customer.city} onChange={city => update(customer.id, { city })} cities={MOROCCAN_CITIES} />
        <p className="text-sm">Coût produit indicatif : {(() => { const line = customer.allocations[0]; const price = items.find(item => item.productId === line?.productId)?.sellerPrice; return price === undefined || !line?.quantity ? '—' : (price * Number(line.quantity)).toFixed(2) + ' MAD'; })()} — prix actuel du panier, pas un bénéfice net réalisé ni un coût historique.</p>
        <button type="button" disabled={clients.length === 1} className="p-3 underline" onClick={() => setCustomers(clients.filter(row => row.id !== customer.id))}>Retirer ce client</button>
      </section>)}
      <button type="button" disabled={clients.length >= 500} className="p-3 border rounded-xl" onClick={() => { const remaining = summary.find(row => row.remaining > 0); setCustomers([...clients, emptyCustomer(remaining?.productId, remaining ? String(remaining.remaining) : '')]); }}>+ Ajouter un client</button>
    </fieldset>
    <button type="submit" disabled={busy || (!uncertain && summary.some(row => row.remaining !== 0))} className="p-4 bg-blue-700 text-white rounded-xl disabled:opacity-50">{busy ? 'Enregistrement…' : uncertain ? 'Réessayer les mêmes données' : 'Enregistrer les brouillons sans paiement'}</button>
  </form>;
}
