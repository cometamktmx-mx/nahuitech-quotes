# Fotografías de catálogo y precios netos

## Implementación

1. **Migración nueva:** `20260905000020_machine_images.sql`. Prepara Storage y reemplaza `create_quote` únicamente para ampliar la validación del snapshot de imagen. No modifica migraciones anteriores ni precios del catálogo.
2. **Storage:** bucket público `machine-images`, límite de 8 MB, MIME PNG/JPEG/WEBP. La aplicación normaliza a JPEG, lado máximo 2000 px, calidad 90, orientación corregida, sin ampliar imágenes pequeñas. Valida el formato real con Sharp y limita la decodificación a 40 megapíxeles.
3. **Políticas:** lectura pública; INSERT/UPDATE/DELETE solo para usuarios autenticados que cumplen `public.is_admin()` (administrador activo). Seller, Expo y anónimo no reciben escritura. Las acciones usan la sesión del administrador, sin `service_role` en navegador.
4. **Admin:** crear/editar permite seleccionar archivo, preview, cambiar y eliminar; se aplica al pulsar Guardar máquina. Errores de tamaño/formato/subida se muestran en el formulario.
5. **image_url:** primero sube una versión a `machines/{machine_id}/{version_uuid}.jpg`; después guarda su URL pública. Al eliminar guarda NULL. Sin selección nueva conserva el valor existente en DB. Si falla la escritura principal de máquina, intenta retirar el archivo recién subido.
6. **Refresco offline:** sincronizar precarga las fotografías activas en `nahuitech-machine-images-v1`. La URL nueva fuerza una clave nueva. El caché anterior permanece para snapshots; la sincronización no se anuncia completa si una imagen nueva no se pudo descargar. Una versión ya cacheada sigue disponible si falla su descarga de comprobación.
7. **Snapshot de imagen:** cotizaciones nuevas guardan la URL; las pendientes offline envían la versión capturada. La RPC admite versiones existentes en Storage que pertenecen a la máquina y conserva los assets locales históricos. Reemplazar/eliminar retira la imagen del catálogo, pero conserva los archivos anteriores como archivo histórico, incluso para cotizaciones aún no sincronizadas. No hay purga automática de ese archivo.
8. **Helper compartido:** `src/lib/quotes/tax.ts`: `grossToNet`, `calculateIncludedTaxBreakdown` y `netDiscount`. Este último resta los netos redondeados de configuración y total final para que el descuento mostrado cierre a centavos.
9. **Seller:** tarjetas, variantes, configuración y detalle muestran precios netos. Incluye el catálogo offline. El total final conserva IVA. Sincronizar refresca la vista del servidor.
10. **Add-ons:** precio unitario neto y total de línea convertido desde el bruto completo. Conserva FIXED, QUANTITY, PER_BASE, overrides y multiplicación por ocho bases de OME.
11. **Cupón:** misma validación comercial y descuento bruto. Solo cambia su presentación neta; el total económico no cambia.
12. **RPC:** `quote_variant_configuration` y `preview_quote_coupon` mantienen precios y resultado comercial brutos. `create_quote` ya calcula `round(total / 1.16, 2)` y `round(total - subtotal, 2)` en PostgreSQL, después del cupón; se conserva esa lógica y los campos fiscales existentes. React no envía importes fiscales. La RPC de preview conserva su contrato bruto; las vistas derivan su desglose con el helper.
13. **PDF:** conceptos y beneficio netos; resumen Subtotal, IVA 16%, TOTAL/PRECIO FINAL. El navegador lee bytes cacheados y conserva la opción `machineImageBytes`. El servidor acepta fotos públicas del Storage del proyecto y assets locales, convirtiéndolos a PNG para pdf-lib. WhatsApp utiliza este mismo generador; Twilio no cambia.
14. **Precios en Admin:** continúan brutos. Etiquetas y ayuda aclaran IVA incluido en base, versiones, add-ons y overrides.
15. **Offline:** IndexedDB conserva los importes comerciales y sus snapshots; los campos fiscales existentes contienen neto/IVA. La sincronización vuelve a validar en servidor. Fotografías públicas viven en Cache Storage; documentos autenticados conservan su caché separado. Service worker y proveedor usan v5 y preservan el caché de fotografías.
16. **Histórico:** sin reescrituras masivas. Conserva significado de precios de variantes, unitarios, líneas, subtotal comercial y total. Si faltan snapshots fiscales, detalle/PDF derivan IVA desde total para presentación.
17. **Validación local:** `npx.cmd tsc --noEmit`, `npm.cmd run lint`, `npm.cmd run build` y `node scripts/verify-catalog-pricing.cjs`. Se usan ejecutables `.cmd` porque PowerShell bloquea los wrappers `.ps1`. El script cubre A–E, tres tipos de add-on, overrides, cupones fijos/porcentaje, más de 72 mil totales en centavos, versiones de imágenes cacheadas y generación de PDF sin red. No sustituye las pruebas con sesiones reales contra Supabase.
18. **Orden exacto:** en una base al día hasta `20260825000019_update_machine_variant_prices.sql`, aplicar únicamente `20260905000020_machine_images.sql`, luego desplegar la aplicación. En una base nueva, aplicar todas las migraciones existentes en orden lexicográfico y esta al final. No reaplicar ni editar migraciones registradas como aplicadas.
19. **Pasos manuales de Storage:** ninguno de creación/configuración adicional: la migración prepara bucket y políticas. Verificar en Dashboard que el bucket es público y tiene límite 8 MB y las cuatro políticas nuevas. La aplicación usa la configuración Supabase existente. Esta tarea no aplica migraciones remotas ni despliega.

