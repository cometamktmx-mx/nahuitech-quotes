# DEMO DE 7 MINUTOS

**Actualización staging:** usar el [runbook vigente](sales-network-staging-runbook.md) y el [checklist E2E real](sales-network-e2e-checklist.md). Seed/reset admiten exclusivamente staging con refs distintas y host exacto; no existe `--with-order`. Ninguna validación remota se ha ejecutado.

Preparar staging y seed con las instrucciones de abajo antes de presentar. Tener dos perfiles abiertos y tres comprobantes de muestra válidos. Las URLs son relativas a http://localhost:3000 o al staging que prepare el operador. Sustituir {opportunityId}/{orderId} por los enlaces creados en pantalla. Confirmar los diálogos cuando aparezcan. Los tiempos suman 7 minutos.

| Paso | Tiempo | URL | Usuario | Botón exacto / acción | Resultado esperado |
|---|---|---|---|---|---|
| 1. Login HQ/dealer | 0:00–0:30 | /login | HQ y ETM, perfiles separados | Iniciar sesión | Auth válido; HQ y dealer conservan sus roles |
| 2. Activate ETM | 0:30–0:55 | /network/activate | ETM | Pegar código del seed → **Activar acceso** | Membresía activa, dispositivo registrado, entra a ETM. HQ selecciona NAHUITECH → **Entrar a organización** |
| 3. Dashboard | 0:55–1:15 | /network | ETM | **Inicio** | Pipeline real, cinco métricas, Tu día y meta |
| 4. Opportunity | 1:15–1:45 | /network/opportunities → /network/opportunities/{opportunityId} | ETM | **Textiles Vega** → completar seguimiento → **Guardar seguimiento** | Oportunidad QUOTED y actividad nueva. Elegir llamada/nota y escribir seguimiento |
| 5. Quote | 1:45–2:05 | /network/opportunities/{opportunityId} | ETM | **Ver cotización** | Folio, cliente, fecha, vendedor e importe sell-out. Ya vinculada por seed; flujo manual disponible: Crear cotización en /seller y luego Vincular cotización |
| 6. WON | 2:05–2:30 | /network/opportunities/{opportunityId} | ETM | Elegir Negociación → **Actualizar etapa**; luego Ganada → **Actualizar etapa** | NEGOTIATION → WON, timeline; Convertir en pedido visible |
| 7. Order | 2:30–3:00 | /network/orders/{orderId} | ETM | **Convertir en pedido**; elegir Orden de compra → **Subir documento** | PENDING_HQ_REVIEW, cliente/ETM/sell-out visibles; precio dealer pendiente |
| 8. HQ review | 3:00–3:25 | /network/hq/orders → /network/orders/{orderId} | HQ | Abrir folio → **Revisar pedido**, capturar 100000.00 y fecha de hoy +10 días → **Aprobar pedido** | AWAITING_DEPOSIT; monto definido exclusivamente por HQ |
| 9. 50/50 | 3:25–3:40 | /network/orders/{orderId} | HQ | Revisar **Pagos del pedido** | Anticipo $50,000.00 y saldo $50,000.00; total $100,000.00 independiente del sell-out |
| 10. Voucher | 3:40–4:10 | /network/orders/{orderId} | ETM | Recargar, elegir Comprobante anticipo → archivo → **Subir documento** | DEPOSIT_SUBMITTED; nombre, tipo, fecha, autor y **Ver** |
| 11. Finance validation | 4:10–4:40 | /network/hq/finance | HQ | **Ver comprobante** → **Validar anticipo** | Anticipo VERIFIED; RELEASED_TO_PRODUCTION. Solo validar archivos de muestra en este staging |
| 12. Production | 4:40–5:05 | /network/orders/{orderId} | HQ | **Iniciar producción**; si hace falta, **Actualizar fecha** | IN_PRODUCTION; fecha y acción en auditoría |
| 13. 10-day task | 5:05–5:35 | /network → /network/tasks → /network/notifications | ETM | **Inicio**, **Tareas**, **Notificaciones** | Solicitar liquidación HIGH y notificación; refrescar no duplica |
| 14. Balance | 5:35–6:20 | /network/orders/{orderId}; /network/hq/finance | ETM, luego HQ | Comprobante saldo → **Subir documento**; HQ **Ver comprobante** → **Validar saldo** | BALANCE VERIFIED; aún IN_PRODUCTION si no terminó producción |
| 15. Ready to ship | 6:20–7:00 | /network/orders/{orderId} | HQ | **Marcar producción terminada** | Ambas condiciones completas → READY_TO_SHIP / Listo para envío, timeline y notificación |

