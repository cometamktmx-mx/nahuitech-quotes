# WhatsApp con Twilio: configuración y pruebas

## 1. Aplicar la migración

En Supabase SQL Editor, ejecutar una sola vez y en este orden:

1. Las migraciones existentes hasta `20260822000007_offline_quote_ids.sql`.
2. El contenido completo de `supabase/migrations/20260822000008_whatsapp_messages.sql`.

La migración crea `public.whatsapp_messages`, habilita sus políticas RLS y crea/configura el bucket privado `quote-pdfs`.

## 2. Variables de servidor

Configura estas variables en Vercel (Production; Preview solo si ese dominio también recibirá callbacks). Ninguna lleva el prefijo `NEXT_PUBLIC_`:

```text
SUPABASE_SECRET_KEY=<clave secreta server-only ya usada por operaciones administrativas>
TWILIO_ACCOUNT_SID=<Account SID de Twilio>
TWILIO_AUTH_TOKEN=<Auth Token de Twilio>
TWILIO_WHATSAPP_FROM=whatsapp:+<sender de WhatsApp habilitado en Twilio>
APP_URL=https://tu-dominio-publico.example
```

`TWILIO_CONTENT_SID` es opcional. Si se configura, debe ser el SID real de una plantilla de WhatsApp aprobada que acepte estas variables: `1` nombre, `2` folio, `3` máquina, `4` total y `5` asesor. Para adjuntar el PDF fuera de la ventana de 24 horas, la plantilla debe estar aprobada para ese contenido multimedia.

No copies ninguna de estas variables al navegador, a archivos versionados ni a valores `NEXT_PUBLIC_*`.

## 3. Configurar Twilio

1. Activa un sender de WhatsApp en la cuenta de Twilio (sandbox para pruebas o sender de producción aprobado).
2. Copia exactamente su dirección `whatsapp:+...` en `TWILIO_WHATSAPP_FROM`.
3. Para pruebas con sandbox, el número destino debe haberse unido previamente al sandbox de Twilio.
4. Si se inicia una conversación fuera de la ventana de servicio de 24 horas, crea y aprueba una plantilla en Twilio; coloca su SID real en `TWILIO_CONTENT_SID`. Sin esa variable, Twilio solo podrá aceptar el mensaje libre dentro de la ventana permitida.

El callback se envía automáticamente a:

```text
https://tu-dominio-publico.example/api/webhooks/twilio/whatsapp
```

No necesitas exponer una clave en ese endpoint: valida la firma `X-Twilio-Signature` con el Auth Token en servidor.

## 4. Prueba en Vercel

1. Haz deploy después de guardar las variables de entorno y vuelve a desplegar para que se apliquen.
2. Inicia sesión como seller, abre una cotización propia y pulsa **Enviar por WhatsApp**.
3. Confirma que el PDF llega al número del cliente y que en el detalle aparece **Enviado**.
4. Espera/consulta los callbacks de Twilio: el estado puede avanzar a **Entregado** y **Leído**.
5. Verifica en Supabase que existe un objeto privado en `quote-pdfs/quotes/<quote_id>/<folio>.pdf` y una sola fila de `whatsapp_messages` para la cotización.
6. Pulsa el botón otra vez: debe permanecer en estado enviado y no generar un segundo mensaje automático.

Para probar callbacks reales no basta `localhost`, porque Twilio necesita una URL HTTPS pública. Usa Vercel o un túnel HTTPS temporal configurado manualmente como `APP_URL`; este proyecto no instala ni configura túneles.

## 5. Pruebas offline

1. Con conexión, sincroniza el catálogo y crea una cotización local en modo avión.
2. Pulsa **Enviar cuando haya conexión**. La tarea queda en IndexedDB con estado pendiente.
3. Restaura la conexión. La aplicación sincroniza primero la cotización usando su `client_generated_id` y solo entonces la envía por WhatsApp.
4. Confirma que un reintento no duplica la cotización ni el mensaje. Si la validación remota de la cotización falla, conserva el snapshot local y marca el envío como error.
