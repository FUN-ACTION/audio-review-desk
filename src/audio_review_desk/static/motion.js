import {
  animate as animateValue,
  animateStyle as animate,
  motionValue,
} from "./motion-vendor.js";
export { animate } from "./motion-vendor.js";
export const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  document.addEventListener(
    "pointermove",
    () => {
      keyboard = false;
    },
    { capture: true, passive: true },
  );
}
export const immediate = () => keyboard || reducedMotion() || document.hidden;
export function springValue(render) {
  const value = motionValue(0);
  let active;
  value.on("change", render);
  return (target, instant = false) => {
    const velocity = value.getVelocity();
    active?.stop();
    if (instant || immediate()) {
      value.jump(target);
      render(target);
      return;
    }
    active = animateValue(value, target, {
      type: "spring",
      stiffness: 650,
      damping: 48,
      velocity,
      restDelta: 0.03,
      restSpeed: 0.05,
    });
  };
}
const active = new WeakMap();
export function reveal(element, kind = "panel") {
  const old = active.get(element),
    current = getComputedStyle(element);
  const from = {
    opacity: old ? current.opacity : 0,
    transform: old
      ? current.transform
      : kind === "dialog"
        ? "translateY(8px) scale(.985)"
        : kind === "menu"
          ? "translateY(-4px) scale(.98)"
          : "translateY(5px)",
  };
  active.delete(element);
  old?.stop();
  if (immediate()) {
    element.style.opacity = "";
    if (element.id !== "notice") element.style.transform = "";
    return;
  }
  const opacityOnly = element.id === "notice";
  const effect = animate(
    element,
    opacityOnly
      ? { opacity: [from.opacity, 1] }
      : {
          opacity: [from.opacity, 1],
          transform: [
            from.transform,
            kind === "dialog" || kind === "menu"
              ? "translateY(0px) scale(1)"
              : "translateY(0px)",
          ],
        },
    { duration: kind === "dialog" ? 0.22 : 0.16, ease: [0.16, 1, 0.3, 1] },
  );
  active.set(element, effect);
}
export function openDialog(dialog) {
  if (!dialog.open) {
    active.delete(dialog);
    dialog.style.opacity = "";
    dialog.style.transform = "";
    dialog.showModal();
  }
  reveal(dialog, "dialog");
}
export function closeDialog(dialog, value = "") {
  const style = getComputedStyle(dialog),
    from = { opacity: style.opacity, transform: style.transform };
  active.get(dialog)?.stop();
  if (immediate()) {
    dialog.close(value);
    dialog.style.opacity = "";
    dialog.style.transform = "";
    return;
  }
  const effect = animate(
    dialog,
    {
      opacity: [from.opacity, 0],
      transform: [from.transform, "translateY(8px) scale(.985)"],
    },
    { duration: 0.14, ease: [0.4, 0, 1, 1] },
  );
  active.set(dialog, effect);
  Promise.resolve(effect)
    .then(() => {
      if (active.get(dialog) === effect && dialog.open) {
        dialog.close(value);
        dialog.style.opacity = "";
        dialog.style.transform = "";
      }
    })
    .catch(() => {});
}
