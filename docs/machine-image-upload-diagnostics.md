# Diagnóstico de subida de fotografías

## Evidencia obtenida

Consulta de solo lectura al endpoint público del proyecto configurado en `.env.local`, sin claves secretas ni sesión privilegiada:

```json
{
  "httpStatus": 400,
  "statusCode": "404",
  "error": "Bucket not found",
  "message": "Bucket not found"
}
```

Se consultó un objeto deliberadamente inexistente (`__diagnostic_missing__`). **Este resultado no es el error de una subida autenticada.** No distingue un bucket ausente de uno privado/no accesible. Tampoco confirma que el sitio publicado utilice el mismo proyecto que `.env.local`.

No había navegador conectado ni una sesión admin utilizable desde las herramientas. El log local existente no contenía el error original de Storage. Por tanto, no se ha confirmado aún la causa raíz del upload, la existencia de las policies remotas ni el resultado con el admin real.

## Recorrido inspeccionado

- `src/app/admin/catalog/catalog-manager.tsx` envía el formulario a `saveMachine`.
- `src/app/admin/catalog/actions.ts`, `saveMachine`, obtiene el cliente autenticado y llama `uploadMachineImage` para subir y reemplazar. Reemplazar crea una versión nueva con `upsert: false`.
- `src/lib/machine-images.server.ts`, `uploadMachineImage`, transforma con Sharp y ejecuta `storage.from('machine-images').upload(...)`.
- Path: `machines/{machineId}/{uuid}.jpg`. El ID de máquina se valida como UUID; el nombre comercial no participa. El path exacto del fallo real aparecerá en `[machine image upload context]`.
- Bytes: JPEG; extensión `.jpg`; `contentType: 'image/jpeg'`, aunque la entrada sea PNG o WEBP.
- Eliminar desde el formulario guarda `image_url = NULL`; preserva archivos históricos. No ejecuta DELETE en Storage. Las únicas llamadas a `.remove()` son la limpieza de una subida nueva si falla el guardado principal de la máquina. Se agregó log seguro a esos errores de limpieza.

## Instrumentación temporal

Antes del upload se ejecutan `auth.getUser()` y SELECT del perfil asociado. Se exige `role = 'admin'` y `active = true`. El cliente sigue usando la publishable key y la sesión normal de cookies. No se utiliza `SUPABASE_SECRET_KEY` para este diagnóstico ni para subir.

En error, el servidor imprime `[machine image upload error]` con una lista cerrada de propiedades escalares presentes: `name`, `message`, `statusCode`, `error`, `status`, `code`. El SDK instalado declara `status`/`code`; `error` solo se incluye si existe realmente. No se imprime el error completo, `originalError`, JWT, cookies, headers, claves ni sesión.

`[machine image upload context]` muestra únicamente bucket, path, MIME, bytes y comprobación de admin. Los fallos previos de autenticación/perfil llevan prefijos separados. El mensaje amigable de UI permanece igual; no hay cambios visuales.

## Migración auditada

`20260905000020_machine_images.sql` permanece intacta. Su contenido declara:

- Bucket `machine-images`, `public = true`.
- Límite `8388608` bytes (8 MiB).
- MIME `image/jpeg`, `image/png`, `image/webp`.
- SELECT público; INSERT/UPDATE/DELETE de authenticated sujetos a bucket y `public.is_admin()`.
- `is_admin()` en la migración original es SECURITY DEFINER, tiene `search_path = ''`, referencias `public.profiles` y `auth.uid()` explícitas y EXECUTE concedido a authenticated.

Esto verifica el código versionado, **no su aplicación remota**. No hay evidencia suficiente para culpar a `is_admin()` ni para sustituir policies sin conocer su estado real.

## SQL que ejecutar ahora

Ejecutar **`scripts/audit-machine-image-storage.sql`**, que es de solo lectura, en el proyecto utilizado por la aplicación. Devuelve bucket, todas las policies de Storage (incluidas restrictivas o permisos amplios ajenos), definición/permisos de `is_admin()`, policies de profiles y registro de las migraciones 20/21.

El SQL Editor normalmente no representa la sesión del admin del navegador: no utilizar su `auth.uid()` como prueba de esa sesión.

- Si la 20 no se aplicó: revisar su aplicación pendiente antes de inventar una corrección.
- Si la 20 está aplicada y la auditoría demuestra un defecto: crear `20260905000021_fix_machine_image_storage_policies.sql`, limitado al bucket/policies responsables y con validación explícita del perfil cuando corresponda.
- No se ha creado ni aplicado una 21 especulativa. No se han cambiado datos ni desplegado.

## Reproducción y pruebas

Con el código local actualizado, iniciar la app, entrar con el admin habitual y reproducir el intento. Copiar solo los bloques de diagnóstico desde la terminal de Next. No compartir credenciales.

`node scripts/verify-catalog-pricing.cjs --upload-only` prueba con mocks de sesión/Storage: PNG/JPEG/WEBP reales, conversión JPEG, path versionado, rechazo de ID inválido, getUser/perfil, denegación de usuarios no-admin y conservación exacta de campos del error sin filtrar secretos. Estas pruebas no afirman que RLS remoto funcione ni que la subida real esté reparada.

Upload/reemplazo/eliminación reales y visibilidad seller quedan pendientes de acceso a una sesión real y de la auditoría SQL; no se realizaron escrituras remotas de prueba.
