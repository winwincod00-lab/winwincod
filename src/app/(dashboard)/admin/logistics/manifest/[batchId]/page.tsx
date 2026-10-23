import { getSessionUser } from '@/lib/api-utils';
import prisma from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import PrintButton from "@/components/ui/PrintButton"; // سننشئه بالأسفل

// 1. تعريف النوع ليصبح Promise
interface PageProps {
  params: Promise<{ batchId: string }>;
}

export default async function ManifestPage({ params }: PageProps) {
  const user = await getSessionUser();
  if (!user || user.role !== 'ADMIN') redirect('/login');
  // 2. استخدام await لاستخراج المعرف (هذا هو حل المشكلة)
  const { batchId } = await params;

  const batch = await prisma.orderbatch.findUnique({
    where: { id: batchId },
    include: {
      seller: true,
      orders: { include: { product: true } }
    }
  });

  if (!batch) return notFound();

  return (
    <div className="p-8 max-w-[210mm] mx-auto bg-white min-h-screen text-black print:p-0">
      {/* رأس الصفحة */}
      <div className="text-center border-b pb-4 mb-6">
        <h1 className="text-3xl font-bold uppercase">WinWinCOD Delivery Manifest</h1>
        <p className="text-sm text-gray-500 mt-2">تاريخ الإصدار: {new Date().toLocaleDateString('ar-MA')}</p>
      </div>

      {/* معلومات البائع */}
      <div className="mb-6 bg-gray-50 p-4 rounded border">
        <h2 className="font-bold text-lg mb-2">معلومات البائع (المرسل):</h2>
        <div className="grid grid-cols-2 gap-4">
          <p>الاسم: {batch.seller.name}</p>
          <p>الهاتف: {batch.seller.phone || '---'}</p>
          <p>رقم الدفعة: {batch.id.slice(-8)}</p>
          <p>عدد الطرود: {batch.orders.length}</p>
        </div>
      </div>

      {/* جدول الطلبات */}
      <table className="w-full border-collapse border border-gray-300 text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">#</th>
            <th className="border p-2">اسم الزبون</th>
            <th className="border p-2">الهاتف</th>
            <th className="border p-2">العنوان / المدينة</th>
            <th className="border p-2">المنتج</th>
            <th className="border p-2 w-24">COD (درهم)</th>
            <th className="border p-2 w-24">ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {batch.orders.map((order, index) => (
            <tr key={order.id}>
              <td className="border p-2 text-center">{index + 1}</td>
              <td className="border p-2 font-bold">{order.customerName}</td>
              <td className="border p-2">{order.customerPhone}</td>
              <td className="border p-2">
                {order.city}<br/>
                <span className="text-xs text-gray-500">{order.address}</span>
              </td>
              <td className="border p-2">{order.product?.name || order.productName} ({order.quantity})</td>
              <td className="border p-2 text-center font-bold text-lg">{Number(order.codAmount).toFixed(0)}</td>
              <td className="border p-2"></td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* تذييل الصفحة */}
      <div className="mt-12 flex justify-between text-sm">
        <div className="border-t w-64 pt-2 text-center">توقيع شركة الشحن</div>
        <div className="border-t w-64 pt-2 text-center">توقيع مسؤول المخزن</div>
      </div>

      {/* زر الطباعة (مفصول في مكون خاص) */}
      <div className="mt-8 text-center print:hidden">
        <PrintButton />
      </div>
    </div>
  );
}