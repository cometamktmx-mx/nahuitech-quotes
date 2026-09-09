import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

// Temporary diagnostics: never log the client, session, request headers or raw error.
export function logMachineImageStorageError(label: string, error: unknown) {
  const details: Record<string, string | number> = {};
  if (typeof error === 'object' && error !== null) {
    for (const key of ['name', 'message', 'statusCode', 'error', 'status', 'code'] as const) {
      if (key in error) {
        const value = (error as Record<string, unknown>)[key];
        if (typeof value === 'string' || typeof value === 'number') details[key] = value;
      }
    }
  }
  console.error(label, details);
}

export async function uploadMachineImage(supabase: SupabaseClient, machineId: string, file: File) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(machineId)) {
    throw new Error('El identificador de la máquina no es válido.');
  }
  // Verify the current user against Auth, not just locally decoded JWT claims.
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    console.error('[machine image admin check]', { authenticated: false });
    if (userError) logMachineImageStorageError('[machine image auth error]', userError);
    throw new Error('No autorizado. Inicia sesión nuevamente.');
  }
  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('role, active').eq('id', userData.user.id).maybeSingle();
  if (profileError || profile?.role !== 'admin' || profile.active !== true) {
    console.error('[machine image admin check]', {
      authenticated: true, role: profile?.role ?? null, active: profile?.active ?? null,
    });
    if (profileError) logMachineImageStorageError('[machine image profile error]', profileError);
    throw new Error('No autorizado. Se requiere un administrador activo.');
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('Selecciona PNG, JPG o WEBP de hasta 8 MB.');
  }
  const source = Buffer.from(await file.arrayBuffer());
  const processor = sharp(source, { limitInputPixels: 40_000_000, animated: false });
  const metadata = await processor.metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format ?? '')) throw new Error('El archivo no es una fotografía válida.');
  const bytes = await processor.rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  // Immutable versions preserve remote and not-yet-synced offline snapshots.
  const path = `machines/${machineId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('machine-images').upload(path, bytes, {
    contentType: 'image/jpeg', cacheControl: '31536000', upsert: false,
  });
  if (error) {
    logMachineImageStorageError('[machine image upload error]', error);
    console.error('[machine image upload context]', {
      bucket: 'machine-images', path, contentType: 'image/jpeg', size: bytes.byteLength,
      authenticated: true, role: profile.role, active: profile.active,
    });
    throw new Error('No se pudo subir la fotografía. Verifica el bucket machine-images y sus políticas.');
  }
  return { path, url: supabase.storage.from('machine-images').getPublicUrl(path).data.publicUrl };
}
