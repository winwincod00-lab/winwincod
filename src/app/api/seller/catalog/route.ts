import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

// 1. إضافة منتج لقائمة "منتجاتي"
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

    const { productId } = await req.json();

    // التحقق هل المنتج مضاف مسبقاً؟
    const exists = await prisma.sellerProduct.findUnique({
      where: {
        sellerId_productId: { sellerId: user.id, productId }
      }
    });

    if (exists) return errorResponse("المنتج مضاف بالفعل لقائمتك", 400);

    await prisma.sellerProduct.create({
      data: {
        sellerId: user.id,
        productId
      }
    });

    return NextResponse.json({ success: true, message: "تمت الإضافة لقائمة منتجاتي" });
  } catch (error) {
    return errorResponse("حدث خطأ", 500);
  }
}

// 2. جلب قائمة "منتجاتي" الخاصة بالبائع
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "SELLER") return errorResponse("غير مصرح", 401);

  const myProducts = await prisma.sellerProduct.findMany({
    where: { sellerId: user.id },
    include: {
      product: { select: { id: true, name: true, images: true, sku: true, sellerPrice: true, marketPrice: true, stock: true } }
    },
    orderBy: { addedAt: 'desc' }
  });

  return NextResponse.json({ success: true, products: myProducts });
}