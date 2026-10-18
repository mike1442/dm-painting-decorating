/** Request cookies for route-handler tests, standing in for next/headers. */
export const requestCookies = new Map<string, string>();

export async function cookies() {
  return { get: (name: string) => requestCookies.has(name) ? { value: requestCookies.get(name)! } : undefined };
}
