import { getSessionUser } from '@/lib/api-utils';
import { orderReference } from '@/lib/order-reference';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
export default async function SellerOrderDetails({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== 'SELLER') redirect('/login');
  const { id } = await params;
  const order = await prisma.order.findFirst({ where: { id, sellerId: user.id },
    select: { id: true, seqId: true, customerName: true, customerPhone: true, address: true, city: true, productName: true, quantity: true, codAmount: true, codReceived: true, netProfit: true, status: true, trackingNumber: true, batch: { select: { id: true, isPaid: true } }, statusHistory: { select: { status: true, createdAt: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!order) notFound();
  const review = order.batch ? await prisma.log.findUnique({ where: { id: 'batch-review:' + order.batch.id }, select: { action: true } }) : null;
  const batchLabel = !order.batch ? 'بدون دفعة / Aucun lot' : order.batch.isPaid ? 'مدفوعة / Payé' : review?.action === 'BATCH_APPROVE' ? 'مقبولة — بانتظار الدفع / Approuvé — à payer' : review?.action === 'BATCH_REJECT' ? 'مرفوضة / Rejeté' : 'بانتظار مراجعة الإدارة / En attente de revue Admin';
  const labels: Record<string, string> = { DRAFT: 'مسودة / Brouillon', PENDING_CONFIRMATION: 'بانتظار التأكيد / À confirmer', CONFIRMED: 'مؤكدة / Confirmée', WAITING_PAYMENT: 'مراجعة الإدارة / الدفع بعد القبول — Revue Admin / paiement après acceptation', PROCESSING: 'تجهيز المستودع / Préparation entrepôt', SHIPPED: 'مشحونة / Expédiée', DELIVERED: 'مسلّمة / Livrée', RETURNED: 'مرتجعة / Retournée', CANCELLED: 'ملغاة / Annulée' };
  return <article className="space-y-4 max-w-3xl">
    <Link href="/seller/orders" className="inline-block p-3 text-blue-700 underline">الطلبات / Commandes</Link>
    <h1 className="text-2xl font-bold">{order.customerName}</h1>
    <p className="break-all text-sm">{orderReference(order.id, order.seqId)}</p>
    <div className="bg-white border rounded-xl p-4 space-y-2">
      <p className="font-bold">{labels[order.status]}</p>
      <p>{order.productName} × {order.quantity}</p>
      <a className="text-blue-700 underline" href={'tel:' + order.customerPhone}>{order.customerPhone}</a>
      <p>{order.address} · {order.city}</p>
      <p>COD: {Number(order.codAmount).toFixed(2)} MAD</p>
      <p>COD reçu / المحصل: {order.codReceived === null ? '—' : Number(order.codReceived).toFixed(2) + ' MAD'}</p>
      <p>الربح المسجل / Profit enregistré: {order.status === 'DELIVERED' ? Number(order.netProfit).toFixed(2) + ' MAD' : '—'}</p>
      <p>الدفعة / Lot: {batchLabel}</p>
      <p className="break-all">Tracking: {order.trackingNumber ?? 'غير متوفر / Indisponible'}</p>
    </div>
    {['DRAFT', 'PENDING_CONFIRMATION'].includes(order.status) && <Link className="block p-3 text-blue-700 underline" href={'/seller/orders?status=' + order.status}>إجراءات التأكيد / Confirmation</Link>}
    {['CONFIRMED', 'WAITING_PAYMENT'].includes(order.status) && <Link className="block p-3 text-blue-700 underline" href="/seller/batches">فحص الأهلية والدفع / Éligibilité et paiement</Link>}
    {order.status === 'PROCESSING' && <p>الدفع لا يعني الشحن. بانتظار المستودع / Payé ne signifie pas expédié : préparation entrepôt.</p>}
    {order.status === 'RETURNED' && <p>لا إعادة تخزين قبل الفحص الفعلي / Aucune remise en stock avant inspection physique.</p>}
    <Link className="inline-block p-3 text-blue-700 underline" href="/seller/wallet">قيود المحفظة / Écritures du portefeuille</Link>
    <h2 className="font-bold">سجل الحالات / Historique</h2>
    {!order.statusHistory.length ? <p>لا توجد أحداث مسجلة / Aucun événement enregistré.</p> : <ol className="space-y-2">{order.statusHistory.map((event, i) => <li key={i} className="border rounded-xl p-3">{labels[event.status]} · <time dateTime={event.createdAt.toISOString()}>{event.createdAt.toISOString()}</time></li>)}</ol>}
  </article>;
}