La demo no incluye envío de WhatsApp ni un pago bancario real. No utilizar cuentas productivas ni cambiar precios del catálogo para ajustar los importes de ejemplo.

---

# NAHUITECH SALES NETWORK — entrega Beta

Fecha: 18 de octubre de 2026. Implementación local; sin deploy, push, commits ni migraciones remotas.

## Auditoría y compatibilidad

Se revisaron las migraciones 00000–00030, `require-role`, `get-seller-client`, el proxy de sesión, el flujo `/seller`, las acciones de cotización, clientes, `loadQuoteItems`, Storage y `public/sw.js` antes de implementar.

- Los permisos comerciales existentes son por usuario y rol `admin/seller/expo`. Se conservaron.
- `salespeople` representa vendedores comerciales independientes de Auth. Sales Network conserva esa separación; al vincular cotización usa su atribución comercial.
- Los clientes finales no reciben cuentas ni membresías.
- `quote_items` y `quote_addons` se incorporan al snapshot de la oportunidad/pedido. No se reconstruyen precios del catálogo.
- Storage existente contiene imágenes públicas de máquinas. Los documentos de pedidos usan otro bucket, privado.
- El Service Worker solo maneja rutas y recursos existentes; no fue modificado. Sales Network es online-first.
- Fuera de los archivos nuevos, solo se añadieron enlaces en `admin-nav`/`seller-shell-header` y el comando `npm test`.
- No se modificaron precios, IVA, catálogo, variantes, add-ons, PDFs, folios comerciales, snapshots históricos, RPC comerciales, Twilio ni COMETA.

## Alcance entregado

**P0:** organizaciones iniciales; membresías; activación con hash; dispositivos y revocación; shell; dashboard real; oportunidades y motivos de pérdida; timeline; integración explícita con cotizador; tareas automáticas; pedidos sell-in; aprobación HQ; milestones; bóveda privada; Finance Inbox; producción; liquidación a 10 días; notificaciones; HQ; auditoría y RLS.

**P1:** metas por organización y estructura de metas individuales; ranking mensual; Analytics; scorecard de dealer sin puntuación inventada; demanda interna; noticias; identidad básica; flags de navegación administrados por HQ.

**P2:** gestión de dispositivos para HQ y administradores/gerentes de organización. No se implementaron playbooks, recomendador ni importador. Tampoco los módulos explícitamente excluidos del sprint.

## Migraciones, en orden

Requieren el esquema comercial actual, incluyendo la corrección 00030. **No volver a aplicar ni modificar migraciones históricas.** La prueba existente documenta que 00029 falla y 00030 la reemplaza; no usar 00029 como paso nuevo de esta entrega.

1. `20261018000031_sales_network_core.sql`: organizaciones, membresías, códigos, intentos y dispositivos; seed organizacional y backfill de admins activos.
2. `20261018000032_sales_network_opportunities_tasks.sql`: oportunidades, actividades, tareas, auditoría y acciones autorizadas.
3. `20261018000033_sales_network_orders.sql`: pedidos, pagos, documentos, notificaciones, bucket privado y workflow.
4. `20261018000034_sales_network_automation.sql`: reglas, dashboards, notificaciones leídas y gestión de dispositivos.
5. `20261018000035_sales_network_insights.sql`: metas, anuncios, módulos, branding y agregaciones P1.
6. `20261018000036_sales_network_demo_hardening.sql`: errores de activación, nombres, validaciones, idempotencia y regla de diez días en calendario CDMX.

Todas están delimitadas por `BEGIN/COMMIT`. Las seis son nuevas, nunca aplicadas por el agente a Supabase remoto. Aplicar primero en staging con respaldo y revisar el flujo antes de producción. El código final requiere también 00036: no habilitar la interfaz con solo 00031–00035.

## Tablas nuevas

`organizations`, `organization_memberships`, `dealer_activation_codes`, `network_activation_attempts`, `network_devices`, `opportunities`, `opportunity_activities`, `sales_tasks`, `network_audit_log`, `orders`, `order_payment_milestones`, `order_documents`, `network_notifications`, `sales_goals`, `network_announcements`, `organization_modules`.

