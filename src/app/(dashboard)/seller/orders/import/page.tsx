"use client";
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { importOrdersInput } from '@/lib/order-input';
import { submissionKey, clearSubmissionKey } from '@/lib/order-submission-client';
type Product = { id: string; name: string; stock: number };
type Row = Record<string, unknown>;
export default function ImportOrdersPage() {
  const { data: session } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [productsError, setProductsError] = useState(false);
  const [productsLoading, setProductsLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<number | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    axios.get('/api/seller/products', { signal: controller.signal }).then(response => setProducts(response.data.products))
      .catch(() => { if (!controller.signal.aborted) setProductsError(true); })
      .finally(() => { if (!controller.signal.aborted) setProductsLoading(false); });
    return () => controller.abort();
  }, [revision]);
  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || lock.current) return;
    setReading(true); setRows([]); setMessage('');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('empty');
      const data = XLSX.utils.sheet_to_json<Row>(sheet);
      if (!data.length || data.length > 500) { setMessage('اختر ملفاً يحتوي على 1 إلى 500 طلب'); return; }
      setRows(data);
    } catch { setMessage('تعذر قراءة الملف. استخدم النموذج ثم احفظ الملف بصيغة Excel أو CSV'); }
    finally { setReading(false); event.target.value = ''; }
  }
  function downloadTemplate() {
    const sheet = XLSX.utils.json_to_sheet([{ name: 'Ahmed Alami', phone: '0612345678', city: 'Casablanca', address: 'Maarif, Rue 10', quantity: 1, price: 200 }]);
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Orders'); XLSX.writeFile(workbook, 'winwincod_template.xlsx');
  }
  const validation = importOrdersInput.safeParse({ productId, orders: rows });
  const issues = validation.success || !rows.length ? [] : validation.error.issues;
  async function submit() {
    const sellerId = session?.user?.role === 'SELLER' ? session.user.id : '';
    if (lock.current || reading || !sellerId || !validation.success) return;
    lock.current = true; setBusy(true); setMessage('');
    let sent = false;
    try {
      const payload = validation.data;
      const key = await submissionKey(sellerId, 'import', payload);
      sent = true;
      const response = await axios.post('/api/seller/orders/import', payload, { headers: { 'Idempotency-Key': key } });
      setSaved(response.data.count);
      try { clearSubmissionKey(sellerId, 'import'); } catch { /* acknowledged save must never become a new submission */ }
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const unknownOutcome = sent && (!status || status >= 500);
      setUncertain(unknownOutcome);
      setMessage(!sent ? 'تعذر تجهيز الحفظ في المتصفح؛ لم يتم إرسال الملف' : unknownOutcome ? 'تعذر التأكد من الحفظ. أعد المحاولة الآمنة بنفس الملف أو راجع المسودات؛ لا ترفع نسخة جديدة' : axios.isAxiosError(error) ? error.response?.data?.error ?? 'تعذر الاستيراد' : 'تعذر الاستيراد');
      lock.current = false;
    } finally { setBusy(false); }
  }
  if (saved !== null) return <section className="space-y-4"><h1 role="status" className="text-2xl font-bold">تم حفظ {saved} مسودة</h1><p>لم يتم خصم أي مبلغ. أرسل المسودات للتأكيد قبل إنشاء دفعة.</p><Link href="/seller/orders/drafts" className="inline-block p-3 rounded-xl bg-blue-700 text-white">إرسال المسودات للتأكيد</Link></section>;
  return <section className="max-w-3xl mx-auto space-y-4" aria-busy={busy || reading}>
    <h1 className="text-2xl font-bold">استيراد الطلبات كمسودات</h1>
    <p>1. اختر المنتج · 2. ارفع الملف · 3. صحح الأخطاء · 4. احفظ دون دفع.</p>
    <button onClick={downloadTemplate} className="p-3 text-blue-700 underline">تحميل نموذج Excel</button>
    {productsLoading ? <p role="status">جاري تحميل المنتجات...</p> : productsError ? <div role="alert">تعذر تحميل المنتجات. <button className="p-3 underline" onClick={() => { setProductsError(false); setProductsLoading(true); setRevision(value => value + 1); }}>إعادة المحاولة</button></div> : !products.length ? <p>لا توجد منتجات متاحة للاستيراد حالياً.</p> : null}
    {message && <div role="alert" className="border border-red-300 bg-white rounded-xl p-4"><p>{message}</p><Link href="/seller/orders/drafts" className="inline-block p-2 underline text-blue-700">مراجعة المسودات</Link></div>}
    <fieldset disabled={busy || uncertain || reading} className="rounded-xl border bg-white p-4 space-y-4 min-w-0">
      <legend className="font-bold">المنتج والملف</legend>
      <label className="block" htmlFor="import-product">المنتج المشمول في الملف</label>
      <select id="import-product" value={productId} onChange={event => setProductId(event.target.value)} className="w-full min-h-11 border rounded-xl p-3" disabled={productsLoading || productsError}>
        <option value="">اختر المنتج</option>{products.map(product => <option key={product.id} value={product.id}>{product.name} · المخزون الفعلي: {product.stock}</option>)}
      </select>
      <p className="text-sm">المسودات لا تحجز المخزون. يُفحص مجموع الكميات عند الحفظ، ثم عند الدفع والإرسال.</p>
      <label htmlFor="order-file" className="block font-bold">ملف Excel أو CSV (500 طلب كحد أقصى)</label>
      <input id="order-file" type="file" accept=".xlsx,.xls,.csv" onChange={readFile} aria-describedby="import-help" className="w-full min-h-11 border rounded-xl p-3" />
      <p id="import-help" className="text-sm">الأعمدة: name, phone, city, address, quantity, price. احفظ الهاتف كنص للحفاظ على الصفر الأول. العنوان يشمل الحي والشارع وتفاصيل الوصول. عدم إدخال عمود price يستعمل السعر المقترح؛ القيمة 0 تبقى 0.</p>
    </fieldset>
    {reading && <p role="status">جاري قراءة الملف...</p>}
    {!!issues.length && <div role="alert" className="rounded-xl border border-red-300 p-4"><h2 className="font-bold">صحح الأخطاء ثم ارفع الملف من جديد</h2><ul className="list-disc ps-5">{issues.slice(0, 20).map((issue, index) => <li key={index}>{typeof issue.path[1] === 'number' ? 'صف Excel ' + (issue.path[1] + 2) + ' · ' : ''}{String(issue.path.at(-1))}: {issue.message}</li>)}</ul>{issues.length > 20 && <p>وأخطاء أخرى؛ راجع بقية الملف أيضاً.</p>}</div>}
    {!!rows.length && <div className="overflow-x-auto border rounded-xl bg-white"><table className="w-full text-sm"><caption className="p-3 text-start">معاينة أول 10 من {rows.length} طلب</caption><thead><tr>{['صف Excel', 'الاسم', 'الهاتف', 'العنوان', 'المدينة', 'الكمية', 'COD'].map(label => <th key={label} scope="col" className="p-3 text-start">{label}</th>)}</tr></thead><tbody>{rows.slice(0, 10).map((row, index) => <tr key={index} className="border-t"><td className="p-3">{index + 2}</td>{['name','phone','address','city','quantity','price'].map(field => <td key={field} className="p-3">{String(row[field] ?? (field === 'quantity' ? 1 : '—'))}</td>)}</tr>)}</tbody></table></div>}
    <button disabled={busy || reading || !validation.success || productsLoading || productsError || !session?.user?.id} onClick={submit} className="w-full min-h-11 rounded-xl bg-blue-700 text-white p-4 font-bold disabled:opacity-50">{busy ? 'جاري حفظ المسودات...' : uncertain ? 'إعادة المحاولة الآمنة بنفس البيانات' : 'حفظ ' + rows.length + ' مسودة دون دفع'}</button>
  </section>;
}
