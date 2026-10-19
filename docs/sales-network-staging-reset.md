# Recuperar EL MISMO staging parcialmente instalado

No crear otro proyecto. Este procedimiento es exclusivo del staging actual, sin usuarios Auth, clientes, cotizaciones ni archivos. No se ha ejecutado remotamente. No sirve para resetear una demo poblada: para eso existe `scripts/reset-sales-network-demo.mjs`.

## Qué pudo quedar

El combinado contiene commits por migración. Si se detuvo en 00010, quedaron normalmente 00000–00009: profiles, machines, addons, machine_addons, customers, quotes, quote_addons, coupons, coupon_machines y whatsapp_messages; sus índices, RLS, grants, funciones comerciales/cupones y triggers. Los enums incluyen profile_role, addon_calculation_type (ya con QUANTITY), quote_status, quote_delivery_type, coupon_discount_type, whatsapp_message_status y machine_delivery_policy. `auth.users` tiene el trigger `on_auth_user_created`, que llama `public.handle_new_user()`.

00008 crea `quote-pdfs` privado y su policy de lectura. `machine-images` aparece en 00020; `sales-network-documents` en 00033. No deberían existir si el editor se detuvo en 00010, pero el reset cubre también los objetos de 00011–00036 por si se ejecutaron fragmentos posteriores. Los cambios de la transacción fallida 00010 no deben persistir; las tablas temporales no son parte del reset. La corrupción pudo afectar nombres del catálogo inicial ya confirmado por 00004. Esto es una reconstrucción desde el SQL versionado, no una inspección del remoto.

## Estrategia y límites

Se eliminan exclusivamente las tablas, funciones, enums y secuencias `public` declaradas por el historial hasta 00036, las policies conocidas sobre `storage.objects` y el hook Auth del proyecto. Inventario extraído de fuentes versionadas por `scripts/lib/staging-schema-reset.mjs`. `DROP ... RESTRICT` evita arrastrar dependencias desconocidas. Una dependencia externa provoca rollback completo, no CASCADE. No se edita ninguna migración.

**No usamos `DROP SCHEMA public CASCADE`.** Conservamos el mismo schema, owner, ACL y default privileges, sin necesidad de recrearlos ni ampliar permisos. Se conservan extensiones y objetos ajenos, todos los schemas administrados y `supabase_migrations`. El reset y el consumo de su autorización forman una sola transacción; timeouts limitan esperas. Al finalizar se notifica `pgrst` para recargar el schema. La reinstalación vuelve a aplicar los grants/RLS de los objetos comerciales. Ejecutar como `postgres` desde SQL Editor, con la app y otros writers detenidos.

