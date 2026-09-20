import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";

// The easing curves and durations from spec Part C, shared by GL and DOM tweens.

gsap.registerPlugin(CustomEase);

export const ease = {
  out: CustomEase.create("senseOut", "0.23,1,0.32,1"),
  expo: CustomEase.create("senseExpo", "0.16,1,0.3,1"),
  slide: CustomEase.create("senseSlide", "0.55,0,0.1,1"),
  pop: CustomEase.create("sensePop", "0.19,1.51,0.29,0.99"),
  exit: CustomEase.create("senseExit", "0.71,0.01,0.81,-0.51"),
  shake: CustomEase.create("senseShake", "0.36,0.07,0.19,0.97"),
};

export const T = { fast: 0.3, base: 0.5, slow: 1, page: 1.2, truck: 1.6 };

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const wait = (seconds: number) => new Promise<void>((resolve) => gsap.delayedCall(seconds, resolve));

/** Promise wrapper so transitions can be awaited inside the state machine. */
export const done = (tween: gsap.core.Animation) => new Promise<void>((resolve) => tween.eventCallback("onComplete", () => resolve()));

export { gsap };
