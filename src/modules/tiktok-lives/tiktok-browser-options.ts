/** Chromium only needs OS settings; application tokens must not be inherited by its process. */
export function browserEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const allowed = /^(PATH|HOME|LANG|LANGUAGE|LC_[A-Z_]+|TZ|DISPLAY|XAUTHORITY|XDG_[A-Z_]+|DBUS_SESSION_BUS_ADDRESS|SYSTEMROOT|SystemRoot|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH)$/;
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => allowed.test(key) && value !== undefined)) as Record<string, string>;
}

export function browserSandboxArgs(optIn: boolean): string[] {
  return optIn === true ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
}
