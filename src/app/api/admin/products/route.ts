import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);

    const body = await req.json();
    const { name, sku, supplierId, costPrice, sellerPrice, marketPrice, stock, images } = body;

    const newProduct = await prisma.product.create({
  data: {
    name,
    sku,
    supplierId,
    costPrice: Number(costPrice),
    sellerPrice: Number(sellerPrice),
    marketPrice: Number(marketPrice),
    stock: Number(stock),
    images: images, 
    updatedAt: new Date(),
  },
});

    return NextResponse.json({ success: true, product: newProduct });
  } catch (error: any) {
    console.error(error);
    return errorResponse("فشل إضافة المنتج: " + error.message, 500);
  }
}

// جلب المنتجات (ليستخدمها البائع والمدير)
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);
  const products = await prisma.product.findMany({
    include: { supplier: { select: { name: true } } }
  });
  return NextResponse.json({ success: true, products });
}
