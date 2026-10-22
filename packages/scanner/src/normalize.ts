export class InvalidUrlError extends Error {
  code = "invalid_url" as const;
}

export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidUrlError("URL is not valid");
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new InvalidUrlError("Only HTTP(S) URLs are allowed");
  if (url.username || url.password) throw new InvalidUrlError("Credentials in URLs are not allowed");
  if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) {
    throw new InvalidUrlError("Only default ports are allowed");
  }
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  return url.toString();
}
