// Preview only: downloaded originals retain their submitted bytes.
export function previewDocument(html: string) {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";
  // Install the policy before parsing any submitted markup.
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${html}`;
}
