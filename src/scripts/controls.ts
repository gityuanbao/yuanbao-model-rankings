/** A filter action commits completed input without interrupting Chinese composition. */
export function bindSearch(input: HTMLInputElement, commit: (query: string) => void, delay = 160) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const value = () => input.value.trim().slice(0, 100);
  const schedule = () => {
    cancel();
    if (!composing) timer = setTimeout(() => { timer = undefined; commit(value()); }, delay);
  };
  input.addEventListener('input', schedule);
  input.addEventListener('compositionstart', () => { composing = true; cancel(); });
  input.addEventListener('compositionend', () => { composing = false; schedule(); });
  return {
    read(previous: string) { cancel(); return composing ? previous : value(); },
    restore(query: string) { cancel(); composing = false; input.value = query; },
    get composing() { return composing; },
  };
}

/** Only a breakpoint crossing changes disclosure state; manual toggles still work. */
export function bindResponsiveFilters(panel: HTMLDetailsElement) {
  const mobile = matchMedia('(max-width: 900px)');
  const sync = () => { panel.open = !mobile.matches; };
  sync();
  mobile.addEventListener('change', sync);
}

export function bindDetailsLinks(details: HTMLDetailsElement) {
  const hash = `#${details.id}`;
  document.querySelectorAll<HTMLAnchorElement>(`a[href="${hash}"]`).forEach(link => link.addEventListener('click', event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    details.open = true;
    details.querySelector('summary')?.focus({ preventScroll: true });
  }));
  const openFromHash = () => { if (location.hash === hash) details.open = true; };
  window.addEventListener('hashchange', openFromHash);
  openFromHash();
}
