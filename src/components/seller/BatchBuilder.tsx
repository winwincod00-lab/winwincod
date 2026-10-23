"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useLanguage } from '@/context/LanguageContext';
type EligibleOrder = { id: string; customerName: string; productName: string; productId: string | null; quantity: number; stock: number; cost: number | null; eligible: boolean };
export default function BatchBuilder({ onCreated }: { onCreated: () => void }) {
  const { lang } = useLanguage();
  const fr = lang === 'fr';
  const [orders, setOrders] = useState<EligibleOrder[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true); setError(false);
    try { setOrders((await axios.get('/api/seller/batches/eligible')).data.orders); setSelected([]); }
    catch { setError(true); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const chosen = orders.filter(o => selected.includes(o.id));
  const demand = new Map<string | null, number>();
  chosen.forEach(o => demand.set(o.productId, (demand.get(o.productId) ?? 0) + o.quantity));
  const insufficient = chosen.some(o => (demand.get(o.productId) ?? 0) > o.stock || !o.eligible);
  const units = chosen.reduce((sum, order) => sum + order.quantity, 0);
  const total = chosen.reduce((sum, o) => sum + (o.cost ?? 0), 0);
  async function create() {
    if (busy || units < 5 || insufficient) return;
    if (!window.confirm(fr ? 'Soumettre ' + units + ' PCS à la revue Admin ? Aucun débit maintenant.' : 'إرسال ' + units + ' وحدة لمراجعة الإدارة دون خصم الآن؟')) return;
    setBusy(true);
    try {
      await axios.post('/api/seller/batches/create', { orderIds: selected });
      toast.success(fr ? 'Lot soumis à la revue Admin, sans paiement' : 'تم إرسال الدفعة للمراجعة دون دفع');
      await load(); onCreated();
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? 'تعذر إنشاء الدفعة' : 'تعذر إنشاء الدفعة');
    } finally { setBusy(false); }
  }
  return <section className="rounded-2xl border bg-white p-4 space-y-3" aria-busy={busy || loading}>
    <h2 className="font-bold text-lg">{fr ? 'Créer un lot de commandes confirmées' : 'إنشاء دفعة من الطلبات المؤكدة'}</h2>
    <p className="text-sm">{fr ? 'Minimum 5 PCS au total, même dans une seule commande. Soumission sans paiement ; acceptation Admin séparée. Coût : produits + 20 MAD par commande. Le stock est contrôlé à nouveau au paiement et à la sortie entrepôt ; ni les brouillons ni les lots payés ne réservent le stock.' : '5 وحدات على الأقل ولو في طلب واحد. الإرسال للمراجعة دون دفع؛ القبول بقرار منفصل من الإدارة. التكلفة: المنتجات + 20 د.م لكل طلب. يُفحص المخزون عند الدفع والخروج من المستودع؛ المسودات والدفعات المدفوعة لا تحجز المخزون.'}</p>
    {loading ? <p role="status">{fr ? 'Chargement…' : 'جاري التحميل...'}</p> : error ? <div role="alert">{fr ? 'Chargement impossible.' : 'فشل التحميل.'}<button className="p-3 underline" onClick={load}>{fr ? 'Réessayer' : 'إعادة المحاولة'}</button></div> : !orders.length ? <p>{fr ? 'Aucune commande confirmée disponible.' : 'لا توجد طلبات مؤكدة متاحة.'} <Link className="underline text-blue-700" href="/seller/orders">{fr ? 'Confirmer les commandes' : 'تأكيد الطلبات'}</Link></p> :
    <ul className="max-h-96 overflow-y-auto divide-y">{orders.map(o => <li key={o.id}><label className="flex items-start gap-3 py-3 cursor-pointer">
      <input type="checkbox" className="mt-1 w-5 h-5" disabled={busy || !o.eligible} checked={selected.includes(o.id)} onChange={() => setSelected(ids => ids.includes(o.id) ? ids.filter(id => id !== o.id) : [...ids, o.id])} />
      <span className="min-w-0"><span className="block font-bold">{o.customerName} · {o.productName} × {o.quantity}</span>
      <span className="text-sm">{fr ? 'Stock physique' : 'المخزون الفعلي'}: {o.stock} · {o.cost?.toFixed(2) ?? '—'} MAD { !o.eligible && (fr ? ' · Stock insuffisant / produit indisponible' : ' · مخزون غير كافٍ / المنتج غير متاح')}</span></span>
    </label></li>)}</ul>}
    <p role="status">{units} / 5 PCS · {selected.length} commandes · {total.toFixed(2)} MAD</p>
    {insufficient && <p role="alert" className="text-red-700">{fr ? 'Stock insuffisant pour la quantité totale sélectionnée.' : 'المخزون لا يكفي مجموع الكميات المختارة.'}</p>}
    <button className="w-full sm:w-auto rounded-xl bg-blue-700 text-white p-3 disabled:opacity-50" disabled={loading || busy || units < 5 || insufficient} onClick={create}>{busy ? (fr ? 'Soumission…' : 'جاري الإرسال...') : (fr ? 'Soumettre à la revue Admin' : 'إرسال لمراجعة الإدارة')}</button>
    <Link href="/seller/wallet" className="inline-block p-3 text-blue-700 underline">{fr ? 'Consulter / alimenter le portefeuille' : 'عرض / شحن المحفظة'}</Link>
  </section>;
}
