"use server";
import { networkLog } from "@/lib/network/observability";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { networkSession, requireNetwork, activeNetworkMemberships } from "@/lib/network/server";
import { networkDestination } from "@/lib/network/entry";

async function deviceId() {
  const jar = await cookies();
  return jar.get("network_device")?.value ?? randomUUID();
}
async function remember(org:string,device:string) {
  const jar=await cookies();
  const options={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/",maxAge:60*60*24*365};
  jar.set("network_org",org,options); jar.set("network_device",device,options);
}
export async function validateDealerActivationCode(form:FormData) {
  const started=Date.now();
  const {db,user}=await networkSession();
  const memberships=await activeNetworkMemberships(db,user.id);
  if(memberships.error)redirect("/network/activate?error=SERVICE");
  if(memberships.data?.length)redirect("/network/activate");
  const code=String(form.get("code")??"").trim();
  const device=await deviceId();
  const {data,error}=await db.rpc("network_activate_result",{p_hash:createHash("sha256").update(code).digest("hex"),p_device:device,p_name:String(form.get("device_name")??"Mi dispositivo").slice(0,100)});
  networkLog("activation",!error&&data?.status==="OK",started);
  if(error || !data) redirect("/network/activate?error=SERVICE");
  if(data.status!=="OK") redirect(`/network/activate?error=${encodeURIComponent(data.status)}`);
  await remember(data.organization_id,device); redirect("/network");
}
export async function selectNetworkOrganization(form:FormData) {
  const {db,user}=await networkSession(); const org=String(form.get("organization_id")); const device=await deviceId();
  const {data:members,error:membershipError}=await activeNetworkMemberships(db,user.id);
  if(membershipError) redirect("/network/activate?error=SERVICE");
  const member=members?.find(m=>m.organization_id===org);
  if(!member) redirect("/network/activate?error=INACTIVE");
  const {error}=await db.rpc("network_register_device",{p_org:org,p_device:device});
  if(error) redirect(`/network/activate?error=${error.message.includes('revocado')?'REVOKED':error.message.includes('Membresía')?'INACTIVE':'SERVICE'}`);
  await remember(org,device); redirect(networkDestination(member));
}
export async function issueActivationCode(_state:{code?:string;error?:string},form:FormData) {
  const {db}=await requireNetwork(true); const code=randomBytes(32).toString("hex");
  const {error}=await db.rpc("network_issue_code",{p_org:String(form.get("organization_id")),p_hash:createHash("sha256").update(code).digest("hex")});
  return error ? {error:"No se pudo emitir el código."} : {code};
}
