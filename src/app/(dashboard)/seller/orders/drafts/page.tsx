"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import toast from 'react-hot-toast';
type Draft = { id: string; customerName: string; productName: string; city: string };
export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  async function load() {
    setLoading(true); setError(false);
    try { setDrafts((await axios.get('/api/seller/orders/drafts')).data.drafts ?? []); }
    catch { setError(true); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function submit(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await axios.patch('/api/seller/orders/' + id + '/status', { status: 'PENDING_CONFIRMATION' });
      setDrafts(previous => previous.filter(order => order.id !== id));
      toast.success('تم إرسال الطلب للتأكيد. لم يتم خصم أي مبلغ');
    } catch { toast.error('تعذر الإرسال. حدّث الصفحة وتحقق من حالة الطلب'); }
    finally { setBusy(null); }
  }
  return <section className="space-y-4">
    <h1 className="text-2xl font-bold">مسودات الطلبات</h1>
    <p>أرسل المسودة للتأكيد أولاً. بعد التأكيد، اجمع 5 وحدات من الطلبات المؤكدة والمؤهلة على الأقل لمراجعة الإدارة دون دفع.</p>
    <p className="text-sm text-slate-600">المسودات لا تحجز المخزون. الدفع لا يعني أن الطلب خرج من المستودع.</p>
    <div className="flex flex-wrap gap-4"><Link className="text-blue-700 underline" href="/seller/orders">تأكيد الطلبات</Link><Link className="text-blue-700 underline" href="/seller/batches">إنشاء دفعة</Link></div>
    {loading ? <p role="status">جاري التحميل...</p> : error ? <div role="alert">فشل تحميل المسودات. <button onClick={load} className="underline p-3">إعادة المحاولة</button></div> : !drafts.length ? <p>لا توجد مسودات. <Link href="/seller/orders/new" className="underline">إضافة طلب</Link></p> :
      <ul className="space-y-3">{drafts.map(order => <li key={order.id} className="rounded-xl border bg-white p-4 flex flex-col sm:flex-row gap-3 justify-between">
        <div><p className="font-bold">{order.customerName} · {order.city}</p><p>{order.productName}</p></div>
        <button disabled={busy !== null} onClick={() => submit(order.id)} className="rounded-xl bg-blue-700 text-white p-3 disabled:opacity-50">{busy === order.id ? 'جاري الإرسال...' : 'إرسال للتأكيد'}</button>
      </li>)}</ul>}
  </section>;
}
