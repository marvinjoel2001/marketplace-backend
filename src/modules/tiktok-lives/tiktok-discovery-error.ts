/** Fixed diagnostic messages: never send provider errors, proxy credentials or cookies to logs. */
export function discoveryFailureReason(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : '';
  if (/running as root without --no-sandbox/i.test(message))
    return 'browser_root: Chromium no puede arrancar como root con sandbox; revisa RAILWAY_RUN_UID';
  if (/no usable sandbox|failed to move to new namespace|operation not permitted|sandbox\/linux\/services\/credentials\.cc/i.test(message))
    return 'browser_sandbox: el contenedor no permite el aislamiento requerido por Chromium';
  if (/EACCES|permission denied|read-only file system/i.test(message))
    return 'browser_permissions: el usuario del servicio no puede escribir en el perfil o ejecutar Chromium';
  if (/SingletonLock|profile.*in use|user data directory.*in use/i.test(message))
    return 'browser_profile_locked: otro proceso está usando el perfil de Chromium';
  if (/ENOENT|could not find chrome|browser was not found|executable.*does not exist/i.test(message))
    return 'browser_missing: no se encontró el ejecutable de Chromium';
  if (/TikTokBlockedError/.test(message))
    return 'tiktok_blocked: TikTok exige verificación o está rechazando las peticiones';
  if (/timeout|timed out/i.test(message))
    return 'timeout: venció el tiempo de arranque o de respuesta de TikTok';
  if (/net::ERR_|HTTP error/i.test(message))
    return 'network: TikTok o la conexión devolvieron un error';
  return 'unknown: el ciclo no pudo terminar';
}

/** A bounded excerpt for startup diagnostics, with credentials and complete URLs removed. */
export function discoveryFailureDetails(error: unknown): string {
  if (!(error instanceof Error)) return '';
  let message = error.message;
  for (const [key, value] of Object.entries(process.env)) {
    if (value && value.length >= 6 && /SECRET|TOKEN|PASSWORD|API_KEY|PROXY|INTERNAL_KEY/.test(key))
      message = message.split(value).join('[redacted]');
  }
  return message
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    .replace(/(?:authorization|cookie|password|token|secret)\s*[:=][^\r\n]*/gi, '[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 1600);
}
