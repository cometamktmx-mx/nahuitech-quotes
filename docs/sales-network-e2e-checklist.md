# Sales Network — ensayo E2E real en staging

**Pendiente de ejecutar por Camilo.** Ninguna casilla representa una validación remota hecha por el agente. Ejecutar después del [runbook](sales-network-staging-runbook.md). Registrar fecha, ref staging, rama/SHA, navegador, resultado y folio; nunca pegar passwords, códigos de activación, JWT, URLs firmadas ni documentos bancarios reales.

Proyecto/ref: __________ · Rama/SHA: __________ · Operador/fecha: __________

## Preparación

- [ ] Ambas sesiones apuntan al mismo origen staging/local y a Supabase STAGING.
- [ ] Browser A = `network-hq-demo@example.invalid` (admin + NETWORK_OWNER NAHUITECH).
- [ ] Browser B = `network-etm-demo@example.invalid` (profile seller, inicialmente SIN membership Network), en perfil separado. Usar [reset de activación](sales-network-demo-entry-hotfix.md) si ya se activó.
- [ ] Seed completado, manifiesto conservado, código ETM disponible fuera de logs compartidos.
- [ ] Preparar tres archivos de muestra PDF/JPG/PNG ≤8 MB para OC/anticipo/saldo. No pagar ni mandar WhatsApp.
- [ ] El build de prueba no contiene URL productiva. Revisar hostname de requests en DevTools sin copiar headers.

## Recorrido principal

| Hecho | Browser / URL | Acción exacta | Resultado esperado |
|---|---|---|---|
| [ ] | B /login | Iniciar sesión ETM | Sesión válida |
| [ ] | A /network y /network/activate | Entrar como HQ | /network/hq sin código de distribuidor |
| [ ] | B /network/activate | Código ETM → Activar acceso | Dispositivo registrado, ETM visible; no sustituye Auth |
| [ ] | B /network | Inicio | Cinco métricas, Tu día, pipeline y meta reales |
| [ ] | B /network/opportunities | Textiles Vega | QUOTED, cliente/vendedor visibles |
| [ ] | B detalle oportunidad | Ver cotización | Folio y snapshot vinculados, importe sell-out igual al original |
| [ ] | B detalle oportunidad | Nota/llamada → Guardar seguimiento | Actividad registrada; próxima acción vacía no borra fecha existente |
| [ ] | B detalle oportunidad | Negociación → Actualizar etapa | NEGOTIATION y activity |
| [ ] | B detalle oportunidad | Ganada → Actualizar etapa | WON y botón Convertir en pedido |
| [ ] | B detalle oportunidad | Convertir en pedido, confirmar | Un solo pedido PENDING_HQ_REVIEW; precio dealer pendiente, no $0 |
| [ ] | A /network/activate | NAHUITECH → Entrar a organización | HQ autorizado, dispositivo propio |
| [ ] | A /network/hq/orders | Abrir folio ETM → Revisar pedido | Dealer/cliente/sell-out y revisión visibles |
| [ ] | A detalle pedido | 100000.00, fecha hoy +10 días CDMX → Aprobar pedido | AWAITING_DEPOSIT; sell-in independiente |
| [ ] | A detalle pedido | Revisar pagos | Anticipo 50000.00 + saldo 50000.00, ambos 50% |
| [ ] | B detalle pedido, recargar | Orden de compra → Subir documento | OC privada; nombre/tipo/fecha/autor y Ver |
| [ ] | B detalle pedido | Comprobante anticipo → Subir documento | DEPOSIT_SUBMITTED, milestone SUBMITTED |
| [ ] | A /network/hq/finance | Ver comprobante | Archivo real abre; firma corta, sin URL pública |
| [ ] | A /network/hq/finance | Validar anticipo, confirmar | DEPOSIT VERIFIED y RELEASED_TO_PRODUCTION |
| [ ] | A detalle pedido | Iniciar producción | IN_PRODUCTION + timestamp/auditoría |
| [ ] | A detalle pedido | Verificar fecha ≤10 días; Actualizar fecha si corresponde | Fecha persistida y cambio auditado |
| [ ] | B /network y /network/tasks | Recargar | REQUEST_BALANCE «Solicitar liquidación», HIGH |
| [ ] | B /network/notifications | Abrir notificaciones | Aviso de liquidación; refrescar dos veces no duplica tarea/aviso |
| [ ] | B detalle pedido | Comprobante saldo → Subir documento | BALANCE_SUBMITTED; documento nuevo |
| [ ] | A /network/hq/finance | Ver comprobante → Validar saldo | BALANCE VERIFIED, todavía NO READY_TO_SHIP si producción sigue abierta |
| [ ] | A detalle pedido | Marcar producción terminada | **READY_TO_SHIP**, ambas condiciones completas y notificación |
| [ ] | A detalle pedido | Marcar enviado | SHIPPED, timestamp y audit |
| [ ] | A detalle pedido | Marcar entregado | DELIVERED, timestamp y audit |

