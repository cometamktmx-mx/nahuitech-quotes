# Sales Network: Transaction Core y posventa — revisión local

Fecha: 19 de octubre de 2026. Branch: `feat/sales-network-beta`.

Implementación local; no se aplicó SQL remoto, no se desplegó ni se hizo push. El alcance ejecutable cubre Nahuitech como proveedor operativo y sus distribuidores. La base de proveedores adicionales permite relaciones y lectura de sus propios pedidos; no habilita todavía su operación comercial completa.

## Estado por prioridad

**P0:** branding, sucursales, perfiles comerciales, atribución de nuevas cotizaciones, co-branding condicional, confirmación humana, snapshots de pedidos/líneas, OC obligatoria para producción, validación financiera, tareas operativas, contactos, eventos y aislamiento. Gate antes de P1: 179 pruebas, TypeScript y build correctos; lint con el único warning histórico de `<img>`.

**P1:** solicitudes de cambio y cancelación, reservas, tracking, fecha de entrega, series por unidad cuando estén disponibles, registro de unidades/garantía y oportunidades relacionadas. Los cambios permiten describir la nueva configuración de una línea y aprobar un ajuste sell-in; no reconstruyen variantes/add-ons ni sustituyen el catálogo. No habilitan cambios de cantidad, reemplazo de equipo o devoluciones automáticas.

**P2 pendiente:** HQ operativo para otros proveedores, catálogo por marca, selector de marca y white label completo. También siguen pendientes las membresías operativas independientes `FINANCE`, `PRODUCTION` y `LOGISTICS` con proyecciones de datos específicas. Hoy esas responsabilidades se muestran en tareas, pero los permisos de ejecución siguen en HQ; no se concedió acceso genérico a precios a nuevos roles.

## Migraciones nuevas y orden exacto

Sobre el staging que **ya tiene 00031–00036**, aplicar únicamente las nuevas, una vez y en este orden. Cada archivo tiene transacción `BEGIN/COMMIT`. No son scripts para reejecutar sobre la misma versión.

| Archivo | Cambios principales |
|---|---|
| `20261019000037_network_organizations_team.sql` | Branding/contactos, SUPPLIER, relaciones dealer/proveedor, propiedad de máquinas, sucursales y perfiles de vendedor; bucket público solo para logos |
| `20261019000038_network_transaction_attribution.sql` | Atribución nullable e inmutable de nuevas quotes, snapshots de partes/líneas, lectura autorizada de cotización |
| `20261019000039_network_transaction_workflow.sql` | Compra confirmada, porcentajes, comprobantes, requisito de OC, eventos, tareas/contactos y notificaciones |
| `20261019000040_network_scoped_access.sql` | HQ limitado a red Nahuitech, acceso por partes del pedido, aislamiento adicional de quotes, cierre de tareas operativas exclusivamente por transición |
| `20261019000041_network_post_sale.sql` | Solicitudes de cambio/cancelación, reservas, envío/entrega, unidades instaladas, garantías y oportunidades posteriores |

No se modificaron 00000–00036. Las funciones comerciales `create_quote`, `create_multi_quote` y las tres variantes de preview conservan sus definiciones. La captura de atribución usa un trigger nuevo, no un recálculo.

Para generar archivos de revisión, sin conectarse a Supabase:

```powershell
node scripts/prepare-sales-network-staging.mjs
```

Salida: `transaction-core-combined.sql` (37–40) y `post-sale-combined.sql` (41), dentro de `tmp/sales-network-staging-plan`. En staging existente **no ejecutar baseline-combined.sql ni network-combined.sql de nuevo, ni reset de schema**. Para una base local vacía el orden probado es baseline corregido → network 31–36 → transaction core 37–40 → post-sale 41. `00029` sigue excluida del bootstrap comercial corregido.

## Datos nuevos

Tablas: `dealer_supplier_relationships`, `organization_branches`, `order_items`, `order_events`, `order_change_requests`, `order_reservations`, `installed_units`.

Campos principales:

- Organizations: razón social, favicon, colores secundario/acento, contactos comercial/finanzas/logística, dirección, RFC, sitio, pie comercial y leyenda de distribuidor. Reutiliza nombre visible, logo y color primario existentes.
- Machines: `supplier_organization_id`, backfill Nahuitech sin alterar precios ni compatibilidades.
- Salespeople: organización, sucursal, WhatsApp, puesto y avatar; reutiliza nombre/teléfono/email/activo. No asigna vendedores legacy a empresas por inferencia.
- Quotes: organización/sucursal y sus snapshots, datos de contacto del vendedor y JSON de branding. Reutiliza `created_by_user_id` y `salesperson_id`. Legacy conserva campos nuevos nulos.
- Orders: referencias dealer/proveedor y snapshots de dealer, cliente, vendedor, sucursal y proveedor; revisión, transportista, guía y documento de envío. Reutiliza `production_completed_at` ya existente.
- Milestones: `expected_amount` generado desde `amount`, importe/referencia/autor del envío.
- Tasks: organización destinataria, responsabilidad y contacto capturado. Opportunities: confirmación humana y enlace opcional a unidad instalada.

## Branding, vendedor y PDFs

`/network/settings/branding` permite configurar la organización activa. HQ puede abrir otra organización autorizada mediante `?organization=<uuid>`. Logo: hasta 2 MB, PNG/JPG/WebP, validación/normalización a PNG en servidor, nombre único y versionado en `network-branding`. Los logos son públicos; los documentos financieros siguen privados. No se guardan imágenes en base64.

`/network/settings/team` permite crear/editar sucursales y vendedores propios. No crea usuarios Auth ni asigna membresías. Las sucursales solo existen cuando un administrador las captura.

Al cotizar desde un contexto Network validado, el servidor envía organización/dispositivo al trigger y se capturan los datos actuales. Cambiar después el branding o el teléfono no reescribe la cotización anterior. El cotizador legacy sin contexto continúa funcionando sin atribución inventada.

`/network/quotes/[id]` muestra folio, cliente, dealer, sucursal, vendedor/contactos, fecha, equipos, sell-out y enlaces autorizados. Los PDFs de nuevas quotes DEALER incorporan identidad/asesor desde snapshots. Venta directa y quotes sin snapshot mantienen la rama de diseño anterior. El fetch de logo en PDF solo admite la ruta pública del bucket propio, con límite y fallback textual.

En `whatsapp-actions.ts` solo se añadieron columnas/mapeo de snapshot para que el PDF generado por ese flujo use los mismos datos. No se cambió Twilio sender, template, ContentSid, callback, envío ni cálculo comercial.

## Recorrido operativo P0

1. Dealer crea/vincula su cotización y pasa la oportunidad a NEGOTIATION.
2. “Cliente confirmó compra” abre un resumen de cliente/dealer/vendedor/configuración/sell-out; la confirmación explícita registra WON y actividad.
3. “Crear pedido a proveedor” conserva snapshots y crea líneas de pedido. El sell-in queda nulo. Se exige relación autorizada con Nahuitech; se rechaza mezclar proveedores.
4. HQ revisa el monto sell-in positivo, fecha válida y porcentajes positivos que sumen 100 (50/50 por defecto). PostgreSQL NUMERIC calcula ambos importes y el segundo absorbe el centavo residual.
5. Dealer carga OC y comprobante con importe/referencia. Finance muestra esperado/enviado/documento/autor/fecha. El mismo usuario que envió el comprobante no puede validarlo.
6. Rechazar exige motivo y permite reenviar. Un importe distinto del esperado no puede verificarse: se rechaza para corregir.
7. Anticipo verificado **y** OC liberan producción, en cualquier orden. Si se valida primero el anticipo, queda esperando OC; cargarla completa la condición.
8. HQ inicia producción y puede modificar la fecha con auditoría. A diez días o menos se genera una tarea de liquidación, mientras el saldo siga pendiente/rechazado.
9. Saldo verificado y producción terminada convergen a READY_TO_SHIP, en cualquier orden. Ninguna condición sola habilita el envío.
10. Envío y entrega son transiciones controladas; P1 añade guía, documento, fecha y unidades.

Sell-out siempre proviene de la quote original. Sell-in siempre lo aprueba HQ; no se copia automáticamente ni se presenta un margen calculado como ganancia. Las líneas multi-equipo conservan su importe anterior al descuento global; el total sell-out conserva el total final de la quote.

## Tareas, contactos y timeline

