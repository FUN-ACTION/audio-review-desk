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
  const release = (operation) => {
    operation.query.removeEventListener("change", operation.reduce);
    if (active === operation) active = null;
  };
  return (target, instant = false) => {
    const velocity = value.getVelocity(), previous = active;
    if (previous) {
      release(previous);
      previous.effect?.stop();
    }
    if (instant || immediate()) {
      value.jump(target);
      render(target);
      return;
    }
    // Subscribe only while this spring is active. Operation identity prevents
    // an old completion or queued preference event from owning a newer target.
    const operation = { query: matchMedia("(prefers-reduced-motion: reduce)"), effect: null };
    operation.reduce = () => {
      if (active !== operation || !operation.query.matches) return;
      release(operation);
      operation.effect?.stop();
      value.jump(target);
      render(target);
    };
    active = operation;
    try {
      operation.query.addEventListener("change", operation.reduce);
      operation.effect = animateValue(value, target, {
        type: "spring",
        stiffness: 650,
        damping: 48,
        velocity,
        restDelta: 0.03,
        restSpeed: 0.05,
        onComplete: () => release(operation),
      });
      // A synchronous callback may already have superseded this operation.
      if (active !== operation) operation.effect.stop();
      Promise.resolve(operation.effect).then(
        () => release(operation),
        () => release(operation),
      );
    } catch (error) {
      release(operation);
      operation.effect?.stop();
      throw error;
    }
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
