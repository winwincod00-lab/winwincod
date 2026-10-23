import { getSessionUser } from '@/lib/api-utils';
import prisma from "@/lib/prisma";
import { productImages } from "@/lib/product-images";
import { notFound, redirect } from "next/navigation";
import AddToCatalogButton from "./AddToCatalogButton"; // سننشئه بالأسفل

// هذه الصفحة (Server Component) لجلب البيانات بسرعة SEO
export default async function ProductDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();

  if (!user || user.role !== "SELLER") redirect("/login");

  const product = await prisma.product.findUnique({
    where: { id },
    include: { supplier: { select: { name: true } } }
  });

  if (!product) return notFound();

  // التحقق هل المنتج مضاف مسبقاً لهذا البائع؟
  const isAdded = await prisma.sellerProduct.findUnique({
    where: {
      sellerId_productId: {
        sellerId: user.id,
        productId: id
      }
    }
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* قسم العنوان والزر */}
      <div className="flex justify-between items-start bg-white p-6 rounded-xl shadow-sm">
        <div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">{product.name}</h1>
            <p className="text-gray-500">الرمز: <span className="font-mono bg-gray-100 px-2 py-1 rounded">{product.sku}</span></p>
        </div>
        <div>
            {/* زر الإضافة (Client Component) */}
            <AddToCatalogButton productId={product.id} isAlreadyAdded={!!isAdded} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* قسم الصور */}
        <div className="bg-white p-2 rounded-xl shadow-sm h-[450px] overflow-hidden border">
  {productImages(product.images).length > 0 ? (
    <img 
      src={productImages(product.images)[0]}
      alt={product.name} 
      className="w-full h-full object-contain" 
    />
  ) : (
    <div className="flex items-center justify-center h-full text-6xl bg-gray-50 text-gray-200">
      لا توجد صورة
    </div>
  )}
</div>

        {/* قسم التفاصيل والأسعار */}
        <div className="md:col-span-2 space-y-6">
            
            {/* بطاقة الأسعار */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 p-5 rounded-xl border border-blue-100">
                    <p className="text-sm text-blue-600 mb-1 font-bold">تكلفتك (سعر البائع)</p>
                    <p className="text-3xl font-bold text-blue-900">{Number(product.sellerPrice).toFixed(0)} د.م</p>
                </div>
                <div className="bg-green-50 p-5 rounded-xl border border-green-100">
                    <p className="text-sm text-green-600 mb-1 font-bold">سعر السوق المقترح</p>
                    <p className="text-3xl font-bold text-green-900">{Number(product.marketPrice).toFixed(0)} د.م</p>
                </div>
            </div>

            {/* الوصف */}
            <div className="bg-white p-6 rounded-xl shadow-sm">
                <h3 className="font-bold text-lg mb-4">وصف المنتج</h3>
                <div className="prose max-w-none text-gray-600 leading-relaxed whitespace-pre-line">
                    {product.description || "لا يوجد وصف متوفر لهذا المنتج."}
                </div>
            </div>

            {/* المخزون */}
            <div className="bg-white p-6 rounded-xl shadow-sm flex justify-between items-center">
                <span className="font-bold">حالة المخزون:</span>
                <span className={`px-4 py-2 rounded-lg font-bold ${product.stock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {product.stock > 0 ? `متوفر (${product.stock} قطعة)` : 'نفذت الكمية'}
                </span>
            </div>
        </div>
      </div>
    </div>
  );
}