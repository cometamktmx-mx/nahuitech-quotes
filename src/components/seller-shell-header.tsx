import Link from "next/link";

import { BrandMark } from "@/components/ui";
import { networkClient, activeNetworkMemberships } from "@/lib/network/server";

import { SellerSessionControls } from "./seller-session-controls";
import { SellerOfflineStatus } from "./seller-offline-status";
import { SellerAttendingControl } from "./seller-attending-control";

export async function SellerShellHeader({
  userName,
  accountRole,
}: {
  userName: string;
  accountRole: "admin" | "seller" | "expo";
}) {
  // Membership affects only the label; Network being unavailable never blocks quoting.
  let networkActive=false;
  try {
    const db=await networkClient();const {data}=await db.auth.getUser();
    if(data.user){const result=await activeNetworkMemberships(db,data.user.id);networkActive=!result.error&&!!result.data?.length;}
  } catch {}
  return (
    <header className="border-b border-on-graphite/10 bg-graphite text-on-graphite">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link className="shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary" href="/seller">
            <span className="[&>div>span:last-child]:text-on-graphite"><BrandMark /></span>
          </Link>
          <span className="hidden h-8 w-px bg-on-graphite/15 sm:block" />
          <p className="text-sm font-semibold text-on-graphite-muted">Cotizador Expo</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 sm:justify-end">
          <Link className="text-sm font-bold text-primary" href="/network">{networkActive?"Sales Network":"Activar Sales Network"}</Link>
          {accountRole === "admin" ? <Link className="text-sm font-bold text-primary" href="/admin">Admin</Link> : null}
          <SellerOfflineStatus />
          <SellerAttendingControl accountRole={accountRole} userName={userName} />
          <SellerSessionControls />
        </div>
      </div>
    </header>
  );
}
