# Sales Network — staging real para Camilo

**Corrección 19 octubre:** el baseline combinado anterior quedó corrupto por codificación. Regenerar con Node y usar exclusivamente el bootstrap consolidado nuevo; no concatenar archivos en PowerShell. Ver [investigación, corrección y recuperación del staging parcial](sales-network-staging-bootstrap.md).

Estado de entrega: preparación local; **ninguna conexión, migración, seed, reset o deployment remoto ejecutado**. No se puede certificar el estado de un staging que aún no se inspeccionó. Features congeladas. Rama local: `feat/sales-network-beta`. No usar main para esta demo.

Validación local final: **136 tests aprobados, 0 fallos/omitidos** (~8.3 s), `npx tsc --noEmit` correcto, lint sin errores salvo warning histórico de `<img>`, `npm run build` correcto (compilación 2.6 s, TypeScript 7.8 s). Build ejecutado con valores ficticios explícitos de Supabase y Twilio vacío, sin usar credenciales reales para escrituras. El reset se probó también contra PostgreSQL aislado con foreign keys reales, dos ejecuciones consecutivas y conservación de registros ajenos. Los tiempos no representan latencia remota; E2E Auth/Storage y latencias staging siguen pendientes.

## A. Identificar el destino antes de cualquier escritura

1. Seleccionar el MISMO proyecto Supabase staging existente; no crear otro. Anotar su project ref (20 caracteres) desde Project Settings y comprobar la URL del dashboard `/project/<ref>`. El nombre visible no basta.
2. Anotar por separado el project ref de producción como identificador de exclusión (no es una credencial). Deben ser distintos.
3. URL de API, publishable key, secret key y conexión SQL deben provenir exclusivamente del staging. Nunca copiar secrets de `.env.local` ni usar la conexión guardada por defecto en una CLI.
4. Confirmar rama con `git branch --show-current`. Debe imprimir `feat/sales-network-beta`. No push ni deploy durante esta preparación.
5. Cada sesión SQL debe abrirse desde el dashboard del ref staging verificado. Si se usa psql, copiar la conexión desde Connect del staging; verificar hostname/ref, usuario y proyecto antes de ejecutar. `current_database()` suele devolver postgres en ambos proyectos: no identifica staging.

## B. Estado requerido antes de 00031

Supabase gestionado debe tener Auth (`auth.users`, `auth.uid()`), Storage (`storage.buckets`, `storage.objects`, `storage.foldername(text)`) y roles anon/authenticated/service_role. No recrear esos schemas manualmente.

El schema comercial requiere todas las migraciones **00000–00028 y 00030**: profiles/auth, catálogo, clientes, quotes, variantes, addons, salespeople, quote_items, overrides/cupones y funciones comerciales vigentes. 00030 requiere cinco firmas exactas, incluidas las dos sobrecargas de preview_quote_coupon. 00029 intentó sustituir guards por nombre y falla sobre una sobrecarga; su transacción revierte. 00030 reemplaza las cinco firmas independientemente. **Omitir 00029**, no editarla ni ejecutarla y continuar ignorando errores.

### Mismo staging limpiado: camino recomendado

No clonar usuarios, clientes, comprobantes ni mensajes productivos. Reconstruir desde el repositorio en un proyecto Supabase vacío. Esto replica el schema versionado hasta 00030; no demuestra que producción no tenga drift manual. La equivalencia con producción requiere un inventario/schema-only previamente aprobado y saneado; no se consultó producción en esta entrega.

En PowerShell, dentro de la rama correcta:

```powershell
node scripts/prepare-sales-network-staging.mjs
Get-Content tmp/sales-network-staging-plan/manifest.json
```

El generador emite **baseline-combined.sql** en UTF-8 sin BOM, con guard de schema vacío, identidades documentadas para 00026 y fronteras de transacción para enums. No es concatenación manual. Conserva las definiciones comerciales hasta 00030, omite 00029 y deja Network separado. El manifiesto incluye SHA256 de fuentes y artefactos.

Camilo debe limpiar el staging existente mediante [reset protegido](sales-network-staging-reset.md), abrir baseline-combined.sql como UTF-8 y ejecutarlo completo en SQL Editor del ref verificado. No ejecutar los archivos históricos individualmente para este bootstrap. Alternativa psql, con PGHOST/PGPORT/PGUSER/PGDATABASE tomados de Connect del staging y contraseña staging mediante -W:

```powershell
psql -X -W -v ON_ERROR_STOP=1 -f tmp/sales-network-staging-plan/baseline.psql
```

