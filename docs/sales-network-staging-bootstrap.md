# Bootstrap comercial limpio — investigación y corrección

19 octubre 2026. Solo generación/pruebas locales. No se modificó ninguna migración 00000–00036, código comercial, precio, IVA, PDF, Twilio ni Sales Network. No se ejecutó remoto.

## Fallo exacto y evidencia

El error se dispara en `20260824000010_catalog_rules_data.sql`, líneas 140–156: `_catalog_addon_ids.addon_id` es NOT NULL y el INSERT de la línea 145 resuelve cada clave mediante un subquery a `public.addons`, comparando `lower(btrim(target.name)) = lower(btrim(source.name))`. Si no encuentra fila, el subquery escalar devuelve NULL.

La clave temporal `laser-guide` corresponde a **Kit de Láser con Guía** (línea 89). No es una columna slug de addons ni el mismo producto que **Laser en cruz extra**. Antes del INSERT, el UPDATE de la línea 107 reconoce el nombre inicial sin acento en Laser y lo normaliza al nombre con acento.

En los archivos fuente originales UTF-8:

- 00004, línea 60: `Kit de Laser con Guía`, con `í` U+00ED.
- 00010: nombre final `Kit de Láser con Guía`; alias de comparación `kit de laser con guía`.

En el `baseline-combined.sql` que falló, la misma `í` se había convertido en **U+00C3 U+00AD** (`Ã` + soft hyphen). Se encontró también BOM. Esto es compatible con leer bytes UTF-8 usando una codificación occidental y volver a escribirlos; no se conoce el comando exacto que produjo ese archivo.

PostgreSQL convierte U+00C3 `Ã` en U+00E3 `ã` al ejecutar lower(). El literal de alias en 00010 conserva U+00C3 porque no pasa por lower(). Entonces:

1. El UPDATE no reconoce el nombre inicial corrupto.
2. El nombre inicial conserva `Laser`; el nombre final esperado contiene la versión acentuada corrupta.
3. El subquery de `_catalog_addon_ids` no encuentra la identidad normalizada.
4. Resultado **23502, `(laser-guide, null)`**.

Se reprodujo exactamente ese código y detalle en PostgreSQL local. El BOM se retiró únicamente para simular el texto que el editor había enviado; no se reparó ningún dato remoto. El test permanente reconstruye la corrupción y exige el mismo error.

Las pruebas anteriores leían cada fuente como UTF-8 y ejecutaban archivos separados. No verificaban el artefacto combinado entregado al SQL Editor. Ese hueco ahora está cubierto.

## Historia y dependencias reales

| Fuente | Efecto |
|---|---|
| 00004 | Inserta Kit de Laser con Guía, FIXED, $4,000, opcional/activo, UUID generado por BD. Inserta por separado Laser en cruz extra, FIXED, $2,000 |
| 00004 compatibilidades | Kit y láser extra se vinculan a máquinas con soporte de addons. No son Base de Apoyo, que tiene reglas propias |
| 00009 | Habilita reglas comerciales y tipo QUANTITY |
| 00010 | Renombra el kit a Kit de Láser con Guía; conserva $4,000/FIXED; descripción de dos láseres en cruz. Quita addons de Tri-Basic; Intro queda con Base para Estación; limpia overrides iniciales y aplica override OME/Doble Tiempo |
| 00021 | Precios oficiales de máquinas/variantes; no convierte ni renombra el kit láser |
| 00026 | Cambia dos IDs fijos a QUANTITY: `d2486323-5daa-418a-8cc3-f25215f1357b` y `a3efa6fd-05cb-4917-96d1-67a0d81c7a45` |
| seller/quote/actions.ts:229–244 | Identifica explícitamente esos IDs como **Laser en cruz extra** y **Sistema de Doble Tiempo**; aplica máximo 4 al láser extra, 2 al Doble Tiempo OME y 1 en otras máquinas |
| 00028 | Añade display_order, ordenando por created_at y UUID; una inserción en lote empata timestamps y el UUID aleatorio hace variable el orden en una BD nueva |

**El kit laser-guide no depende de una fila previa de producción:** existe en 00004. Su fallo es de codificación del artefacto. **00026 sí depende de identidades de producción**, pues los UUID aleatorios de 00004 no coincidirían. No se adivinaron UUID: las dos identidades están documentadas por constantes del cotizador y corroboradas por 00026. No se asigna un UUID ficticio al kit.

Compatibilidad final del kit y del láser extra: OME, Pro 8, Pro 6, Compact 4 y Basic 4. El kit permanece FIXED; el láser extra termina QUANTITY. No tienen override de precio; OME/Doble Tiempo mantiene override $28,990 y su descripción.

## Solución staging exclusiva

`scripts/lib/staging-baseline.mjs` construye un artefacto consolidado del schema comercial hasta 00030 a partir de fuentes UTF-8 estrictas. No reescribe funciones, RLS, grants ni precios. Excluye 00029 y conserva 00030 con ambas sobrecargas preview.

Ajustes **solo dentro del SQL generado**:

