import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser, errorResponse } from "@/lib/api-utils";

// 1. جلب بيانات منتج واحد (لغرض التعديل)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  return NextResponse.json(product);
}

// 2. تحديث بيانات المنتج
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);

    const { id } = await params;
    const body = await req.json();

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: {
        name: body.name,
        sku: body.sku,
        supplierId: body.supplierId,
        costPrice: Number(body.costPrice),
        sellerPrice: Number(body.sellerPrice),
        marketPrice: Number(body.marketPrice),
        stock: Number(body.stock),
        images: body.images,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, product: updatedProduct });
  } catch (error) {
    return errorResponse("فشل التحديث", 500);
  }
}

// 3. حذف المنتج
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user || user.role !== "ADMIN") return errorResponse("غير مصرح", 401);

    const { id } = await params;

    // ملاحظة: لا يمكن حذف منتج إذا كان مرتبطاً بطلبات حالية (Constraint)
    // في النظام الحقيقي نستخدم Soft Delete، هنا سنقوم بالحذف المباشر
    await prisma.product.delete({ where: { id } });

    return NextResponse.json({ success: true, message: "تم حذف المنتج نهائياً" });
  } catch (error) {
    return errorResponse("لا يمكن حذف المنتج لأنه مرتبط بطلبات سابقة", 400);
  }
}
