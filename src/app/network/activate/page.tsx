import Link from "next/link";
import { networkSession } from "@/lib/network/server";
import { activationMessages } from "@/lib/network/errors";
import { selectNetworkOrganization,validateDealerActivationCode } from "../activation-actions";
import "../network.css";
export default async function Activate({searchParams}:{searchParams:Promise<{error?:string}>}) {
 const {db,user,profile}=await networkSession();
 const {data:members,error}=await db.from("organization_memberships").select("organization_id,organizations(name)").eq("user_id",user.id).eq("active",true);
 const code=(await searchParams).error;
 return <main className="network px-5 py-10 md:py-20"><div className="mx-auto max-w-xl space-y-7">
  <p className="net-eyebrow">NAHUITECH SALES NETWORK</p><h1>Activa tu dispositivo</h1><p className="net-muted">Conecta tu sesión de {profile.full_name} con la organización que te invitó.</p>
  {(code||error)&&<p role="alert" className="net-feedback net-feedback-error">{error?activationMessages.SERVICE:activationMessages[code!]??activationMessages.INVALID}</p>}
  <section className="net-card"><h2 className="mb-5">Código de distribuidor</h2><form action={validateDealerActivationCode} className="net-form"><label>Código recibido de Nahuitech<input required name="code" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={128} placeholder="Pega aquí tu código de activación"/></label><label>Nombre del dispositivo<input name="device_name" maxLength={100} placeholder="iPad de ventas ETM"/></label><button className="net-primary">Activar acceso</button><p className="net-muted text-xs">Tu sesión Auth ya está verificada. Este código solo habilita la membresía y registra el dispositivo.</p></form></section>
  {!!members?.length?<section className="net-card"><h2 className="mb-5">Ya tienes una membresía</h2><form action={selectNetworkOrganization} className="net-form"><label>Organización<select name="organization_id">{members.map(m=><option key={m.organization_id} value={m.organization_id}>{(m.organizations as unknown as {name:string})?.name}</option>)}</select></label><button>Entrar a organización</button></form></section>:!error&&<p className="net-muted text-sm">Todavía no tienes una organización activa. Solicita tu código a Nahuitech para continuar.</p>}
  <Link href="/seller" className="net-muted text-sm">← Volver al cotizador</Link>
 </div></main>;
}
