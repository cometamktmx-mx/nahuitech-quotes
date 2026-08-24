# Verificación manual de persistencia de sesión

Ejecuta la PWA en modo producción antes de validar el service worker:

```powershell
npm run build
npm run start
```

Usa una ventana normal del navegador (no incógnito) y permite el almacenamiento del sitio.

## A. Vendedor en navegador

1. Inicia sesión con un vendedor activo.
2. Confirma que se muestra `/seller`.
3. Cierra todas las pestañas del sitio y el navegador.
4. Abre de nuevo `http://localhost:3000/`.
5. Debe redirigir directamente a `/seller`, sin solicitar credenciales.

## B. Vendedor en PWA instalada

1. Con la sesión del vendedor activa, instala la PWA desde el navegador.
2. Cierra por completo la ventana de la PWA.
3. Vuelve a abrirla desde el icono instalado.
4. Debe iniciar en `/seller` sin mostrar `/login`.

## C. Modo avión

1. Conéctate e inicia sesión como vendedor.
2. Espera a que el indicador muestre una sincronización del catálogo.
3. Activa modo avión y cierra la PWA.
4. Ábrela de nuevo desde el icono instalado.
5. Debe mostrar **Modo offline** y permitir cotizar con el perfil y catálogo sincronizados.

## D. Cierre de sesión

1. Con conexión, pulsa **Cerrar sesión**.
2. Cierra y vuelve a abrir el navegador o la PWA.
3. Debe mostrar `/login`; el acceso offline no debe quedar disponible.

## E. Administrador

1. Inicia sesión con un administrador activo.
2. Cierra y vuelve a abrir el navegador en `http://localhost:3000/`.
3. Debe redirigir directamente a `/admin`.

## Notas

- Si se borran las cookies o los datos del sitio desde el navegador, Supabase no puede mantener la sesión y será necesario iniciar sesión de nuevo.
- La primera preparación offline requiere conexión, perfil de vendedor activo y una sincronización completa del catálogo.
- Al recuperar conexión, Supabase actualiza la sesión mediante sus cookies y el cotizador vuelve a sincronizar sus datos locales.
