// Exact critically damped spring. Retargeting retains position and velocity.
export function springStep(position, velocity, target, seconds, omega = 26) {
  const offset = position - target;
  const mixed = velocity + omega * offset;
  const decay = Math.exp(-omega * seconds);
  return [
    target + (offset + mixed * seconds) * decay,
    (velocity - omega * mixed * seconds) * decay,
  ];
}
export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let keyboard = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    () => {
      keyboard = true;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      keyboard = false;
    },
    true,
  );
}
export function springValue(render) {
  let position = 0,
    velocity = 0,
    target = 0,
    frame = 0,
    previous = 0;
  const tick = (now) => {
    const seconds = Math.min((now - previous) / 1000, 0.064);
    previous = now;
    [position, velocity] = springStep(position, velocity, target, seconds);
    render(position);
    if (Math.abs(position - target) > 0.05 || Math.abs(velocity) > 0.05)
      frame = requestAnimationFrame(tick);
    else {
      position = target;
      velocity = 0;
      render(position);
      frame = 0;
    }
  };
  return (value, instant = false) => {
    target = value;
    if (instant || keyboard || reducedMotion() || document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      position = target;
      velocity = 0;
      render(position);
      return;
    }
    if (!frame) {
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
}
const active = new WeakMap();
export function reveal(element, kind = "panel") {
  const previous = active.get(element);
  const presentation =
    previous?.playState === "running" ? getComputedStyle(element) : null;
  const current = presentation
    ? { opacity: presentation.opacity, transform: presentation.transform }
    : null;
  previous?.cancel();
  if (keyboard || reducedMotion()) return;
  const transform =
    kind === "dialog"
      ? "translateY(10px) scale(.98)"
      : kind === "menu"
        ? "translateY(-4px) scale(.98)"
        : "translateY(5px)";
  const animation = element.animate(
    [current || { opacity: 0, transform }, { opacity: 1, transform: "none" }],
    {
      duration: kind === "dialog" ? 240 : 170,
      easing: "cubic-bezier(.23,1,.32,1)",
    },
  );
  active.set(element, animation);
}
export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  reveal(dialog, "dialog");
}
export function closeDialog(dialog, value = "") {
  const presentation = getComputedStyle(dialog);
  const current = {
    opacity: presentation.opacity,
    transform: presentation.transform,
  };
  active.get(dialog)?.cancel();
  if (keyboard || reducedMotion()) {
    dialog.close(value);
    return;
  }
  const effect = dialog.animate(
    [current, { opacity: 0, transform: "translateY(6px) scale(.985)" }],
    { duration: 130, easing: "cubic-bezier(.23,1,.32,1)" },
  );
  active.set(dialog, effect);
  effect.finished
    .then(() => {
      if (dialog.open) dialog.close(value);
    })
    .catch(() => {});
}
