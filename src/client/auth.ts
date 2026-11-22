const TOKEN_KEY = "pi-durable-token";

/** Keeps a `?token=` from the first visit for this tab and removes it from the address bar. */
export function bootstrapToken(): string | undefined {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("token");
  if (fromUrl !== null && fromUrl.length > 0) {
    sessionStorage.setItem(TOKEN_KEY, fromUrl);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return loadToken();
}

export function loadToken(): string | undefined {
  const token = sessionStorage.getItem(TOKEN_KEY);
  return token !== null && token.length > 0 ? token : undefined;
}

export function authHeaders(): Record<string, string> {
  const token = loadToken();
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}