Los tres buckets conocidos **se conservan vacíos**. Las migraciones usan UPSERT y restauran su configuración. No se necesita borrarlos para reinstalar. Buckets desconocidos y sus objetos quedan intactos. Si hay archivos en buckets conocidos, el reset falla sin modificar nada: revisar el proyecto y vaciarlos mediante Storage Dashboard/API solo si se confirma que son descartables. Nunca usar DELETE de `storage.objects`/`storage.buckets`: eliminar metadatos SQL puede dejar archivos físicos huérfanos ([documentación Supabase](https://supabase.com/docs/guides/storage/management/delete-objects)). No hay limpieza remota automática.

## Comandos exactos para Camilo

1. Detener la app staging. Abrir **el mismo** proyecto staging en Dashboard; cotejar `/project/<ref>` con Settings. No usar pestaña de producción. `select current_database(), current_user;` normalmente muestra `postgres` en ambos: **no identifica el proyecto**.
2. Revisar `.env.sales-network-staging`: `SALES_NETWORK_ENV=staging`, `SALES_NETWORK_STAGING_PROJECT_REF`, `SALES_NETWORK_PRODUCTION_PROJECT_REF` distintos (20 caracteres), `NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co`, `SALES_NETWORK_DEMO_ALLOW_HOST=<staging-ref>.supabase.co`, publishable key y secret exclusivamente staging. El helper también rechaza el destino de `.env.local`. Se usan las mismas variables de seed; este generador no envía ninguna key ni abre conexiones.
3. En `D:\nahuitech-quotes`, rama `feat/sales-network-beta`:

```powershell
node --env-file=.env.sales-network-staging scripts/reset-sales-network-staging-schema.mjs --allow-staging-schema-reset
```

Imprime **STAGING ONLY** y el ref exacto; solo genera archivos UTF-8 locales. No ejecuta SQL. Sin flag, entorno staging, refs distintos o host exacto, falla.

4. Tras verificar manualmente otra vez el ref de la pestaña SQL Editor, guardar el resultado de `select nspname,pg_get_userbyid(nspowner),nspacl from pg_namespace where nspname='public';` para compararlo después. Abrir y ejecutar **solo** `tmp/sales-network-staging-reset/01-manual-staging-authorization.sql`. Crea una marca privada fuera de `public`, ligada al ref y un token aleatorio, válida 20 minutos. No pegarla junto con el reset. El schema de control queda inaccesible a anon/authenticated/service_role.
5. En esa misma pestaña del staging confirmado, abrir y ejecutar `tmp/sales-network-staging-reset/02-reset-staging-schema.sql`. Requiere la marca correcta, vigente, cero Auth users, cero datos en tablas operativas (exceptúa únicamente catálogo y organizaciones/módulos sembrados por migraciones), y cero archivos en buckets conocidos. Consume la marca solo al completar. Si se niega, detenerse y revisar el motivo; no quitar guards. Si vence, regenerar los archivos y repetir la confirmación manual.
6. Ejecutar `tmp/sales-network-staging-reset/03-verify-clean.sql`. Las consultas de tablas y funciones del proyecto deben devolver **cero filas**; Auth count debe ser 0. Owner/ACL de `public` deben coincidir con los anteriores al reset. Los buckets vacíos pueden seguir listados. También puede comprobarse:

```sql
select current_database(),current_user;
select to_regclass('public.profiles') as profiles,
       to_regclass('public.machines') as machines,
       to_regclass('public.quotes') as quotes,
       to_regclass('public.organizations') as organizations;
-- Los cuatro NULL; usar 03-verify-clean.sql para inventario completo.
select nspname,pg_get_userbyid(nspowner) as owner,nspacl
from pg_namespace where nspname in ('public','auth','storage','extensions');
select count(*) from auth.users; -- 0
select bucket_id,count(*) from storage.objects
where bucket_id in ('quote-pdfs','machine-images','sales-network-documents') group by bucket_id; -- cero filas
```

La marca no descubre el ref real del servidor: SQL de Supabase no ofrece aquí una identificación fiable. La verificación de la pestaña es obligatoria. El ref/host/env del generador, marca temporal de un uso y negativas ante usuarios/datos/archivos son barreras adicionales; no autorizan copiar SQL a producción.

## Orden después del reset

```powershell
node scripts/prepare-sales-network-staging.mjs
```

1. Ejecutar `tmp/sales-network-staging-plan/baseline-combined.sql` completo, UTF-8, en el mismo staging verificado.
2. Verificar catálogo con [las queries del bootstrap](sales-network-staging-bootstrap.md): 10 máquinas activas, 9 addons activos, 36 compatibilidades, 9 variantes activas, Kit de Láser con Guía con UUID y 5 firmas RPC. 00029 permanece excluida; 00030 incluida. No ejecutar de nuevo el historial por separado.
3. Ejecutar `tmp/sales-network-staging-plan/network-combined.sql` (00031 → 00032 → 00033 → 00034 → 00035 → 00036).
4. Ejecutar verificaciones de [migraciones](sales-network-migration-checklist.md) y [runbook](sales-network-staging-runbook.md). Configurar Auth URL antes de login. No usar `supabase db push` sobre un historial reconstruido manualmente; este procedimiento no reescribe la tabla de historial CLI.
5. Seed explícito:

```powershell
node --env-file=.env.sales-network-staging scripts/seed-sales-network-demo.mjs --allow-demo-seed
node --env-file=.env.sales-network-staging node_modules/next/dist/bin/next dev
```

6. Ensayar [E2E en dos browsers](sales-network-e2e-checklist.md). Una vez creado el seed, este reset de schema debe negarse. Usar el reset de **datos demo** para ensayos posteriores, no borrar Auth users para eludir esta protección.

## Validación local

`tests/staging-schema-reset.test.mjs` usa PostgreSQL local PGlite con fixtures mínimos de los schemas administrados. Prueba 00000–00009 parcial, dos ciclos reset → bootstrap → 00031–00036, marca ausente/expirada/otro ref/consumida, negativa ante Auth users/archivos, dependencia externa con rollback, conservación de public owner/ACL y objetos/buckets ajenos. No equivale a probar el servidor gestionado ni la API física de Storage: queda la verificación manual del staging real.

Resultado local de esta entrega: **156 tests aprobados**, cero fallos/omitidos (~27 s); `npx tsc --noEmit` correcto; lint correcto con el único warning histórico de `<img>`; build correcto con variables ficticias explícitas y Twilio vacío. Ningún comando remoto, deploy o push. Migraciones históricas y 00031–00036 sin cambios.
