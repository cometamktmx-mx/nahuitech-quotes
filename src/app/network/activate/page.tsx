import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { networkSession, activeNetworkMemberships } from "@/lib/network/server";
import { networkDestination, networkEntry } from "@/lib/network/entry";
import { activationMessages } from "@/lib/network/errors";
import { AutomaticNetworkEntry } from "@/components/network/automatic-entry";
import { selectNetworkOrganization,validateDealerActivationCode } from "../activation-actions";
import "../network.css";
export default async function Activate({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const {db,user,profile}=await networkSession();
 const {data:members,error}=await activeNetworkMemberships(db,user.id);
 const code=(await searchParams).error;
 const mode=networkEntry(members??[]);
 if(!error&&mode==="enter"&&(await cookies()).get("network_org")?.value===members![0].organization_id){
  const {data:allowed}=await db.rpc("network_access",{p_org:members![0].organization_id});
  if(allowed)redirect(networkDestination(members![0]));
 }
 return <main className="network px-5 py-10 md:py-20"><div className="mx-auto max-w-xl space-y-7">
  <p className="net-eyebrow">NAHUITECH SALES NETWORK</p>
  <h1>{error?"Acceso a Sales Network":mode==="activate"?"Activa tu dispositivo":mode==="select"?"Selecciona una organización":"Entrando a tu organización"}</h1>
  <p className="net-muted">{profile.full_name}</p>
  {(code||error)&&<p role="alert" className="net-feedback net-feedback-error">{error?activationMessages.SERVICE:activationMessages[code!]??activationMessages.INVALID}</p>}
  {!error&&mode==="activate"&&<section className="net-card"><h2 className="mb-5">Código de distribuidor</h2><form action={validateDealerActivationCode} className="net-form"><label>Código recibido de Nahuitech<input required name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} placeholder="Pega aquí tu código de activación"/></label><label>Nombre del dispositivo<input name="device_name" maxLength={100} placeholder="iPad de ventas ETM"/></label><button className="net-primary">Activar acceso</button><p className="net-muted text-xs">El código identifica tu distribuidor y registra este dispositivo con tu sesión autenticada.</p></form></section>}
  {!error&&mode==="enter"&&<section className="net-card"><h2 className="mb-5">{[members![0].organizations].flat()[0]?.name}</h2><AutomaticNetworkEntry organizationId={members![0].organization_id} automatic={!code||code==="ACCESS"}/></section>}
  {!error&&mode==="select"&&<section className="net-card"><form action={selectNetworkOrganization} className="net-form"><label>Organización<select name="organization_id">{members!.map(m=><option key={m.organization_id} value={m.organization_id}>{[m.organizations].flat()[0]?.name}</option>)}</select></label><button className="net-primary">Entrar a organización</button></form></section>}
  <Link href="/seller" className="net-muted text-sm">← Volver al cotizador</Link>
 </div></main>;
}
