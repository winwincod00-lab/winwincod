"use client";

import { signIn, getSession } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Clock, AlertTriangle, Package, Truck, DollarSign } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "PendingApproval") setPendingApproval(true);
  }, []);

  const loginLock = useRef(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginLock.current) return;
    loginLock.current = true;
    setLoading(true); setError(''); setPendingApproval(false);
    try {
      const res = await signIn('credentials', { email, password, redirect: false });
      if (res?.error) {
        if (res.error === 'حسابك قيد المراجعة') setPendingApproval(true);
        else setError(res.error === 'CredentialsSignin' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : res.error);
        return;
      }
      const session = await getSession();
      const destinations: Record<string, string> = { CALL_CENTER: '/call-center/dashboard', ADMIN: '/admin/dashboard', SELLER: '/seller/dashboard' };
      const destination = session?.user?.role ? destinations[session.user.role] : undefined;
      if (!destination) { setError('تعذر التحقق من الجلسة. أعد المحاولة'); return; }
      window.location.href = destination;
    } catch { setError('تعذر الاتصال. تحقق من الشبكة وأعد المحاولة'); }
    finally { loginLock.current = false; setLoading(false); }
  };

  const handleGoogleLogin = async () => {
    if (loginLock.current) return;
    loginLock.current = true; setGoogleLoading(true); setError('');
    try { await signIn('google', { callbackUrl: '/auth/redirect' }); }
    catch { setError('تعذر الاتصال. تحقق من الشبكة وأعد المحاولة'); }
    finally { loginLock.current = false; setGoogleLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex" dir="rtl">
      {/* Brand Panel */}
      <div className="hidden lg:flex w-1/2 bg-[#3254D4] flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 right-10 w-64 h-64 bg-white rounded-full"></div>
          <div className="absolute bottom-10 left-10 w-48 h-48 bg-white rounded-full"></div>
        </div>
        <div className="relative z-10 text-center">
          <h1 className="text-5xl font-black text-white mb-2">WINWIN</h1>
          <h2 className="text-3xl font-black text-[#FB923C] mb-6">COD</h2>
          <p className="text-blue-100 text-lg max-w-xs leading-relaxed">
            منصة إدارة الطلبات والدفع عند التسليم للبائعين المغاربة
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4 text-center">
            {[
              { icon: <Package className="w-6 h-6 mx-auto" />, label: "طلبات" },
              { icon: <Truck className="w-6 h-6 mx-auto" />, label: "توصيل" },
              { icon: <DollarSign className="w-6 h-6 mx-auto" />, label: "أرباح" },
            ].map(({ icon, label }) => (
              <div key={label} className="bg-white/10 rounded-2xl p-4">
                <div className="text-white/80 mb-1">{icon}</div>
                <p className="text-white/80 text-xs font-bold">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="lg:hidden text-center mb-8">
            <h1 className="text-3xl font-black text-[#1E293B]">WINWIN <span className="text-[#FB923C]">COD</span></h1>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-8">
            <h2 className="text-2xl font-black text-[#1E293B] mb-1">مرحباً بعودتك</h2>
            <p className="text-slate-400 text-sm mb-8">سجل دخولك للوصول إلى لوحتك</p>

            {pendingApproval && (
              <div className="bg-orange-50 text-orange-700 p-3.5 mb-6 rounded-xl text-sm font-bold border border-orange-100 flex items-center gap-2">
                <Clock className="w-4 h-4" /> تم تسجيل طلبك بنجاح! في انتظار موافقة الإدارة.
              </div>
            )}

            {error && (
              <div className="bg-red-50 text-red-600 p-3.5 mb-6 rounded-xl text-sm font-bold border border-red-100 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-[#1E293B] mb-2">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full border border-gray-200 focus:border-[#4361EE] p-3.5 rounded-xl outline-none transition text-[#1E293B] bg-[#F8FAFC] focus:bg-white"
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-[#1E293B] mb-2">كلمة المرور</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full border border-gray-200 focus:border-[#4361EE] p-3.5 rounded-xl outline-none transition text-[#1E293B] bg-[#F8FAFC] focus:bg-white"
                  placeholder="••••••••"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#4361EE] hover:bg-[#3254D4] text-white py-3.5 rounded-xl font-bold transition shadow-sm disabled:opacity-60 mt-2"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
                    جاري التحقق...
                  </span>
                ) : "تسجيل الدخول"}
              </button>
            </form>

            <div className="flex items-center my-5">
              <hr className="flex-grow border-[#E2E8F0]" />
              <span className="mx-3 text-slate-400 text-sm">أو</span>
              <hr className="flex-grow border-[#E2E8F0]" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 border border-[#E2E8F0] p-3.5 rounded-xl hover:bg-[#F8FAFC] transition disabled:opacity-60"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span className="text-[#1E293B] font-bold">
                {googleLoading ? "جاري التحميل..." : "تسجيل الدخول بـ Google"}
              </span>
            </button>

            <p className="mt-6 text-center text-sm text-slate-400">
              ليس لديك حساب؟{" "}
              <Link href="/register" className="text-[#4361EE] font-bold hover:underline">
                انضم الآن
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
