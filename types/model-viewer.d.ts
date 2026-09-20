/**
 * <model-viewer> as a JSX intrinsic element.
 *
 * @google/model-viewer 4.3.1 (Apache-2.0) ships a real custom element and real
 * TypeScript types, but it registers itself by touching `window` at module
 * scope. So the element is imported in a useEffect at runtime (see
 * components/ArScene.tsx) and only its TYPES are imported here — a type-only
 * import is erased, so this file never reaches the server bundle.
 *
 * React 19 no longer has a global JSX namespace; the supported augmentation is
 * `declare module "react"`, which is what this file does. Adding a global
 * `namespace JSX` instead compiles but is ignored by @types/react 19.
 */

import type * as React from "react";
import type { ModelViewerElement } from "@google/model-viewer";

/** The four values model-viewer's `ar-status` event reports. */
export type ArStatus =
  | "not-presenting"
  | "session-started"
  | "object-placed"
  | "failed";

/** `ar-tracking` — whether the AR session currently has the room. */
export type ArTracking = "tracking" | "not-tracking";

export type ArStatusEvent = CustomEvent<{ status: ArStatus }>;
export type ArTrackingEvent = CustomEvent<{ status: ArTracking }>;

/** Re-exported so components can type a ref without importing the runtime. */
export type ModelViewer = ModelViewerElement;

/**
 * Only the attributes VISA actually sets. Hyphenated attributes are passed
 * through as attributes; `ar`, `src` and friends match element properties and
 * React 19 sets those as properties.
 */
export type ModelViewerAttributes = React.HTMLAttributes<HTMLElement> &
  React.RefAttributes<ModelViewerElement> & {
    src?: string;
    alt?: string;
    poster?: string;

    /* AR */
    ar?: boolean;
    "ar-modes"?: string;
    /** "fixed" locks real-world size — the entire point of this screen */
    "ar-scale"?: "auto" | "fixed";
    "ar-placement"?: "floor" | "wall";
    "ios-src"?: string;
    "xr-environment"?: boolean;

    /* in-page 3D */
    "camera-controls"?: boolean;
    "disable-zoom"?: boolean;
    "disable-pan"?: boolean;
    "disable-tap"?: boolean;
    "touch-action"?: string;
    "interaction-prompt"?: "auto" | "none";
    "camera-orbit"?: string;
    "min-camera-orbit"?: string;
    "max-camera-orbit"?: string;
    "field-of-view"?: string;
    "shadow-intensity"?: string | number;
    "shadow-softness"?: string | number;
    "environment-image"?: string;
    exposure?: string | number;
    "tone-mapping"?: string;
    autoplay?: boolean;

    /** uniform scale, e.g. "0.78 0.78 0.78" — set from real millimetres */
    scale?: string;
    orientation?: string;

    loading?: "auto" | "lazy" | "eager";
    reveal?: "auto" | "manual";
  };

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerAttributes;
    }
  }
}