No envolverlo en otra transacción: el enum expo necesita COMMIT antes de usarse. No ejecutar sobre schema parcial, ni usar db reset/db push indiscriminadamente. Para el staging parcial que falló, usar el [reset protegido del MISMO proyecto](sales-network-staging-reset.md), conservando ref y credenciales staging. No crear otro proyecto ni reejecutar el bootstrap encima del schema parcial. Revisar las queries y los conteos del documento de bootstrap antes de aplicar Network.

### Staging existente

Revisar historial y schema. Si está hasta 00028, aplicar **solo 00030**. Si 00029 falló, confirmar rollback y aplicar 00030. Si ya está hasta 00030, no aplicar baseline. Si hay drift, tablas homónimas, objetos parcialmente creados o firmas faltantes, detenerse y reconciliar antes de continuar; no borrar tablas. SQL Editor/psql no registra automáticamente `supabase_migrations.schema_migrations`: guardar log + manifiesto y no mezclar luego con CLI push sin reconciliar su historial. No marcar 00029 como ejecutada: documentarla como sustituida por 00030.

### Preflight SQL de solo lectura

```sql
select name, to_regclass('public.'||name) as relation
from unnest(array['profiles','customers','salespeople','machines','machine_variants',
 'machine_addons','addons','quotes','quote_items','quote_addons']) name;
-- Todas las relaciones deben existir.
select signature,to_regprocedure(signature) as installed
from unnest(array[
 'public.set_updated_at()',
 'public.preview_quote_coupon(uuid,jsonb,text)',
 'public.preview_quote_coupon(uuid,jsonb,text,uuid)',
 'public.preview_multi_quote_coupon(jsonb,text)',
 'public.create_quote(uuid,jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,text,uuid,uuid)',
 'public.create_multi_quote(jsonb,text,text,text,text,public.quote_delivery_type,text,uuid,text,uuid)'
]) signature;
-- Ningún NULL. Revisar definiciones de las cinco firmas si el historial no es fiable.
select p.oid::regprocedure, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('create_quote','create_multi_quote','preview_quote_coupon','preview_multi_quote_coupon');
select to_regclass('auth.users'),to_regclass('storage.objects'),to_regclass('storage.buckets');
select count(*) as active_machines from public.machines where active;
select to_regclass('public.organizations'),to_regclass('public.orders');
-- Antes de la PRIMERA aplicación de 31 ambas deben ser NULL.
```

## C. Aplicar Sales Network, exactamente en orden

| Orden | Archivo | Comprobación inmediata |
|---|---|---|
| 1 | `20261018000031_sales_network_core.sql` | 4 organizaciones, memberships/devices y network_access(uuid) |
| 2 | `20261018000032_sales_network_opportunities_tasks.sql` | opportunities/tasks/audit y network_opportunity(uuid,text,uuid,jsonb) |
| 3 | `20261018000033_sales_network_orders.sql` | orders/milestones/documents/notifications y bucket privado |
| 4 | `20261018000034_sales_network_automation.sql` | network_dashboard(uuid), network_balance_request_days()=10 |
| 5 | `20261018000035_sales_network_insights.sql` | sales_goals, announcements, modules; network_insights(uuid) |
| 6 | `20261018000036_sales_network_demo_hardening.sql` | network_activate_result(text,uuid,text), snapshots de nombres |

Cada archivo tiene BEGIN/COMMIT. No hay 00037: la revisión local no encontró un bug SQL adicional. Ejecutar uno por uno en SQL Editor staging y verificar cada fila. En staging hasta 00030 y sin ninguna migración Network aplicada, alternativa psql con la conexión staging explícita:

```powershell
psql -X -W -v ON_ERROR_STOP=1 -f tmp/sales-network-staging-plan/network.psql
```

Si algunas ya están aplicadas, ejecutar únicamente archivos pendientes; no repetir network.psql completo. Conservar salida, fecha y SHA256 del manifiesto. Tras error no continuar ni suponer éxito. Estas DDL son de aplicación única; la idempotencia de acciones/seeds no significa que CREATE TABLE sea repetible.

## D. Verificación posterior (solo lectura)

