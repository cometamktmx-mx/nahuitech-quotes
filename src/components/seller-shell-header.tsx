import Link from "next/link";

import { BrandMark } from "@/components/ui";

import { SellerSessionControls } from "./seller-session-controls";
import { SellerOfflineStatus } from "./seller-offline-status";

export function SellerShellHeader({ userName }: { userName: string }) {
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
          <SellerOfflineStatus />
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-bold text-on-graphite">{userName}</p>
            <p className="text-xs text-on-graphite-muted">Vendedor</p>
          </div>
          <SellerSessionControls />
        </div>
      </div>
    </header>
  );
}