ID oportunidad: __________ · Folio pedido: __________ · Resultado: __________

## Casos negativos obligatorios

- [ ] Sin sesión: /network/activate exige login; código no autentica.
- [ ] Código incorrecto, expirado y agotado: mensajes claros, sin membership nuevo ni consumo extra. Para expirado/agotado preparar un código de prueba dedicado en staging; no reutilizar el principal.
- [ ] Membresía inactiva: bloquea acceso y activación no la reactiva.
- [ ] HQ revoca dispositivo del browser B: siguiente petición a Network bloqueada. Usar dispositivo de ensayo aparte para no bloquear el recorrido principal; no eludir revocación.
- [ ] LOST sin reason falla; OTHER sin nota falla. Usar oportunidad separada, nunca cerrar la principal durante ensayo.
- [ ] Vincular quote propia conserva importe; repetir vínculo no duplica activity ni degrada NEGOTIATION.
- [ ] Quote/pedido/documento de otro dealer no puede verse/vincularse desde ETM. Preparar un SISCO de prueba desde HQ si hace falta. Con tablas vacías no se considera probado.
- [ ] ETM abre /network/hq/finance o intenta aprobación/validación: denegado en servidor. Ocultar botón no es la única defensa.
- [ ] Monto 0, negativo, >2 decimales o fecha inválida: rechazo; no milestones parciales.
- [ ] Archivo vacío, >8 MB, formato distinto, extensión PDF con contenido inválido: error amigable, no documento registrado.
- [ ] Rechazar anticipo exige motivo; ETM ve motivo, reenvía y HQ valida. Repetir con saldo en otro ensayo.
- [ ] Abrir documento sin sesión/dealer ajeno: denegado. No firmar ni mostrar una URL privada en error.
- [ ] Iniciar producción antes de anticipo verificado o enviar antes de READY_TO_SHIP: denegado.
- [ ] Ensayo separado: terminar producción antes de saldo → AWAITING_BALANCE; validar saldo después → READY_TO_SHIP.
- [ ] Regla de fecha: pedido nuevo en producción a +11 días no genera tarea; cambiar a +10 sí; a +9 y dos refresh conserva una; saldo VERIFIED no genera una nueva. Usar pedido nuevo para +11, pues una tarea previamente creada no prueba ausencia inicial.
- [ ] Auditoría refleja creación, aprobación, pagos, fecha, producción, envío y entrega con actor correcto.
- [ ] /seller, /admin y cuenta expo de staging conservan acceso esperado; crear cotización sin enviar WhatsApp. No probar mensajes reales.

## Evidencia y cierre

- [ ] Revisar stdout/runtime logs: eventos seguros, sin datos sensibles. Registrar solo duración/evento/resultado.
- [ ] Registrar latencias observadas de dashboard, aprobación y upload. Si una consulta/página tarda >2 s de forma repetida, registrar duración y revisar plan/servicio antes de demo; no atribuir tiempos locales a red real.
- [ ] Adjuntar capturas sanitizadas de pedido pendiente, 50/50, producción y READY_TO_SHIP; ocultar datos de acceso.
- [ ] Ejecutar reset con browsers cerrados y resembrar; confirmar tres oportunidades iniciales, cero pedidos del recorrido anterior y que no desapareció otro registro de staging.
- [ ] Si falla cualquier permiso o aislamiento: no presentar como validado, detener ensayo y documentar el caso exacto.

Resultado final: PASS / FAIL / PENDIENTE __________ · Firma Camilo: __________