El motor añade revisar pedido, enviar OC/anticipo, validar anticipo, iniciar producción, solicitar liquidación, validar saldo, preparar envío y confirmar entrega. `automation_key` única `operation:<regla>:<pedido>` evita copias. Al avanzar el estado cierra recordatorios anteriores. Una tarea operativa no puede completarse manualmente para aparentar que la transacción avanzó.

Dashboard y tareas filtran por destinatario; el detalle del pedido permite ver el seguimiento completo. Finanzas/logística muestran los contactos configurados; seguimiento comercial usa el vendedor. La constante SQL de diez días continúa centralizada; no hay cron remoto.

`order_events` conserva actor, organización, fecha y nota. Sus eventos alimentan notificaciones in-app: pedido, aprobación, OC, envío/validación/rechazo de pagos, producción, solicitud de liquidación, listo, envío y entrega. También registra cambios/cancelación. El audit log conserva acciones críticas y metadata limitada.

## Posventa P1

Un pedido aprobado no se edita silenciosamente. El dealer solicita un cambio por línea con motivo/configuración. HQ aprueba o rechaza con motivo, indicando el ajuste decimal sell-in. Se guardan snapshots anterior/nuevo y revisión del pedido; se rechazan revisiones desactualizadas, cambios de pedidos terminados/liquidados y cambios mientras existen comprobantes pendientes de resolver.

Caso probado: 205000 + 4000 = 209000; anticipo VERIFIED 102500 permanece igual; saldo = 106500. Si el anticipo aún no se verificó, ambos importes se ajustan a los porcentajes acordados. No se admiten totales inferiores o iguales al anticipo ni devoluciones implícitas.

Cancelación siempre pasa por solicitud/resolución HQ. Con pagos validados requiere confirmación explícita; con producción iniciada requiere otra. Conserva pagos/documentos, cancela tareas y libera reservas. No establece penalizaciones, reembolsos ni política comercial.

Reservas: referencias manuales de INVENTORY/PRODUCTION_SLOT; no descuentan stock. Envío: transportista/guía opcionales y documento SHIPPING del mismo pedido. Entrega: fecha obligatoria no futura ni anterior al envío; serie opcional por unidad y fin de garantía opcional según acuerdo. Se crea una unidad por cantidad del pedido. La garantía comienza en la fecha de entrega y queda “Fin no definido” si no se captura duración.

`/network/warranties` muestra las últimas 100 unidades autorizadas. Permite crear una oportunidad relacionada; no implementa reclamaciones ni servicio técnico. Una serie no disponible al entregar queda pendiente; todavía no hay edición posterior de serie/garantía.

## Seguridad y límites de proveedores

RLS en todas las tablas nuevas; writes por RPC `SECURITY DEFINER` con `search_path=''`, checks de sesión/contexto y grants explícitos. Funciones internas y wrappers históricos no están expuestos al cliente. Logo upload usa admin únicamente en servidor y después de autorización. Documentos privados mantienen signed URLs.

HQ Nahuitech se limita a relaciones autorizadas de su red. Un NETWORK_OWNER de otro supplier no se convierte en HQ global. Pedidos/documentos/milestones/items/eventos/unidades se leen solo como parte autorizada del pedido; dealer A no ve dealer B. Las nuevas quotes atribuidas tienen una política restrictiva adicional; las legacy conservan sus reglas anteriores.

Los proveedores adicionales pueden leer sus pedidos por RLS; no tienen todavía dashboard operativo propio, aprobación financiera ni cambio de contexto de marca. No asignar roles de finanzas/producción/logística hasta implementar su aislamiento de campos sensibles.

## UI y tooling

Nuevas páginas: branding, equipo, detalle de cotización y garantías. Componentes nuevos: confirmación de compra, productos del pedido, solicitudes/reservas. Detalle de pedido incluye partes/contactos, sell-out/sell-in, porcentajes, OC, comprobantes, producción, tareas, timeline, auditoría, solicitudes y seguimiento de entrega.

Seed: añade identidad ETM y contacto de vendedor ficticio, sin crear sucursales, activar al dealer ni crear pedidos terminados. Conserva el recorrido vivo de activación → quote → pedido. Quotes demo legacy no se reescriben: crear una nueva tras activar ETM para demostrar snapshots y PDF de marca.

