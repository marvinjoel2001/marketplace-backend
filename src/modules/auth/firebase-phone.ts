/**
 * The phone number a Firebase Phone Auth ID token proves, or null. Identity Toolkit checks the token's signature,
 * expiry and project (the one FIREBASE_API_KEY belongs to: the same web API key the site uses), so a made-up token
 * or one from another project is rejected. Without the key, Firebase sign-in is off.
 */
export async function firebaseVerifiedPhone(idToken: string): Promise<string | null> {
  const key = process.env.FIREBASE_API_KEY;
  if (!key || !idToken) return null;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { users?: { phoneNumber?: string }[] };
    return data.users?.[0]?.phoneNumber ?? null;
  } catch {
    return null;
  }
}
