/** Follow the visible viewport even when Android pans the layout for the keyboard. */
export function trackViewport() {
  const root = document.documentElement;
  let frame = 0;
  let restingHeight = window.innerHeight;
  const update = () => {
    frame = 0;
    const v = window.visualViewport;
    if (v && Math.abs(v.scale - 1) > 0.02) return; // Preserve pinch zoom and its panning.
    const height = v?.height ?? window.innerHeight;
    const top = v?.offsetTop ?? 0;
    root.style.setProperty('--app-height', `${height}px`);
    root.style.setProperty('--app-top', `${top}px`);
    const editing = document.activeElement?.matches('textarea, input, [contenteditable=true]');
    const keyboard =
      window.innerHeight - height > 120 || (!!editing && restingHeight - height > 120);
    if (!keyboard) restingHeight = Math.max(window.innerHeight, height);
    root.dataset.keyboard = String(keyboard);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  update();
}