```sql
select slug,name,organization_type,status from public.organizations order by slug;
select public.network_balance_request_days(); -- 10
select to_regprocedure('public.network_activate_result(text,uuid,text)'),
       to_regprocedure('public.network_dashboard(uuid)'),
       to_regprocedure('public.network_insights(uuid)');
select table_name,column_name from information_schema.columns
where table_schema='public' and
 ((table_name='opportunities' and column_name='customer_name_snapshot') or
  (table_name='order_documents' and column_name='uploaded_by_name_snapshot'));
select p.proname,count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname like 'network_%' or p.proname='refresh_sales_network_tasks')
group by p.proname having count(*)>1; -- 0 filas: no sobrecargas ambiguas Network
select has_function_privilege('authenticated','public.network_activate_result(text,uuid,text)','EXECUTE') as auth_allowed,
       has_function_privilege('anon','public.network_activate_result(text,uuid,text)','EXECUTE') as anon_denied;
-- true / false
select network_role,count(*) from public.organization_memberships where active group by network_role;
-- En staging vacío puede no haber miembros hasta seed; no inventar backfill de usuarios inexistentes.
```

## E. Env y Auth

Copiar `.env.sales-network-staging.example` a `.env.sales-network-staging`, completar solo datos staging. Ref de producción es únicamente deny-list. El seed también rechaza el host del `.env.local` predeterminado, incluso si coincide con el allow host. No renombrar un proyecto productivo para pasar los controles. Las variables declarativas no prueban por sí mismas la identidad del proyecto: cotejar refs en dashboard.

Variables de aplicación: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, APP_URL; logs opcionales con SALES_NETWORK_ENV=staging y SALES_NETWORK_OBSERVABILITY=true. Auth usa las mismas URL/key; Storage usa SUPABASE_SECRET_KEY **solo servidor**. No hay otra key de Auth ni bucket configurable. Nunca prefijar secret/password con NEXT_PUBLIC.

Next carga `.env.local` para variables que falten; Node `--env-file` no reemplaza variables ya exportadas. Usar terminal limpia y mantener los campos Twilio explícitamente vacíos del example, para que no hereden credenciales predeterminadas. No configurar una contraseña de BD para la app. No definir NODE_ENV=staging; Next usa development/production.