Reset demo mantiene manifiesto y guards staging existentes. Las tablas hijas nuevas se eliminan por FK cascade únicamente al eliminar los pedidos demo autorizados. Se niega ante actores no demo o una oportunidad de seguimiento fuera del manifiesto. No elimina catálogo, quotes, usuarios ni perfiles. Reset de schema ampliado y probado dos veces localmente, incluyendo funciones renombradas; **no usarlo en el staging actual con datos**.

## Validación y pendientes de staging

Resultado final local: **184 tests / 184 aprobados**, 0 fallos, aproximadamente 25 segundos. `npx tsc --noEmit`: correcto. `npm run lint`: 0 errores, solo el warning histórico de `src/components/quote-whatsapp-button.tsx` (`<img>`). `npm run build`: correcto, ejecutado con valores Supabase ficticios y Twilio vacío mediante el runner local de validación; compilación 3.2 s y comprobación TypeScript del build 9.2 s. No se midió latencia de consultas sobre Supabase remoto.

Pruebas PostgreSQL local PGlite: instalación desde vacío, RLS real, atribución, precios comerciales, confirmación, snapshots, OC/anticipo, balance/producción, tareas idempotentes, proveedor ajeno, cambio de precio, cancelación, entrega/unidades, reset y guards. La suite incluye regresiones legacy seller/admin/expo, activation y las cinco funciones comerciales. No equivale a haber ejercitado PostgREST/Auth/Storage en Supabase remoto.

Consultas de verificación para revisar manualmente **solo en staging**, después de aplicar todo:

```sql
select to_regclass('public.order_items'), to_regclass('public.order_events'),
       to_regclass('public.order_change_requests'), to_regclass('public.installed_units');
select to_regprocedure('public.network_quote_detail(uuid)'),
       to_regprocedure('public.network_order_action(uuid,text,jsonb)'),
       to_regprocedure('public.network_review_request(uuid,boolean,jsonb)');
select c.relname, c.relrowsecurity from pg_class c
where c.relnamespace='public'::regnamespace and c.relname in
 ('dealer_supplier_relationships','organization_branches','order_items','order_events',
  'order_change_requests','order_reservations','installed_units'); -- todos true
select id,public,file_size_limit from storage.buckets
where id in ('network-branding','sales-network-documents'); -- logo true; documentos false
select o.folio,o.dealer_order_total,sum(m.amount) milestone_total
from public.orders o join public.order_payment_milestones m on m.order_id=o.id
group by o.id having o.dealer_order_total<>sum(m.amount); -- cero filas
select folio from public.orders o where status='READY_TO_SHIP' and
 (production_completed_at is null or not exists(select 1 from public.order_payment_milestones m
  where m.order_id=o.id and m.milestone_type='BALANCE' and m.status='VERIFIED')); -- cero filas
```

El SQL Editor como administrador no demuestra aislamiento RLS: comprobarlo con usuarios Auth reales en la lista siguiente. Un pedido legacy que se hubiera liberado antes de exigir OC conserva su historia; revisar su expediente antes de continuar. No se reescriben estados históricos automáticamente.

Antes de desplegar:

1. Revisar y aplicar 37 → 38 → 39 → 40 → 41 únicamente en staging, verificando registro de migraciones.
2. Comprobar bucket `network-branding` público y `sales-network-documents` privado; subir logo y documentos con dos sesiones reales HQ/ETM.
3. Probar nueva quote single y multi desde contexto ETM, PDF en navegador/descarga y su diseño visual; luego cambiar branding y verificar que la quote anterior no cambia.
4. Completar OC + anticipo en ambos órdenes, intentar auto-validación, importe incorrecto, rechazo y reenvío.
5. Probar fechas +11/+10/+9, refrescar varias veces, comprobar tareas sin duplicados y cierre por transición.
6. Probar ambas convergencias de saldo/producción, cambio +4000 tras anticipo, cancelación con pagos y entrega con varias series.
7. Ensayar RLS con sesiones ETM/SISCO/HQ reales, signed URLs, login/logout y dispositivo revocado.
8. Revisar tablet/mobile y PDFs visualmente. No se verificaron navegadores conectados al staging durante este trabajo.

No desplegar esta rama a producción todavía. Faltan aceptación en Supabase/Vercel staging, revisión visual y decisión sobre políticas reales de garantías/cancelación. No se implementaron roles operativos separados ni P2. No usar los nuevos flujos sin aplicar todas sus migraciones.
