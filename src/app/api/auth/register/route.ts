import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const registerSchema = z.object({
  name: z.string().min(3, "الاسم قصير جداً"),
  email: z.string().email("البريد الإلكتروني غير صالح"),
  password: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل"),
  phone: z.string().min(10, "رقم الهاتف مطلوب"),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validation = registerSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: validation.error.issues[0].message }, { status: 400 });
    }

    const { name, email, password, phone } = validation.data;

    // التحقق من تكرار البريد
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json({ error: "البريد الإلكتروني مستخدم بالفعل" }, { status: 400 });
    }

    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, 10);

    // إنشاء المستخدم (غير مفعل افتراضياً)
    await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        phone,
        role: "SELLER",
        isActive: false, // أهم نقطة: الحساب معطل حتى يوافق المدير
      },
    });

    return NextResponse.json({ success: true, message: "تم إنشاء الحساب، بانتظار موافقة الإدارة." });

  } catch (error) {
    console.error("[register] error:", error);
    return NextResponse.json({ error: "حدث خطأ في السيرفر" }, { status: 500 });
  }
}
