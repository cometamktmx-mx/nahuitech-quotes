# Sales Network — checklist de migraciones

Preflight staging actualizado: consultar [runbook exacto](sales-network-staging-runbook.md). Baseline limpio: 00000–00028, omitir 00029, aplicar 00030. Luego 00031–00036. No se necesitó 00037. Scripts locales generan plan/checksums sin conexiones remotas.

Auditoría local: 18 octubre 2026. No se ejecutó Supabase remoto. Las cinco migraciones 00031–00035 se conservaron; las correcciones de este sprint están en **00036**. No se modificó ninguna migración histórica 00000–00030.

## Orden exacto

Aplicar únicamente las pendientes, una vez cada una, usando el registro de migraciones del proyecto. Todas contienen `BEGIN;` y `COMMIT;`.

| Orden / archivo | Qué crea o corrige | Dependencia | Riesgo / resultado esperado |
|---|---|---|---|
| 1. `20261018000031_sales_network_core.sql` | Organizations, memberships, activation codes/attempts, devices, helpers de autorización; NAHUITECH, ETM, SISCO PRINT, CASA DÍAZ; backfill de admins activos | Schema comercial actual, Auth, profiles, trigger updated_at | Nuevos permisos de red para admins activos. Cuatro organizaciones, sin sucursales inventadas; códigos no legibles por clientes |
| 2. `20261018000032_sales_network_opportunities_tasks.sql` | Opportunities, activities, tasks, audit, RPC autorizadas | 31; customers, salespeople, quotes, quote_items/add-ons existentes | Nuevas FK al schema comercial. No cambia cálculo ni RPC de cotizaciones; tablas de red aisladas por organización |
| 3. `20261018000033_sales_network_orders.sql` | Orders, sequence independiente, milestones, documents, notifications; workflow y bucket privado | 31–32; `storage.buckets/objects` de Supabase | Storage debe estar disponible. Sell-in nulo hasta aprobación HQ; documentos privados y pagos NUMERIC |
| 4. `20261018000034_sales_network_automation.sql` | Reglas de tareas, agregados dashboard, dispositivos/notificaciones, prioridades | 31–33 | El motor se ejecuta al consultar páginas, sin cron. Claves únicas impiden duplicar tareas/notificaciones |
| 5. `20261018000035_sales_network_insights.sql` | Goals, announcements, modules, branding y agregados de insights | 31–34 | Necesaria para el dashboard actual. No genera ventas ni cifras demo |
| 6. `20261018000036_sales_network_demo_hardening.sql` | Snapshots de nombres, validaciones LOST/importe/fecha, vinculación idempotente, activación con errores distinguibles, calendario CDMX y ajuste de recordatorios | 31–35 | Backfill solo de metadata de red (nombres de cliente/autor), sin alterar quotes comerciales. La UI final requiere esta RPC nueva |

## Verificaciones realizadas

- [x] Ejecución secuencial de SQL real en PostgreSQL aislado PGlite, incluyendo 36, con datos comerciales de prueba.
- [x] Estados y roles usan `text` con CHECK; no hay colisión de nombres de enums globales.
- [x] Dependencias de funciones y FK en orden; UUID, timestamps e índices de organización y relaciones.
- [x] RLS para las 16 tablas; lecturas propias o HQ autorizado. Códigos/intentos permanecen fuera de lectura cliente.
- [x] Escrituras de negocio vía RPC, con Auth/perfil/membresía/dispositivo, `SECURITY DEFINER` y `search_path` fijo. Sin service role en navegador.
- [x] Grants de RPC explícitos para authenticated; helpers internos revocados; reemplazos de 36 conservan ACL previa.
- [x] Bucket `sales-network-documents` privado; sin policy pública de lectura/escritura. El servidor autoriza por RLS antes de subir o firmar; TTL 60 segundos.
- [x] Aislamiento ETM/SISCO, acceso global HQ, rechazo a escritura directa, financiero no autorizado y documentos ajenos cubiertos por pruebas.
- [x] Seeds organizacionales/backfill con conflicto seguro; conversión, link y automatización idempotentes. Las migraciones DDL **no son scripts para ejecutar repetidamente**: tablas/trigger se crean una vez.
- [x] No cambios a Twilio, PDF, precios, IVA, folios/snapshots/RPC comerciales.

## Antes de ejecutar en staging

1. Confirmar que es un proyecto aislado y revisar su historial de migraciones. Requiere esquema comercial vigente con corrección 00030. La prueba heredada demuestra un fallo de 00029 corregido por 00030; no reejecutar 00029 ni hacer un reset ciego del schema.
2. Respaldo del staging y confirmar ausencia de tablas homónimas ajenas (`orders`, `organizations`, etc.). Si hay objetos creados manualmente, reconciliar antes de aplicar; no usar DROP para despejar conflictos.
3. Aplicar 31 → 32 → 33 → 34 → 35 → 36, solo pendientes. No habilitar esta UI con una migración incompleta.
4. Comprobar las cuatro organizaciones, membresía NETWORK_OWNER de admin activo y bucket privado con límite 8 MB/PDF/JPEG/PNG.
5. Configurar URL/publishable key/secret **del mismo staging**. Ejecutar el seed únicamente con opt-in explícito de la guía.
6. Ensayar dos sesiones Auth distintas: ETM y HQ, subida y apertura de PDF/JPG/PNG reales, rechazo/reenvío y recorrido completo.

## Límite de esta validación

PGlite ejecuta PostgreSQL real; el esquema mínimo de Auth/Storage se simula. No verifica PostgREST, configuración del proyecto remoto, URLs firmadas reales ni transporte de cookies/headers en Supabase. Esas comprobaciones siguen siendo condición de aceptación en staging. La policy `network_document_read` permite SELECT autenticado solo con autorización de red; no hay acceso anónimo. Verificar que staging no agregue otras policies permisivas. No usar un rollback destructivo sobre tablas con pedidos/documentos: corregir con una nueva migración aditiva.
