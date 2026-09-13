const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s._\p{Dash_Punctuation}()[\]{}·]/gu, '');

/** Match model names and modes consistently, including queries that span fields. */
export function modelSearch(query: string) {
  // Keep a spaced model version together: “GPT 6” must not also find “GPT-5.6”.
  const terms = query.normalize('NFKC').replace(/([\p{L}\p{N}])\s+(?=\d)/gu, '$1').split(/\s+/).map(normalize).filter(Boolean);
  return (...fields: (string | undefined)[]) => {
    const text = fields.map(field => normalize(field ?? '')).join('');
    return terms.every(term => text.includes(term));
  };
}
