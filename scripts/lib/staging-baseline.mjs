import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const sourceDirectory='supabase/migrations';
export const excludedMigration='20260922000029_admin_quote_access.sql';
export function sqlSource(file){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(`${sourceDirectory}/${file}`)).replace(/^\uFEFF/,'');
 if(/000004_|000010_/.test(file)&&/[\u00c3\u00c2\ufffd]/u.test(text))throw Error(`Suspected catalog encoding corruption in ${file}; refusing bootstrap.`);
 return text;
}
export const hash=text=>createHash('sha256').update(text).digest('hex');
export function buildStagingBaseline(){
 const files=readdirSync(sourceDirectory).filter(f=>f.endsWith('.sql')&&f<'20261018000031'&&f!==excludedMigration).sort();
 if(files.length!==30)throw Error('Unexpected commercial baseline inventory.');
 const app=readFileSync('src/app/seller/quote/actions.ts','utf8');
 const extra=app.match(/const extraCrossLaserAddonId = "([a-f0-9-]+)";/)?.[1];
 const double=app.match(/const doubleTimeAddonId = "([a-f0-9-]+)";/)?.[1];
 const quantity=sqlSource('20260910000026_addon_quantity_rules.sql');
 if(!extra||!double||!quantity.includes(extra)||!quantity.includes(double))throw Error('Quantity identity evidence changed; manual review required.');
 const identities=`-- STAGING ONLY: identity evidence is seller quote/actions.ts + 00026.
-- Before machine_addons references are created for these seed rows.
update public.addons set id='${extra}'::uuid where name='Laser en cruz extra';
update public.addons set id='${double}'::uuid where name='Sistema de Doble tiempo';
`;
 const sources=Object.fromEntries(files.map(f=>[f,sqlSource(f)]));
 const tables=[...new Set(Object.values(sources).flatMap(s=>[...s.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m=>m[1])))];
 const guard=`-- STAGING EMPTY DATABASE ONLY. UTF-8 without BOM. Never run on production.
-- Managed Supabase auth/storage schemas required. 00029 intentionally excluded.
set client_encoding='UTF8';
do $empty$ begin
if exists(select 1 from unnest(array[${tables.map(t=>`'${t}'`).join(',')}]) t where to_regclass('public.'||t) is not null)
then raise exception 'STAGING bootstrap requires an empty commercial schema. Use the guarded same-project staging reset.';end if;
end $empty$;
`;
 const sections=files.map(f=>{
  let text=sources[f];
  if(f==='20260820000004_initial_real_catalog.sql'){
   const marker='create temporary table _nahuitech_catalog_addon_ids (';
   if(text.split(marker).length!==2)throw Error('Initial seed anchor changed.');
   text=text.replace(marker,identities+'\n'+marker);
  }
  // A single SQL Editor submission differs from separate db.exec calls:
  // enum additions (00012) must commit before the following migration uses them.
  if(!/^\s*commit\s*;/im.test(text))text=`BEGIN;\n${text}\nCOMMIT;`;
  return `\n-- SOURCE ${f} SHA256 ${hash(sources[f])}\n${text}\n`;
 });
 // 00028 ties on created_at for batch inserts and breaks ties by random UUID.
 // Reproducible empty staging uses initial seed declaration order + station-base.
 const names=['Sistema de Doble Tiempo','Pedal Sencillo','Base de Apoyo','Sistema de Acople','Base Acoplable','Kit de Charola para Aplicaciones','Kit de Láser con Guía','Laser en cruz extra','Base para Estación'];
 const final=`
begin;
-- STAGING display order: 00004 declaration order + 00010 station-base.
update public.addons a set display_order=s.position from unnest(array[${names.map(n=>`'${n}'`).join(',')}]) with ordinality s(name,position) where a.name=s.name;
do $verify$ begin
if (select count(*) from public.machines where active)<>10 then raise exception 'Expected 10 active machines';end if;
if (select count(*) from public.addons where active)<>9 then raise exception 'Expected 9 active addons';end if;
if (select count(*) from public.machine_addons where active)<>36 then raise exception 'Expected 36 active compatibilities';end if;
if (select count(*) from public.machine_variants where active)<>9 then raise exception 'Expected 9 active variants';end if;
if (select count(distinct display_order) from public.addons)<>9 then raise exception 'Invalid display order';end if;
if (select count(*) from public.addons where name='Kit de Láser con Guía' and id is not null and calculation_type='FIXED' and unit_price=4000)<>1 then raise exception 'Missing canonical laser-guide';end if;
if (select count(*) from public.addons where id in ('${extra}'::uuid,'${double}'::uuid) and calculation_type='QUANTITY')<>2 then raise exception 'Quantity identity mapping missing';end if;
end $verify$;
commit;
`;
 return {files,sources,sql:guard+sections.join('\n')+final,identities:{extraCrossLaser:extra,doubleTime:double},displayOrder:names};
}
