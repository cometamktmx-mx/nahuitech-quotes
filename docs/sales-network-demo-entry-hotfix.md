# Entrada HQ / ETM — ensayo de hoy

Solo app y tooling local; no migraciones ni acciones remotas. Usar la rama `feat/sales-network-beta` y el mismo staging. Mantener el manifiesto `tmp/sales-network-demo-<staging-ref>.json` generado por el seed.

## Diagnóstico confirmado

El seed anterior creaba Auth/profile para ambos usuarios, membresía HQ NETWORK_OWNER y ETM SELLER, y dispositivos de ambos para ejecutar las RPC de preparación. La página `/network/activate` mostraba el código siempre, seguido del selector de membresías. `/network` requería las cookies `network_org`/`network_device` y autorización SQL `network_access`. El cotizador acepta perfiles seller independientemente de Network; entrar a `/seller` no demuestra activación Network.

## Ahora

- Una membresía activa en organización activa: se selecciona automáticamente. Si hace falta, una Server Action registra/valida el dispositivo y guarda contexto. Una membresía de fabricante NETWORK_OWNER/ORG_ADMIN lleva a `/network/hq`. No se llama al RPC de código ni se incrementa su uso. Dispositivo revocado sigue bloqueado.
- Varias membresías: `/network/activate` muestra **Selecciona una organización**, sin campo de código. Se conserva una selección ya validada para navegar dentro de Network.
- Sin membresías: **Activa tu dispositivo → Código de distribuidor → Activar acceso**. La RPC existente crea membership SELLER + device e incrementa use_count. Sesión Auth y profile activo siguen obligatorios.
- Al volver a iniciar sesión, una membresía válida evita pedir otro código, incluso sin cookies de selección. El cotizador sigue accesible sin Network; su CTA muestra **Activar Sales Network** antes y **Sales Network** después.
- El seed nuevo crea HQ como **NAHUITECH HQ**, con su membresía y dispositivo técnico HQ. ETM conserva Auth/profile seller/salesperson; no se crea membership ni device ETM. Las cotizaciones se crean mediante la RPC comercial existente y los fixtures Network mediante el cliente administrativo staging. Rerun del seed conserva un ETM ya activado: usar el reset específico para volver al inicio.

## Reset únicamente de activación ETM existente

Cerrar las pestañas que puedan enviar acciones ETM durante el reset. En el mismo equipo/directorio donde se ejecutó el seed:

```powershell
node --env-file=.env.sales-network-staging scripts/reset-sales-network-demo-activation.mjs --allow-demo-activation-reset
```

Exige `SALES_NETWORK_ENV=staging`, refs staging/production distintos, URL/allow-host staging exactos, keys staging y manifiesto local del destino. Verifica emails y app_metadata de ambas identidades demo, slug ETM y propiedad del código. Si falta manifiesto o detecta otra membresía/rol, se niega; no inventar un manifiesto ni quitar guards.

Elimina solo membership SELLER ETM, devices ETM y rate-limit attempts del usuario demo ETM. Rota el código demo verificado a uno nuevo, activo, con use_count=0 y vigencia de 7 días; lo imprime una sola vez y guarda solo su ID en el manifiesto. El código anterior queda invalidado. Manifiestos anteriores sin ID usan el último código ETM emitido por la identidad HQ demo verificada. No toca códigos de usuarios HQ normales. Las operaciones REST son repetibles, pero no constituyen una transacción: ante error, mantener el ensayo detenido y repetir el comando.

No elimina Auth, profile, salesperson, organización, oportunidades, tareas, metas, quotes, pedidos ni catálogo. No puede borrar cookies del navegador desde CLI: quedan inertes porque el servidor verifica membresía/dispositivo en cada acceso. No usar el reset completo del schema ni el reset general de datos para este ensayo.

## Volver a probar

1. Browser A: login `network-hq-demo@example.invalid` → Sales Network → HQ. Visitar `/network/activate`: no debe aparecer código.
2. Browser B: login `network-etm-demo@example.invalid` → **Activar Sales Network** → `/network/activate` (recargar completamente si estaba abierto). El código incorrecto debe dar un error claro.
3. Pegar **el nuevo código impreso por el reset** → **Activar acceso** → dashboard ETM con los mismos datos.
4. Cerrar sesión desde el cotizador, volver a login ETM → Sales Network → dashboard sin otro código.
5. Para repetir onboarding, volver a ejecutar el mismo reset y usar su nuevo código. Para repetir el recorrido de pedidos completo, consultar el reset de datos demo por separado.

Este hotfix debe estar ejecutándose en la app local/preview staging para observar la UX nueva. No se desplegó desde esta entrega.

Validación local: 167 tests aprobados, cero fallos/omitidos (~23.5 s); tsc correcto; lint con solo el warning histórico de `<img>`; build correcto. Incluye el seed completo dos veces contra PostgreSQL local, reset/activación real SQL repetida y pruebas de páginas/actions con dependencias de Next simuladas. El ensayo de browsers contra staging sigue siendo manual; no se ejecutó remoto.
