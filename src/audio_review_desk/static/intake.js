import { springValue, reducedMotion } from "./motion.js";

export function mountIntake(section) {
  const actions = [...section.querySelectorAll(".intake-action")];
  for (const action of actions) {
    const icon = action.querySelector(".intake-arrow");
    const moveX = springValue((x) => {
      icon.style.transform = `translate3d(${x}px,0,0)`;
    });
    action.addEventListener("pointermove", (event) => {
      if (
        event.pointerType === "touch" ||
        !matchMedia("(pointer: fine)").matches ||
        reducedMotion()
      )
        return;
      const rect = action.getBoundingClientRect();
      moveX(
        Math.max(
          -5,
          Math.min(5, (event.clientX - rect.left - rect.width / 2) * 0.035),
        ),
      );
    });
    action.addEventListener("pointerleave", () => moveX(0));
  }
  let played = false;
  return () => {
    if (played || reducedMotion()) return;
    played = true;
    const nodes = [...section.querySelectorAll(".intake-reveal")];
    nodes.forEach((node, index) =>
      node.animate(
        [
          { opacity: 0, transform: "translateY(18px)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 500,
          delay: index * 45,
          easing: "cubic-bezier(.16,1,.3,1)",
          fill: "backwards",
        },
      ),
    );
  };
}