En **Supabase staging → Authentication → URL Configuration**: Site URL `http://localhost:3000` durante ensayo local. Redirect URLs exactas `http://localhost:3000/login` y `http://localhost:3000/network`. Posteriormente Site URL HTTPS del deployment staging y agregar esas dos rutas bajo ese origen. No añadir producción ni wildcard general. La app usa password login; no existe una ruta /auth/callback que haya que inventar. Mantener email/password habilitado. El seed confirma solo sus dos cuentas; no deshabilitar confirmación globalmente. [Referencia oficial Auth](https://supabase.com/docs/guides/auth/redirect-urls).

Twilio se evalúa al invocar envío, no es obligatorio para compilar Sales Network. Dejar credenciales vacías y no pulsar WhatsApp/QR durante demo. `customer_initiated` no es un interruptor universal de seguridad; la ausencia de credenciales y no configurar webhooks/sender productivos evita envío desde servidor. No modificar templates, sender ni callbacks.

## F. Storage y G. RLS

```sql
select id,public,file_size_limit,allowed_mime_types from storage.buckets
where id='sales-network-documents';
-- public=false, 8388608, PDF/JPEG/PNG.
select policyname,cmd,roles,qual,with_check from pg_policies
where schemaname='storage' and tablename='objects';
-- Revisar TODAS: policies permisivas externas también se combinan con OR.
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in
 ('organizations','organization_memberships','dealer_activation_codes','network_activation_attempts',
 'network_devices','opportunities','opportunity_activities','sales_tasks','network_audit_log','orders',
 'order_payment_milestones','order_documents','network_notifications','sales_goals','network_announcements','organization_modules');
-- 16 filas, todas true.
select tablename,policyname,cmd,roles from pg_policies where schemaname='public'
and (policyname like 'network_%');
select has_table_privilege('authenticated','public.orders','INSERT') as must_be_false,
       has_table_privilege('service_role','public.order_documents','INSERT') as must_be_true;
```

SQL Editor como postgres y service_role evaden RLS; que vean datos NO prueba aislamiento. Comprobar con sesión dealer del checklist E2E y, opcionalmente, transacción SQL sin escrituras de negocio:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','<UUID_AUTH_ETM>',true);
select set_config('request.headers','{"x-network-device":"<DEVICE_PUBLIC_ID_ETM_ACTIVO>"}',true);
select count(*) from public.orders where organization_id<>'<ORG_ETM_UUID>'; -- 0
select count(*) from public.opportunities where organization_id<>'<ORG_ETM_UUID>'; -- 0
rollback;
```

Repetir con UUID Auth/dispositivo HQ: debe ver la red. Las pruebas vacías no bastan: preparar registro de SISCO bajo su identidad de prueba para comprobar denegación cruzada. No usar admin key para simular dealer. Tras upload real, abrir Ver y confirmar archivo; URL caduca en 60 s. Sin sesión/RLS, `/network/documents/<id-ajeno>` no debe firmar. No copiar URL firmada a tickets/logs.

## H. Seed, app y reset

```powershell
node --env-file=.env.sales-network-staging scripts/seed-sales-network-demo.mjs --allow-demo-seed
node --env-file=.env.sales-network-staging node_modules/next/dist/bin/next dev
```

El seed imprime **STAGING ONLY** antes de cualquier escritura, requiere ref staging distinto de production, allow host exacto, entorno staging, flag y contraseña. Crea dos identidades marcadas en app_metadata, roles, membresías, dispositivos de sesión del script, vendedor comercial demo, tres oportunidades, dos quotes reales, tres tareas, meta y anuncio. Imprime código ETM una vez, no lo guarda en manifiesto. El navegador debe activarse/seleccionar organización por separado: los dispositivos del script no sustituyen cookies de navegador. No crea pedidos; `--with-order` se rechaza.

El manifiesto `tmp/sales-network-demo-<ref>.json` contiene IDs, no secretos. Conservarlo para reset y no publicarlo. Si hay una cuenta homónima sin marker, el seed se niega a adoptarla. Si hay meta ETM ajena al manifiesto, se niega a sobreescribirla. Usar staging limpio, sin usuarios normales bajo correos demo.

```powershell
node --env-file=.env.sales-network-staging scripts/reset-sales-network-demo.mjs --allow-demo-reset
node --env-file=.env.sales-network-staging scripts/seed-sales-network-demo.mjs --allow-demo-seed
```

Cerrar pestañas operativas durante reset para evitar escrituras concurrentes. Reset valida manifiesto/proyecto/identidades/organización/ownership antes del primer borrado; elimina archivos privados del pedido demo, documentos, tareas, milestones, notificaciones, auditoría vinculada, órdenes, actividades y oportunidades demo. Elimina meta/anuncio registrados y desactiva códigos emitidos por HQ demo. **Conserva Auth users, memberships, devices, salespeople, quotes, customers y catálogo**, así como folios/secuencia. Las quotes históricas quedan sin vínculo y nuevas quotes se crean al resembrar. No hace reset general de ETM. Si falta manifiesto o hay cambios de ownership, aborta. Los pasos REST/Storage no son una transacción distribuida: ante fallo, detener demo y reejecutar con el mismo manifiesto; no borrarlo ni ampliar filtros. Un seed interrumpido antes de registrar IDs puede dejar registros para revisión manual, nunca se borran por heurísticas de nombre.

Logs seguros staging: evento, éxito y duración; sin códigos, IDs de clientes, payloads, keys, URLs ni información de pago. Buscar `scope=sales-network` en stdout/Runtime Logs. Eventos activation, order_transition, document_upload, payment_submit, payment_validation, task_automation. Los rechazos antes de llamar RPC pueden mostrarse solo en UI; autorización antes del logger no se omite. Auditoría BD sigue siendo evidencia de cambios transaccionales.

## Vercel readiness — solo instrucciones futuras

Preferir proyecto separado **nahuitech-sales-network-staging**, sin vincular integración Supabase de producción. Crear/importar proyecto puede iniciar build/deploy: no hacerlo hasta autorización posterior. Rama fuente siempre `feat/sales-network-beta`; no cambiar configuración del proyecto productivo ni desplegar main.

Configurar variables Preview específicas para esa rama con URL/key/secret de staging, SALES_NETWORK_ENV=staging, logs y APP_URL HTTPS del preview estable. No subir password demo, manifiesto ni claves de BD. No importar env de producción ni usar `vercel --prod`. En proyecto separado, asegurarse de que la rama elegida no sea Production Branch si se desea clasificación Preview; en cualquier scope del proyecto staging jamás colocar credenciales productivas. Proteger previews mediante controles de acceso disponibles.

Después del deployment autorizado, fijar APP_URL al origen asignado y redeploy si cambió; NEXT_PUBLIC_* se fija durante build. Añadir origen/rutas exactos en Auth staging, repetir checklist y verificar que requests Auth/REST van al hostname staging en DevTools (sin exportar tokens). No configurar Twilio real. Fuentes: [Git deployments](https://vercel.com/docs/git), [variables por entorno](https://vercel.com/docs/environment-variables/manage-across-environments).
