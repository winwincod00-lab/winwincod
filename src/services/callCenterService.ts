// src/services/callCenterService.ts
import prisma from "@/lib/prisma";
import type { order_status } from "@prisma/client";

export async function updateOrderItemStatus(orderId: string, newStatus: order_status, notes?: string) {
  // يمكن هنا إضافة منطق لحساب تكلفة الطلب إذا تم تأكيده
  // مثلاً: عند تحويله لـ CONFIRMED، نقوم بتثبيت سعر المنتج في الطلب
  
  const order = await prisma.order.update({
    where: { id: orderId },
    data: { 
      status: newStatus,
      // يمكن إضافة حقل للملاحظات في قاعدة البيانات مستقبلاً (CallLogs)
    }
  });

  // إذا تم تأكيد كل طلبات الدفعة، نقوم بتحديث حالة الدفعة إلى WAITING_PAYMENT
  // هذا المنطق يمكن إضافته هنا
  
  return order;
}