Todas tienen UUID y `created_at`; las entidades mutables usan `updated_at` o marcas de actividad específicas. Incluyen FK, índices y restricciones. Hay una secuencia independiente para folios `NH-ORDER-00000001`.

## Seguridad y activación

`profiles.role` sigue intacto. HQ requiere membresía activa `NETWORK_OWNER/ORG_ADMIN` en la organización fabricante y perfil activo. El backfill solo agrega membresías faltantes de admins activos existentes.

El primer acceso a `/network` dirige a `/network/activate`. Supabase Auth debe haber autenticado previamente al usuario. HQ genera un secreto aleatorio de 256 bits, visible una vez; solo SHA-256 se persiste. Caduca a los siete días, con 20 usos por código emitido desde la UI. El modelo permite otros límites. Diez intentos por usuario cada 15 minutos, serializados mediante bloqueo transaccional.

La activación crea una membresía SELLER sin duplicarla, registra el dispositivo e incrementa uso bajo bloqueo. No reactiva membresías deshabilitadas ni dispositivos revocados. Los miembros existentes pueden seleccionar su organización sin volver a consumir un código.

Cookies HttpOnly/SameSite guardan organización y UUID aleatorio del dispositivo; no hay fingerprinting. El servidor valida perfil, membresía y dispositivo. El cliente Supabase de red transmite el UUID en `x-network-device`; las funciones de autorización PostgreSQL lo verifican. No se confía en la selección de la cookie por sí sola.

RLS limita lecturas a miembros de su organización o HQ. Las tablas de negocio no admiten escrituras directas de usuarios autenticados: se usan RPC con búsqueda de esquema fija, autorización, bloqueo y transacción. Códigos e intentos no son legibles por el cliente. Las FK compuestas impiden asociar actividades/tareas/documentos a entidades de otro dealer. En Beta, los miembros activos colaboran sobre los registros de su organización; no existe un reparto privado por vendedor dentro del mismo dealer.

La revocación bloquea nuevas solicitudes de ese dispositivo; no elimina Auth ni afecta el cotizador. Esta identidad de navegador no equivale a atestación física: un usuario autorizado puede registrar otro navegador como un dispositivo nuevo. Las URLs de documentos ya firmadas conservan su vigencia máxima de 60 segundos.

## Recorrido comercial y operativo

1. Crear oportunidad, seleccionar cliente propio existente y vendedor comercial, producto de interés y próxima acción.
2. “Crear cotización” abre `/seller` en otra pestaña. Generar con el flujo existente y regresar para “Vincular cotización”. Solo se admite una cotización propia no cancelada, no vinculada a otra oportunidad.
3. Se guarda snapshot de quote/items/add-ons y se mueve a QUOTED. La cotización original conserva sus permisos; otros miembros ven el snapshot compartido.
4. Registrar llamada, nota, correo o WhatsApp como actividad; esto **no envía mensajes**. Pasar a NEGOTIATION y luego WON. WON requiere cotización vinculada; LOST requiere motivo y nota para OTHER. Los cierres no se reabren en esta Beta.
5. “Convertir en pedido a Nahuitech” crea una única orden por oportunidad. Un segundo clic devuelve la misma. Importe sell-out queda como snapshot; `dealer_order_total` permanece nulo.
6. Dealer adjunta orden de compra. HQ fija monto sell-in y terminación estimada, y aprueba. Se crean dos milestones en PostgreSQL `numeric`: anticipo 50% y saldo 50%. Con centavo impar, anticipo se redondea y saldo absorbe el resto para conservar exactamente el total.
7. Dealer sube comprobante de anticipo: `DEPOSIT_SUBMITTED`. HQ ve documento, importe esperado, dealer, equipos y fecha en Finance Inbox. Rechazo exige motivo; puede volver a enviarse.
8. Validar anticipo marca el milestone VERIFIED y libera a `RELEASED_TO_PRODUCTION`. Solo entonces HQ puede iniciar producción.
9. Con fecha a diez días o menos, se crea la tarea/notificación de liquidación. El estado puede seguir IN_PRODUCTION; no se pierde el progreso por una etiqueta de pago.
10. Subir saldo cambia a BALANCE_SUBMITTED. Validarlo solo da READY_TO_SHIP si producción terminó. Si todavía no terminó, vuelve a IN_PRODUCTION hasta que HQ use “Marcar producción terminada”. También funciona terminar producción antes de validar saldo.
11. READY_TO_SHIP permite marcar enviado; SHIPPED permite entregado. No hay saltos arbitrarios ni edición del monto después de aprobar.

