"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Package, Wallet, Bell, User,
  Users, BarChart3, ArrowDownCircle, Settings,
  Phone, ClipboardList,
} from "lucide-react";
import type { ReactNode } from "react";

type Role = "seller" | "admin" | "call-center";

const NAV_ITEMS: Record<Role, Array<{ label: string; icon: ReactNode; href: string }>> = {
  seller: [
    { label: "الرئيسية",  icon: <LayoutDashboard className="w-5 h-5" />, href: "/seller/dashboard"    },
    { label: "الطلبات",   icon: <Package className="w-5 h-5" />,         href: "/seller/orders"        },
    { label: "المحفظة",   icon: <Wallet className="w-5 h-5" />,          href: "/seller/wallet"        },
    { label: "الإشعارات", icon: <Bell className="w-5 h-5" />,            href: "/seller/notifications" },
    { label: "الدفعات",   icon: <Package className="w-5 h-5" />,         href: "/seller/batches"       },
  ],
  admin: [
    { label: "الرئيسية",  icon: <BarChart3 className="w-5 h-5" />,       href: "/admin/dashboard" },
    { label: "البائعين",  icon: <Users className="w-5 h-5" />,           href: "/admin/users"     },
    { label: "الطلبات",   icon: <Package className="w-5 h-5" />,         href: "/admin/orders"    },
    { label: "المالية",   icon: <ArrowDownCircle className="w-5 h-5" />, href: "/admin/deposits"  },
    { label: "الإعدادات", icon: <Settings className="w-5 h-5" />,        href: "/admin/settings"  },
  ],
  "call-center": [
    { label: "الرئيسية", icon: <LayoutDashboard className="w-5 h-5" />, href: "/call-center/dashboard" },
    { label: "الطلبات",  icon: <ClipboardList className="w-5 h-5" />,   href: "/call-center/orders"    },
    { label: "حسابي",    icon: <User className="w-5 h-5" />,            href: "/call-center/profile"   },
  ],
};

export default function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = NAV_ITEMS[role];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-100 flex md:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
      dir="rtl"
    >
      {items.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== `/${role}/dashboard` && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-1 transition-all min-h-[60px] relative"
          >
            {/* Active pill bg */}
            {isActive && (
              <span className="absolute inset-x-2 top-1.5 bottom-1.5 bg-[#4361EE]/10 rounded-2xl" />
            )}
            <span className={`relative z-10 transition-colors ${isActive ? "text-[#4361EE]" : "text-slate-400"}`}>
              {item.icon}
            </span>
            <span
              className={`relative z-10 text-[10px] font-bold leading-none transition-colors ${
                isActive ? "text-[#4361EE]" : "text-slate-400"
              }`}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
