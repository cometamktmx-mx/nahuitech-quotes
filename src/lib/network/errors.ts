export const activationMessages: Record<string,string> = {
 INVALID: "El código no es válido. Revisa que lo hayas copiado completo o solicita uno nuevo a Nahuitech.",
 EXPIRED: "Este código venció. Solicita un nuevo código de activación a Nahuitech.",
 EXHAUSTED: "Este código alcanzó su límite de usos. Nahuitech puede emitir uno nuevo.",
 RATE_LIMITED: "Alcanzaste el límite de intentos. Espera 15 minutos antes de volver a intentar.",
 REVOKED: "Este dispositivo fue revocado. Contacta a tu administrador; un código nuevo no elimina la revocación.",
 INACTIVE: "Tu membresía está inactiva. Contacta a Nahuitech para revisar tu acceso.",
 UNAVAILABLE: "La organización no está disponible. Contacta a Nahuitech.",
 ACCESS: "Tu acceso cambió o este dispositivo fue revocado. Selecciona una membresía activa o contacta a Nahuitech.",
 SERVICE: "No se pudo completar la activación. Comprueba tu conexión y que Sales Network esté habilitado.",
};
export function networkError(error:{message:string;code?:string}) {
 if(error.code==='23505')return "Este registro ya existe o ya está vinculado. Actualiza la pantalla para consultar su estado.";
 if(error.code==='23514'||error.code==='23502')return "Revisa los campos obligatorios, el importe y el estado de la operación.";
 if(error.code==='22P02'||error.code?.startsWith('22'))return "Revisa el formato del importe y la fecha. Usa un monto positivo con hasta dos decimales.";
 if(error.code==='42501')return "No tienes permiso para realizar esta operación.";
 return error.code==='P0001'?error.message:"No se pudo completar la operación. Comprueba tu conexión y vuelve a intentarlo.";
}
