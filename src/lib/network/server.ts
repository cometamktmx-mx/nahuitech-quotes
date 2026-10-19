import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

export async function networkClient() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { "x-network-device": jar.get("network_device")?.value ?? "" } },
    cookies: { getAll: () => jar.getAll(), setAll(values) { try { values.forEach(({name,value,options}) => jar.set(name,value,options)); } catch {} } },
  });
}
export async function networkSession() {
  const db = await networkClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) redirect("/login");
  const {data: profile} = await db.from("profiles").select("id,active,full_name").eq("id",data.user.id).single();
  if (!profile?.active) redirect("/login");
  return {db,user: data.user,profile};
}
export const requireNetwork = cache(async (hq = false) => {
  const session = await networkSession();
  const org = (await cookies()).get("network_org")?.value;
  if (!org) redirect("/network/activate");
  const { data: allowed, error } = await session.db.rpc("network_access", {p_org:org});
  if (error) throw new Error("Sales Network no está disponible. Verifica las migraciones locales antes de habilitarlo.");
  if (!allowed) redirect("/network/activate?error=ACCESS");
  await session.db.rpc("network_touch_device");
  const {data: owner} = await session.db.rpc("is_network_owner");
  if (hq && !owner) redirect("/network");
  const {data: organization} = await session.db.from("organizations").select("id,name,display_name,primary_color,logo_url").eq("id",org).single();
  return {...session,org,owner:Boolean(owner),organization};
});