1. Preflight que rechaza cualquier schema comercial ya construido/parcial.
2. Identidades de los dos addons anteriores antes de crear sus relaciones en 00004, de modo que 00026 y las validaciones existentes del vendedor funcionen. No cambia tablas remotas ni actualiza identidades con FK existentes.
3. Fronteras BEGIN/COMMIT para fuentes que no las tenían. La prueba del archivo completo descubrió además `55P04 unsafe use of new value expo`: 00012 debe confirmar su ALTER TYPE antes de usar expo en 00013. No envolver todo el bootstrap en otra transacción.
4. Display order determinista para staging: orden declarado por el seed inicial, seguido de Base para Estación. Se conserva la columna/índice de 00028. Esto evita empates por UUID aleatorio; **no afirma reproducir un orden editado manualmente en producción**, que no se consultó.
5. Assertions finales del catálogo y archivos UTF-8 sin BOM. Manifest con SHA256 de fuentes y artefactos.

Es consolidado para instalación, no un dump tomado de producción. Mantiene los fragmentos históricos correctos para preservar exactamente sus definiciones; excluye el bug 00029 y corrige los problemas de ensamblado/identidad del arranque vacío. Los UUID restantes son nuevos y válidos; la reproducibilidad es de schema, catálogo lógico y comportamiento, no de todos los UUID/timestamps.

## Generación y orden de ejecución

```powershell
node scripts/prepare-sales-network-staging.mjs
```

Produce en `tmp/sales-network-staging-plan/`:

- `baseline-combined.sql`: bootstrap comercial válido, hasta 00030.
- `network-combined.sql`: 00031 → 00036, fuentes sin cambios y separado del comercial.
- `baseline.psql` / `network.psql`: ON_ERROR_STOP e inclusión del archivo combinado correspondiente.
- `manifest.json`: fuentes, identidades justificadas, orden staging y hashes.

`node scripts/build-staging-baseline.mjs` genera solo el comercial; para ambos y manifiesto usar prepare. No concatenar archivos con Get-Content/Out-File de Windows PowerShell con codificaciones implícitas. Abrir SQL como UTF-8 en editor y comprobar visualmente **Kit de Láser con Guía** antes de copiar todo al SQL Editor.

Orden para Camilo: **reset protegido del MISMO staging → baseline-combined.sql → catálogo → network-combined.sql → Auth → seed → E2E**. Ver [procedimiento de reset](sales-network-staging-reset.md). 00029 permanece excluida.

El artefacto conserva commits internos por necesidad de enums y no es rollback global. Si cualquier fase falla, parar; no continuar con Network. Usar el reset protegido del mismo staging si aún no contiene usuarios/datos.

## Staging parcial actual

Reutilizar **el mismo proyecto staging**, sin crear otro. Seguir [reset de schema protegido](sales-network-staging-reset.md): generador local con env/refs/host, marca manual temporal, reset transaccional RESTRICT y verificación limpia. Conservar las mismas credenciales staging. No ejecutar en producción.

## SQL de verificación (solo lectura)

```sql
select slug,name,base_price,active from public.machines order by sort_order;
select id,name,unit_price,calculation_type,display_order,active from public.addons order by display_order;
select m.slug,a.name,ma.active,ma.unit_price_override,ma.description_override
from public.machine_addons ma join public.machines m on m.id=ma.machine_id
join public.addons a on a.id=ma.addon_id order by m.slug,a.display_order;
select m.slug,v.variant_type,v.price,v.active from public.machine_variants v
join public.machines m on m.id=v.machine_id order by m.slug,v.sort_order;
select name,id,calculation_type from public.addons
where name in ('Kit de Láser con Guía','Laser en cruz extra','Sistema de Doble Tiempo');
select p.oid::regprocedure,p.prosecdef,p.proconfig from pg_proc p
join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
and p.proname in ('create_quote','create_multi_quote','preview_multi_quote_coupon','preview_quote_coupon');
-- 5 firmas: incluye preview de 3 y 4 argumentos.
```

Esperado: 10 máquinas activas, 9 addons activos, 36 machine_addons activos, 10 filas de variantes (9 activas), display_order 1–9. Kit: UUID real, FIXED, $4,000. Extra: UUID documentado, QUANTITY, $2,000. Doble Tiempo: UUID documentado, QUANTITY. Intro solo Base para Estación, Tri-Basic ninguno, OME sin Pedal Sencillo. Precios y variantes oficiales se verifican en tests, incluyendo IVA existente sin recalcular ni modificar su lógica.

## Evidencia local y límite

Tests ejecutan el **archivo combinado emitido** en una sola llamada a PostgreSQL vacío (PGlite) con schemas mínimos Auth/Storage, prueban las cinco RPC como admin y aplican luego Network intacto. La suite completa Sales Network ahora arranca sobre el mismo builder. Ninguna comprobación equivale a probar infraestructura remota Auth/Storage; esa parte sigue en el checklist E2E.

Resultado final: **147 pruebas aprobadas, 0 fallos, 0 omitidas** (~17.5 s). TypeScript correcto; lint sin errores salvo warning histórico de `<img>`; build completo (compilación 4.7 s, TypeScript 6.0 s). Se compararon dos bases vacías independientes: mismo catálogo lógico, precios, variantes, compatibilidades, cantidades y display order. `git diff` confirma cero cambios en `supabase/migrations` y `src`. No hubo commit, push, deploy ni ejecución remota en esta corrección.