Las operaciones importantes generan auditoría con actor, entidad y metadata acotada: creación, etapa, vinculación, pedido, aprobación, comprobantes, validación/rechazo, producción, fechas, envío, entrega y configuración. No se guardan secretos ni binarios en el log.

## Motor de tareas

`refreshSalesNetworkTasks` invoca `refresh_sales_network_tasks`. Se ejecuta al abrir dashboard/tareas/detalle de pedido; HQ tiene una llamada agregada para toda la red. No hay cron instalado.

- QUOTED sin actividad relevante durante tres días: Contactar cliente.
- NEGOTIATION sin próxima acción futura ni tarea abierta: Intentar programar llamada.
- Cotización vinculada con al menos 13 días y oportunidad abierta: Cotización próxima a vencer. Vigencia comercial permanece en 15 días.
- WON sin pedido: Convertir venta en pedido.
- Aprobación HQ: Solicitar anticipo.
- IN_PRODUCTION/AWAITING_BALANCE con fecha `<= hoy + network_balance_request_days()` y saldo sin verificar: Solicitar liquidación, HIGH.

`network_balance_request_days()` es la fuente central de `BALANCE_REQUEST_DAYS_BEFORE_COMPLETION = 10`. No se duplica el número en componentes.

Una `automation_key` única por regla/entidad y `ON CONFLICT DO NOTHING` impiden duplicados, incluso al recargar. La Beta crea una tarea por regla y entidad; no reactiva automáticamente un recordatorio completado. Las tareas obsoletas por cierre, conversión o pago se completan automáticamente.

## Document Vault

Bucket `sales-network-documents` privado, máximo 8 MB por archivo; PDF/JPEG/PNG. El servidor comprueba sesión, RLS del pedido, organización, tamaño, MIME y firma de bytes. La ruta usa UUID de organización/pedido/archivo, no el nombre suministrado por el usuario.

La clave secreta solo se usa en servidor para subir y firmar después de autorizar. La RPC registra metadata y envía el pago a revisión de forma atómica. Si falla, se intenta retirar el objeto recién subido. Los documentos se sirven con URLs de 60 segundos y respuestas `private, no-store`. Storage no recibe archivos públicos.

## Dashboards y P1

Dashboard y HQ obtienen métricas agregadas en SQL. Pipeline es valor estimado abierto; “Cotizado del mes” cuenta únicamente cotizaciones vinculadas. El mes se calcula con el reloj de PostgreSQL. HQ agrega toda la red y muestra anticipos/saldos pendientes, tareas prioritarias y actividad por dealer.

Metas: monto sell-out del snapshot de cotizaciones vinculadas a oportunidades WON dentro del período `[inicio, fin)`. No se presenta como ingresos cobrados. La UI HQ configura metas organizacionales; columnas para usuario/vendedor quedan preparadas sin editor individual.

Leaderboard: oportunidades ganadas, sell-out ganado y cotizaciones vinculadas creadas este mes por vendedor comercial. Conversión = ganadas / (ganadas + perdidas). Demanda usa interés capturado y equipos de snapshots; no inventa capacidades ni usa IA. Scorecard presenta cifras, sin score 0–100 arbitrario.

Noticias son creadas por HQ con organización/audiencia/caducidad. La bandeja de notificaciones operativas es compartida por organización: marcar leída afecta esa bandeja común. Branding admite nombre visible, color y logo HTTPS. Flags SALES/ORDERS/ANALYTICS/NEWS controlan navegación; no son un mecanismo de revocación de permisos.

## Páginas y componentes

Páginas: `/network`, `/network/activate`, `/network/opportunities`, `/network/opportunities/[id]`, `/network/tasks`, `/network/orders`, `/network/orders/[id]`, `/network/notifications`, `/network/analytics`, `/network/news`, `/network/devices`, `/network/hq`, `/network/hq/orders`, `/network/hq/finance`, `/network/hq/devices`, `/network/hq/settings`, `/network/hq/dealers/[id]`. Descarga autenticada: `/network/documents/[id]`.

