import { animateStyle as animate, spring } from "./motion-vendor.js";
import { immediate, reducedMotion } from "./motion.js";
export function mountIntake(section) {
  const cards = [...section.querySelectorAll(".source-card")];
  for (const card of cards) {
    card.addEventListener("pointerenter", (event) => {
      if (
        event.pointerType === "touch" ||
        !matchMedia("(pointer:fine)").matches ||
        reducedMotion()
      )
        return;
      animate(
        card,
        { transform: "translateY(-2px)" },
        { type: spring, bounce: 0, duration: 0.24 },
      );
    });
    card.addEventListener("pointerleave", () => {
      if (immediate()) {
        card.style.transform = "none";
        return;
      }
      animate(
        card,
        { transform: "translateY(0px)" },
        { type: spring, bounce: 0, duration: 0.24 },
      );
    });
  }
  let played = false;
  return () => {
    if (played || immediate()) return;
    played = true;
    animate(
      section.querySelector(".intake-heading"),
      { opacity: [0, 1] },
      { duration: 0.24 },
    );
    cards.forEach((card, index) =>
      animate(
        card,
        { opacity: [0, 1], transform: ["translateY(9px)", "none"] },
        { duration: 0.3, delay: index * 0.045, ease: [0.16, 1, 0.3, 1] },
      ),
    );
  };
}
