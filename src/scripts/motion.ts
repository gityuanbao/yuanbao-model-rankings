const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const easing = 'cubic-bezier(.22, 1, .36, 1)';
const visible = (rect: DOMRect) => rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;

export function captureRows() {
  const positions = new Map<string, DOMRect>();
  if (reducedMotion.matches) return positions;
  document.querySelectorAll<HTMLElement>('[data-model-id]').forEach(row => {
    const rect = row.getBoundingClientRect();
    if (visible(rect)) positions.set(`${row.parentElement!.id}:${row.dataset.modelId}`, rect);
  });
  return positions;
}

export function animateRows(positions: Map<string, DOMRect>) {
  if (reducedMotion.matches) return;
  let index = 0;
  document.querySelectorAll<HTMLElement>('[data-model-id]').forEach(row => {
    const rect = row.getBoundingClientRect();
    if (!visible(rect)) return;
    const before = positions.get(`${row.parentElement!.id}:${row.dataset.modelId}`);
    const delta = before ? before.top - rect.top : 10;
    row.animate([
      { transform: `translateY(${delta}px)`, opacity: before ? .6 : 0 },
      { transform: 'translateY(0)', opacity: 1 },
    ], { duration: before ? 460 : 320, delay: before ? 0 : Math.min(index++ * 25, 100), easing });
  });
}

// Optional progressive enhancement: content is visible without JavaScript.
function reveal() {
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      if (reducedMotion.matches) return;
      entry.target.animate([
        { opacity: .15, transform: 'translateY(20px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 700, easing });
    });
  }, { threshold: .08 });
  document.querySelectorAll('.detail-box, .detail-price-card, .community-inner').forEach(element => observer.observe(element));
}
reveal();
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) document.getAnimations().forEach(animation => animation.cancel());
});