Componentes nuevos: `ActionForm`, `TaskList`, `OrderList`, `Goals`, `InsightsPanel`, `DashboardExtras`, `DeviceList`; shell/layout, loading y error boundary propios. CSS acotado a `.network`; tablero apilado en móvil, cards, estados, formularios con feedback y listas vacías reales.

Las listas operativas están acotadas (100/200 registros recientes); Analytics usa agregados completos y top 20/30 donde se indica. La Beta aún no tiene paginación histórica de listas.

## Pruebas y verificaciones

`npm test` incluye regresiones existentes y pruebas nuevas `sales-network.test.mjs` y `sales-network-server.test.mjs`. Las pruebas SQL ejecutan migraciones y funciones reales en PostgreSQL WASM aislado (PGlite); no son solo búsquedas de texto SQL. Auth/Storage del sistema se simulan como esquema mínimo, no como servicio remoto.

Cobertura: backfill; aislamiento ETM/SISCO; visibilidad HQ; escrituras directas denegadas; activación/autenticación/hash/membresía/límites; motivos LOST; vinculación propia; snapshot; etapas; idempotencia; WON→pedido; autorización sell-in; redondeo 50/50; documentos privados; rechazo/reenvío/validación; depósito→producción; umbral de liquidación; terminar producción/saldo/envío/entrega; auditoría; P1; dispositivo revocado; administración por organización; URLs firmadas y cookies de activación.

Para un checkout limpio, instalar la dependencia aislada de pruebas que ya utiliza el repositorio:

```powershell
npm.cmd install --prefix tmp/sql-validation --no-save --package-lock=false @electric-sql/pglite
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

PowerShell bloquea `npx.ps1`; usar `.cmd`, sin cambiar ExecutionPolicy. La única advertencia aceptada es el `<img>` preexistente de `quote-whatsapp-button.tsx`.

Resultados finales ejecutados localmente: `tsc --noEmit` correcto; lint con 0 errores y ese único warning preexistente; **136 pruebas aprobadas, 0 fallos y 0 omitidas**; build de producción completado y rutas de red generadas. También pasaron `git diff --check` y `node --check scripts/seed-sales-network-demo.mjs`. El seed no se ejecutó contra ningún servicio.

## Preparar staging y seed manual

No se ha desplegado ni ejecutado este seed. Estos pasos son para el operador, en un proyecto aislado de staging.

1. Instalar dependencias con `npm.cmd ci`. Confirmar el esquema comercial y aplicar las migraciones pendientes **31 → 32 → 33 → 34 → 35 → 36** según [el checklist](sales-network-migration-checklist.md). No resetear la BD ni reejecutar 00029.
2. Crear un archivo local ignorado `.env.sales-network-staging` con `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY` exclusivamente de staging. Confirmar máquina/variante/add-ons activos de catálogo. No copiar claves productivas.
3. Ejecutar manualmente el comando siguiente; la contraseña la elige el operador, no se incluye en git. Node 24 soporta `--env-file`.

```powershell
$env:SALES_NETWORK_ENV = 'staging'
# Completar también refs STAGING/PRODUCTION en el env-file según el runbook.
$env:SALES_NETWORK_DEMO_ALLOW_HOST = '<proyecto-staging>.supabase.co'
$env:SALES_NETWORK_DEMO_PASSWORD = '<contraseña de demo de al menos 12 caracteres>'
node --env-file=.env.sales-network-staging scripts/seed-sales-network-demo.mjs --allow-demo-seed
```

El hostname debe coincidir exactamente con el proyecto aislado. Sin flag, contraseña, entorno staging o autorización de hostname, se rechaza la ejecución antes de escribir. No se invoca en build/migraciones. No existe un DEMO_MODE que altere seguridad o datos: la badge Beta es solo presentación.

4. Levantar la aplicación local contra staging, con las mismas variables:

```powershell
node --env-file=.env.sales-network-staging node_modules/next/dist/bin/next dev
```

Abrir http://localhost:3000. Para ensayo del build de producción, detener dev y ejecutar con ese mismo env: `node --env-file=.env.sales-network-staging node_modules/next/dist/bin/next build`, seguido de `node --env-file=.env.sales-network-staging node_modules/next/dist/bin/next start`. Esto no despliega. Evitar que variables heredadas del shell apunten a otro proyecto; las variables ya exportadas tienen precedencia sobre env-file. No publicar el puerto ni el proyecto.

5. Abrir dos perfiles/navegadores separados: HQ y dealer. Preparar tres archivos de muestra PDF/JPG/PNG válidos, cada uno menor de 8 MB: orden de compra, anticipo y saldo. Son archivos de demostración; no representan pagos reales.

Cuentas creadas: `network-hq-demo@example.invalid` (profile admin activo + NETWORK_OWNER de NAHUITECH) y `network-etm-demo@example.invalid` (seller activo + SELLER de ETM). Ambas usan la contraseña suministrada; cuentas ya existentes no tienen su contraseña restablecida. Hay vendedor comercial DEMO independiente de Auth. El script imprime un código ETM una sola vez: guardarlo temporalmente para la presentación, no en el repositorio.

Datos: **Textiles Vega QUOTED**, **Grupo Industrial León NEGOTIATION**, **Confecciones del Bajío NEW**, meta mensual de $300,000, anuncio «Nuevo lanzamiento Nahuitech», tres tareas: Contactar Textiles Vega, Programar llamada y Cotización próxima a vencer. Las dos cotizaciones se crean por la RPC comercial existente con catálogo real. El recordatorio de vencimiento es manual y vence a +13 días: no se falsifica la antigüedad de la quote ni su vigencia.

Por defecto **no se crea pedido**: la conversión ocurre en vivo. `--with-order` se rechaza; los pedidos se convierten exclusivamente en vivo. El seed no manda WhatsApp ni resetea oportunidades cerradas; puede reanudarse, pero si se interrumpe entre crear y vincular quote puede dejar una quote sin vincular. Cada ejecución genera un código nuevo. Para repetir el recorrido usar el reset limitado por manifiesto descrito en el runbook de staging; nunca borrar ventas/pedidos ajenos al demo.

## Hardening y validación visual

Se corrigieron: feedback genérico de activación; vínculo repetido que podía degradar etapa; próxima acción borrada por seguimiento vacío; validación estricta de importe/fecha/LOST OTHER; contexto de acciones HQ; metadata de cliente/autor; umbral CDMX y notificaciones de saldo obsoletas. La producción y el saldo convergen en READY_TO_SHIP únicamente cuando ambas condiciones son verdaderas.

Dashboard, HQ, pedido y oportunidad tienen jerarquía nueva, chips comunes, navegación activa, dinero MXN, fechas CDMX, CTA contextual, confirmaciones y estados vacíos. El dashboard ordena tareas URGENT/HIGH/MEDIUM/LOW. Pedido muestra sell-out/sell-in separados, precio pendiente explícito, hitos, expediente, pagos, tareas y auditoría. Oportunidad muestra cliente/vendedor/próxima acción y cotización completa sin recalcularla.

La revisión visual usa componentes reales renderizados localmente con fixtures aislados en tmp; nunca son datos de la aplicación. Herramienta opcional: `node tests/render-network-preview.mjs` después del build. Se inspeccionaron dashboard y HQ en escritorio, pedido móvil a 390 px y oportunidad tablet a 768 px. Se comprobó ancho móvil de las diez vistas renderizadas; el ranking de Analytics se adaptó a filas apiladas. Esto no equivale a un E2E de navegador autenticado contra Supabase.

## Pendientes y límites antes de producción

- Ensayo de navegador autenticado con el proyecto de staging: activación, refresh de sesión, carga/descarga real de Storage y recorrido con dos identidades. El build y PostgreSQL local no sustituyen esa prueba.
- No se probó entrega real de WhatsApp, PDF visual ni offline en dispositivos durante esta entrega; sus archivos comerciales no se modificaron y pasaron las regresiones existentes.
- No hay cron: la automatización se refresca al consultar las pantallas indicadas.
- No hay reapertura de oportunidades cerradas, cambio de cotización vinculada, edición de monto aprobado ni cancelación operativa desde UI.
- No hay pagos parciales, múltiples abonos por milestone ni integración bancaria. La validación HQ es manual.
- Los permisos internos son colaboración por organización. Cuentas compartidas de Expo siguen existiendo comercialmente; usar usuarios Auth distintos por dealer para la demo de aislamiento.
- El seed y la configuración de Storage/Auth remota deben validarse en staging; no desplegar ni sembrar directamente producción a partir de esta entrega.