## Pruebas de integración al aplicar la migración

- Entrar como admin, crear una máquina con PNG; comprobar preview, guardar y URL bajo su UUID. Editarla con JPG/WEBP y comprobar que cambia la versión, no el UUID de máquina. Renombrar y confirmar que la foto sigue funcionando.
- Eliminar la fotografía y guardar: `image_url IS NULL`, placeholder en seller. Las URLs históricas deben seguir accesibles.
- Rechazar archivo no admitido y mayor de 8 MB; comprobar que un fallo de subida no reemplaza la referencia vigente.
- Con sesiones seller, Expo y sin sesión, comprobar que Storage rechaza INSERT/UPDATE/DELETE. Admin activo debe poder realizarlos.
- OME automática: 215,508.62 + 34,481.38 = 249,990.00. Semi: 101,724.14 + 16,275.86 = 118,000.00.
- Add-on FIXED 4,000: 3,448.28. Acople: 5,387.93 por base; ocho bases: línea 43,103.45. El resumen usa el total bruto completo, no suma unidades netas redondeadas.
- Aplicar cupón fijo y porcentual; comparar total con el resultado comercial anterior y verificar Subtotal + IVA = Total.
- Sincronizar online, desconectar, abrir catálogo y generar PDF: foto visible. Crear quote offline con esa foto, reemplazarla desde otro dispositivo, reconectar y verificar que la cotización pendiente conserva su versión y las nuevas usan la nueva.
- Abrir quote histórica sin campos fiscales; revisar detalle/PDF y confirmar que no se escribe ningún cambio histórico.
- Revisar selección Expo/salesperson, auth, historial y envío WhatsApp/PDF con las cuentas de prueba habituales.

## Límites operativos

La validación local terminó con TypeScript, lint y build aprobados. El PDF de prueba se generó con la red deshabilitada, se renderizó y se inspeccionó visualmente; también se verificaron los importes mediante extracción de texto. Se probaron la conversión real PNG/JPEG/WEBP con Sharp, el rechazo de archivos inválidos/grandes y la igualdad de la RPC anterior y nueva fuera del bloque de validación de imagen. Las pruebas contra Supabase real y sesiones admin/seller/Expo permanecen pendientes de aplicar la migración.

La disponibilidad offline requiere una sincronización exitosa y que el navegador conserve su almacenamiento. La UI conserva la generación sin imagen para snapshots cuyo asset nunca estuvo disponible. Se retienen versiones antiguas de fotos deliberadamente; cualquier futura limpieza debe considerar también cotizaciones pendientes en dispositivos offline. Las subidas usan Server Actions: el límite de Next es 10 MB para admitir 8 MB más el multipart; un alojamiento con un límite HTTP inferior necesitará ajustar ese límite o utilizar subidas directas autenticadas.
