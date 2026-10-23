import { getSessionUser } from '@/lib/api-utils';
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

export default async function RedirectPage() {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  const role = user.role;

  if (role === "ADMIN") redirect("/admin/dashboard");
  if (role === "CALL_CENTER") redirect("/call-center/dashboard");
  redirect("/seller/dashboard");
}
