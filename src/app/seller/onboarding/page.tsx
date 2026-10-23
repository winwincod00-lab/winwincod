"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  Rocket, Package, DollarSign, User, BookOpen,
  Megaphone, Phone, Lightbulb, CheckCircle,
  CreditCard
} from "lucide-react";
import Image from "next/image";
import axios from "axios";
import CitySelector from "@/components/CitySelector";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileForm {
  name: string;
  phone: string;
  city: string;
  storeName: string;
  storeDescription: string;
  storeLink: string;
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-400">الخطوة {step} من {total}</span>
        <span className="text-xs font-bold text-[#4361EE]">{Math.round((step / total) * 100)}%</span>
      </div>
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#4361EE] rounded-full transition-all duration-500 ease-out"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

function Step1({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6 animate-fade-in">
      {/* Logo */}
      <div className="bg-[#4361EE] rounded-2xl p-4 shadow-lg shadow-blue-200">
        <Image src="/logo-white.svg" alt="WinWinCOD" width={120} height={40} priority />
      </div>

      {/* Headline */}
      <div>
        <h1 className="text-3xl md:text-4xl font-black text-[#1E293B] leading-tight">
          مرحباً بك في<br />
          <span className="text-[#4361EE]">WinWinCOD</span>
        </h1>
        <p className="text-slate-500 text-base mt-3 font-medium">
          منصة التجارة الإلكترونية بالدفع عند الاستلام
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
        {[
          {
            icon: <Rocket className="w-8 h-8 text-[#4361EE] mx-auto" />,
            title: "ابدأ بدون رأس مال",
            desc: "لا تحتاج دفع مسبق للمنتجات",
            color: "from-blue-50 to-indigo-50 border-blue-100",
          },
          {
            icon: <Package className="w-8 h-8 text-orange-500 mx-auto" />,
            title: "شحن سريع",
            desc: "توصيل لجميع مدن المغرب",
            color: "from-orange-50 to-amber-50 border-orange-100",
          },
          {
            icon: <DollarSign className="w-8 h-8 text-green-500 mx-auto" />,
            title: "أرباح مضمونة",
            desc: "استلم أرباحك بعد كل تسليم",
            color: "from-green-50 to-emerald-50 border-green-100",
          },
        ].map((f) => (
          <div
            key={f.title}
            className={`bg-gradient-to-br ${f.color} border rounded-2xl p-4 text-center`}
          >
            <span className="block mb-3">{f.icon}</span>
            <p className="font-black text-[#1E293B] text-sm mb-1">{f.title}</p>
            <p className="text-slate-500 text-xs leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="w-full bg-[#4361EE] hover:bg-[#3254D4] text-white font-black text-lg py-4 rounded-2xl transition shadow-lg shadow-blue-200 flex items-center justify-center gap-2 min-h-[60px]"
      >
        ابدأ الآن
        <span className="text-xl">←</span>
      </button>
    </div>
  );
}

// ─── Step 2: Profile form ─────────────────────────────────────────────────────

function Step2({
  form,
  onChange,
  onNext,
}: {
  form: ProfileForm;
  onChange: (f: Partial<ProfileForm>) => void;
  onNext: () => void;
}) {
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileForm, string>>>({});

  const validate = () => {
    const e: typeof errors = {};
    if (!form.name.trim() || form.name.trim().length < 2)
      e.name = "الاسم مطلوب (حرفان على الأقل)";
    if (!/^(06|07)\d{8}$/.test(form.phone.replace(/\s/g, "")))
      e.phone = "رقم الهاتف غير صحيح (06XXXXXXXX أو 07XXXXXXXX)";
    if (!form.city) e.city = "يرجى اختيار المدينة";
    if (!form.storeName.trim() || form.storeName.trim().length < 2)
      e.storeName = "اسم المتجر مطلوب";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => { if (validate()) onNext(); };

  const field = (
    key: keyof ProfileForm,
    label: string,
    placeholder: string,
    required = true,
    type = "text",
  ) => (
    <div>
      <label className="text-xs font-bold text-slate-500 block mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        type={type}
        value={form[key]}
        onChange={(e) => { onChange({ [key]: e.target.value }); setErrors((ev) => ({ ...ev, [key]: undefined })); }}
        placeholder={placeholder}
        className={`w-full border ${errors[key] ? "border-red-400 bg-red-50" : "border-[#E2E8F0] bg-[#F8FAFC]"} focus:border-[#4361EE] focus:bg-white p-3.5 rounded-xl outline-none text-sm font-medium transition`}
      />
      {errors[key] && <p className="text-red-500 text-xs mt-1 font-medium">{errors[key]}</p>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="text-center mb-2">
        <User className="w-10 h-10 text-[#4361EE] mx-auto" />
        <h2 className="text-2xl font-black text-[#1E293B] mt-2">أكمل ملفك الشخصي</h2>
        <p className="text-slate-400 text-sm mt-1">هذه المعلومات تساعدنا على خدمتك بشكل أفضل</p>
      </div>

      {field("name",      "الاسم الكامل",   "محمد أحمد")}
      {field("phone",     "رقم الهاتف",     "06XXXXXXXX", true, "tel")}

      {/* City dropdown */}
      <div>
        <label className="text-xs font-bold text-slate-500 block mb-1.5">
          المدينة <span className="text-red-500">*</span>
        </label>
        <CitySelector
          value={form.city}
          onChange={(city) => { onChange({ city }); setErrors((ev) => ({ ...ev, city: undefined })); }}
          error={!!errors.city}
        />
        {errors.city && <p className="text-red-500 text-xs mt-1 font-medium">{errors.city}</p>}
      </div>

      {field("storeName", "اسم المتجر",     "متجر الفردوس")}

      {/* Store description (optional) */}
      <div>
        <label className="text-xs font-bold text-slate-500 block mb-1.5">
          وصف المتجر <span className="text-slate-300">(اختياري)</span>
        </label>
        <textarea
          value={form.storeDescription}
          onChange={(e) => onChange({ storeDescription: e.target.value })}
          placeholder="صف متجرك باختصار..."
          rows={3}
          className="w-full border border-[#E2E8F0] bg-[#F8FAFC] focus:border-[#4361EE] focus:bg-white p-3.5 rounded-xl outline-none text-sm font-medium transition resize-none"
        />
      </div>

      {/* Store link (optional) */}
      <div>
        <label className="text-xs font-bold text-slate-500 block mb-1.5">
          رابط الموقع أو صفحة التواصل <span className="text-slate-300">(اختياري)</span>
        </label>
        <input
          type="url"
          value={form.storeLink}
          onChange={(e) => onChange({ storeLink: e.target.value })}
          placeholder="https://www.instagram.com/متجرك أو رابط الموقع"
          className="w-full border border-[#E2E8F0] bg-[#F8FAFC] focus:border-[#4361EE] focus:bg-white p-3.5 rounded-xl outline-none text-sm font-medium transition"
          dir="ltr"
        />
      </div>

      <button
        onClick={handleNext}
        className="w-full bg-[#4361EE] hover:bg-[#3254D4] text-white font-black text-lg py-4 rounded-2xl transition shadow-lg shadow-blue-200 flex items-center justify-center gap-2 min-h-[60px]"
      >
        التالي <span className="text-xl">←</span>
      </button>
    </div>
  );
}

// ─── Step 3: How it works ─────────────────────────────────────────────────────

function Step3({ onNext }: { onNext: () => void }) {
  const steps = [
    { icon: <Package className="w-5 h-5 text-[#4361EE]" />,    title: "اختر منتجك",           desc: "تصفح الكتالوج واختر المنتج المناسب لجمهورك - السعر والتكلفة محددين مسبقاً" },
    { icon: <Megaphone className="w-5 h-5 text-[#4361EE]" />,  title: "سوّق وسجل الطلبات",    desc: "روّج للمنتج بطريقتك (سوشيال ميديا، إعلانات...) وسجل طلبات عملائك في المنصة" },
    { icon: <Phone className="w-5 h-5 text-[#4361EE]" />,      title: "أرسل الطلب للتأكيد",     desc: "راجع الهاتف والعنوان ثم أرسل المسودة للتأكيد. لا تنتقل للشحن قبل التأكيد" },
    { icon: <DollarSign className="w-5 h-5 text-[#4361EE]" />, title: "أرسل للمراجعة ثم ادفع بعد القبول",   desc: "اجمع 5 وحدات من الطلبات المؤكدة والمؤهلة على الأقل وأرسلها لمراجعة الإدارة دون دفع. بعد القبول الصريح ادفع تكلفة الدفعة ثم تابع تجهيز المستودع. راجع المحفظة للربح المسجل بعد التسليم" },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <BookOpen className="w-10 h-10 text-[#4361EE] mx-auto" />
        <h2 className="text-2xl font-black text-[#1E293B] mt-2">كيف تعمل المنصة؟</h2>
        <p className="text-slate-400 text-sm mt-1">من اختيار المنتج إلى متابعة التسليم والتسوية</p>
      </div>

      {/* Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-stretch">
        {steps.map((s, i) => (
          <div
            key={i}
            className="h-full flex flex-col gap-3 bg-white border border-[#E2E8F0] rounded-2xl p-4 transition-all duration-200 hover:border-[#4361EE]/30 hover:shadow-md hover:shadow-blue-100/60"
          >
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-[#4361EE]/10 flex items-center justify-center flex-shrink-0">
                {s.icon}
              </div>
              <div className="w-6 h-6 rounded-full bg-[#4361EE] text-white font-black text-[11px] flex items-center justify-center flex-shrink-0">
                {i + 1}
              </div>
            </div>
            <div>
              <p className="font-black text-[#1E293B] text-sm leading-snug">{s.title}</p>
              <p className="text-slate-400 text-xs mt-1 leading-relaxed">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pricing example */}
      <div className="bg-gradient-to-br from-[#4361EE] to-[#3254D4] rounded-2xl p-5 text-white">
        <p className="font-black text-base mb-4 flex items-center gap-2">
          <Lightbulb className="w-5 h-5" /> مثال توضيحي فقط — ليس رصيد حسابك
        </p>
        <div className="space-y-2.5">
          {[
            { label: "سعر البيع",     value: "150 درهم", color: "text-white", op: "" },
            { label: "تكلفة المنتج", value: "60 درهم",  color: "text-red-300", op: "−" },
            { label: "رسوم الشحن",   value: "20 درهم",  color: "text-red-300", op: "−" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between">
              <span className="text-blue-100 text-sm font-medium">{row.label}</span>
              <span className={`font-black text-base ${row.color}`}>
                {row.op} {row.value}
              </span>
            </div>
          ))}
          <div className="border-t border-white/20 pt-2.5 flex items-center justify-between">
            <span className="text-white font-black flex items-center gap-1"><CheckCircle className="w-4 h-4" /> نتيجة المثال قبل أي تسويات أخرى</span>
            <span className="text-green-300 font-black text-xl">70 درهم</span>
          </div>
        </div>
      </div>

      <button
        onClick={onNext}
        className="w-full bg-[#4361EE] hover:bg-[#3254D4] text-white font-black text-lg py-4 rounded-2xl transition shadow-lg shadow-blue-200 flex items-center justify-center gap-2 min-h-[60px]"
      >
        فهمت! التالي <span className="text-xl">←</span>
      </button>
    </div>
  );
}

// ─── Step 4: Wallet funding ───────────────────────────────────────────────────

function Step4({
  onComplete,
  submitting,
}: {
  onComplete: (goWallet: boolean) => void;
  submitting: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <DollarSign className="w-10 h-10 text-[#4361EE] mx-auto" />
        <h2 className="text-2xl font-black text-[#1E293B] mt-2">شحن المحفظة</h2>
        <p className="text-slate-400 text-sm mt-1 leading-relaxed">
          يمكنك حفظ المسودات دون رصيد. تحتاج رصيداً كافياً عند دفع دفعة مقبولة من الإدارة تضم 5 وحدات من الطلبات المؤكدة والمؤهلة على الأقل
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
        <h3 className="font-bold">المبلغ المطلوب يعتمد على طلباتك</h3>
        <p>راجع تكلفة المنتجات ورسوم الدفعة الفعلية قبل الدفع. لا يوجد مبلغ ثابت يضمن كفاية الرصيد لكل دفعة.</p>
        <p>استخدم المحفظة لطلب الشحن ومتابعة المراجعة. احصل على تعليمات التحويل المؤكدة من الإدارة قبل إرسال المال؛ لا تحول إلى حساب غير متحقق منه.</p>
        <p>الدفع لا يعني الإرسال إلى شركة التوصيل. الإرسال يتم عبر إجراء المستودع المصرح به.</p>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => onComplete(true)}
          disabled={submitting}
          className="w-full bg-[#FB923C] hover:bg-orange-500 disabled:opacity-60 text-white font-black text-lg py-4 rounded-2xl transition shadow-lg shadow-orange-200 flex items-center justify-center gap-2 min-h-[60px]"
        >
          {submitting ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              شحن المحفظة الآن
            </>
          )}
        </button>

        <button
          onClick={() => onComplete(false)}
          disabled={submitting}
          className="w-full border-2 border-[#E2E8F0] text-slate-500 hover:border-[#4361EE] hover:text-[#4361EE] font-bold text-base py-3.5 rounded-2xl transition flex items-center justify-center gap-2 min-h-[52px]"
        >
          سأشحنها لاحقاً — ابدأ بالاستكشاف
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    name: "",
    phone: "",
    city: "",
    storeName: "",
    storeDescription: "",
    storeLink: "",
  });

  // Pre-fill name from session
  useEffect(() => {
    if (session?.user?.name && !form.name) {
      setForm((f) => ({ ...f, name: session.user!.name! }));
    }
  }, [session]);

  const updateForm = (patch: Partial<ProfileForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  const completeOnboarding = async (goWallet: boolean) => {
    setSubmitting(true);
    setApiError(null);
    try {
      await axios.post("/api/seller/onboarding", {
        name:             form.name,
        phone:            form.phone,
        city:             form.city,
        storeName:        form.storeName,
        storeDescription: form.storeDescription,
        storeLink:        form.storeLink,
      });

      // Refresh JWT so middleware sees hasCompletedOnboarding = true
      await update();

      router.push(goWallet ? "/seller/wallet" : "/seller/dashboard");
    } catch (err: any) {
      setApiError(err.response?.data?.error || "حدث خطأ، حاول مجدداً");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#EEF2FF] flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-lg">
        {/* Progress bar (hidden on step 1) */}
        {step > 1 && (
          <div className="mb-6">
            <ProgressBar step={step} total={4} />
          </div>
        )}

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl shadow-blue-100/50 p-6 md:p-8">
          {/* Step 1 logo shown inside card; other steps show back button */}
          {step > 1 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex items-center gap-1.5 text-slate-400 hover:text-[#4361EE] text-sm font-bold mb-5 transition"
            >
              <span className="text-base">→</span> رجوع
            </button>
          )}

          {step === 1 && <Step1 onNext={() => setStep(2)} />}
          {step === 2 && (
            <Step2
              form={form}
              onChange={updateForm}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && <Step3 onNext={() => setStep(4)} />}
          {step === 4 && (
            <Step4 onComplete={completeOnboarding} submitting={submitting} />
          )}

          {/* API error */}
          {apiError && step === 4 && (
            <div className="mt-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-red-600 text-sm font-bold text-center">
              {apiError}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-4 font-medium">
          WinWinCOD © {new Date().getFullYear()} — جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
}
