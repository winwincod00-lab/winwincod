import { getSessionUser } from '@/lib/api-utils';
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";

const roleBadge: Record<string, string> = {
  ADMIN:       "bg-red-50 text-red-600 border border-red-100",
  CALL_CENTER: "bg-purple-50 text-purple-600 border border-purple-100",
  SELLER:      "bg-[#EEF2FF] text-[#4361EE] border border-blue-100",
};
const roleLabel: Record<string, string> = { ADMIN: "مدير", CALL_CENTER: "كول سنتر", SELLER: "بائع" };

export default async function AdminUsersPage() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") redirect("/login");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { wallet: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl md:text-2xl font-black text-[#1E293B]">إدارة المستخدمين</h2>
          <p className="text-slate-400 text-sm mt-0.5">إجمالي: {users.length} مستخدم مسجل</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
        {/* Desktop table */}
        <table className="hidden md:table w-full text-right text-sm">
          <thead>
            <tr className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-slate-500 font-bold">
              <th className="p-4">الاسم</th>
              <th className="p-4">البريد</th>
              <th className="p-4">الرتبة</th>
              <th className="p-4">رصيد المحفظة</th>
              <th className="p-4">الحالة</th>
              <th className="p-4">تاريخ التسجيل</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC] transition">
                <td className="p-4 font-bold text-[#1E293B]">{u.name}</td>
                <td className="p-4 text-slate-500">{u.email}</td>
                <td className="p-4">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${roleBadge[u.role] || "bg-gray-100 text-gray-600"}`}>
                    {roleLabel[u.role] || u.role}
                  </span>
                </td>
                <td className="p-4 font-bold text-[#1E293B]">
                  {u.wallet?.balance ? Number(u.wallet.balance).toFixed(2) : "0.00"}{" "}
                  <span className="text-slate-400 font-normal">د.م</span>
                </td>
                <td className="p-4">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${u.isActive ? "bg-green-50 text-green-700 border border-green-100" : "bg-gray-100 text-gray-500"}`}>
                    {u.isActive ? "نشط" : "موقوف"}
                  </span>
                </td>
                <td className="p-4 text-slate-400">{new Date(u.createdAt).toLocaleDateString("ar-MA")}</td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={6} className="p-10 text-center text-slate-400">لا يوجد مستخدمون مسجلون.</td></tr>
            )}
          </tbody>
        </table>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-[#E2E8F0]">
          {users.length === 0 && (
            <p className="p-8 text-center text-slate-400">لا يوجد مستخدمون مسجلون.</p>
          )}
          {users.map(u => (
            <div key={u.id} className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#4361EE] text-white font-black text-sm flex items-center justify-center flex-shrink-0">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-[#1E293B] truncate">{u.name}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${u.isActive ? "bg-green-50 text-green-700 border border-green-100" : "bg-gray-100 text-gray-500"}`}>
                    {u.isActive ? "نشط" : "موقوف"}
                  </span>
                </div>
                <p className="text-slate-500 text-xs truncate">{u.email}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${roleBadge[u.role] || "bg-gray-100 text-gray-600"}`}>
                    {roleLabel[u.role] || u.role}
                  </span>
                  <span className="text-xs font-bold text-[#1E293B]">
                    {u.wallet?.balance ? Number(u.wallet.balance).toFixed(2) : "0.00"}{" "}
                    <span className="text-slate-400 font-normal">د.م</span>
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {new Date(u.createdAt).toLocaleDateString("ar-MA")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
