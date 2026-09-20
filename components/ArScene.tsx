"use client";

/**
 * THE ROOM, LIVE.
 *
 * One screen, two scenes, one set of chrome:
 *
 *   PHOTO MODE   the room photo with the sprites composited over it at true
 *                size. This is what every iPhone gets and what a laptop judge
 *                sees, so it is the default and it is a first-class path —
 *                see components/PhotoMode.tsx.
 *   LIVE AR      WebXR immersive-ar through @react-three/xr: hit-test the
 *                floor, tap the reticle, the sprite stands there at the linked
 *                listing's real height.
 *
 * PLATFORM FACT, VERIFIED 19 September 2026: Safari on iPhone has no WebXR
 * immersive-ar (no support through iOS 27.2) and AR Quick Look needs a .usdz
 * the pivot no longer produces. Demo on an Android phone in Chrome. This file
 * checks `navigator.xr.isSessionSupported("immersive-ar")` and never offers a
 * button that cannot work.
 *
 * WHY NOT model-viewer: v2 loaded a per-product .glb. There is no .glb now —
 * what the product needs is a textured plane that RESIZES when a different
 * listing is linked, which is one prop in react-three-fiber. types/model-viewer.d.ts
 * went with the import.
 *
 * DOM IN AN AR SESSION: while an immersive session runs, the page's own DOM is
 * not composited — only the WebXR dom-overlay root is. So the chrome is
 * rendered outside the canvas before the session and inside <XRDomOverlay>
 * during it, and sonner's toasts (which live in the page root) are mirrored
 * into the overlay as a line of text, or the pinch refusal would be invisible
 * on the phone.
 *
 * WHERE ITS OWN NOTES STAND. The room page gives this scene the whole window
 * and floats glass over it; PhotoMode owns the free area that glass leaves. So
 * the two things this file has to say out of session — "stand it in your room"
 * or "this browser has no live AR" — are handed to PhotoMode as its footnote
 * and land in the row under the photo, clear of the panel and the tray, rather
 * than being positioned a second time against the same edge.
 *
 * This component takes NO props. Everything it needs is in lib/store.ts.
 */

import * as React from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  createXRStore,
  useXRHitTest,
  XR,
  XRDomOverlay,
  type XRStore,
} from "@react-three/xr";
import { useStore as useZustand } from "zustand";
import { useDrag, usePinch } from "@use-gesture/react";
import { DoubleSide, Matrix4, Mesh, PerspectiveCamera, Vector3 } from "three";

import { StatusLine } from "@/components/ui/StatusLine";
import { PlaceholderSprite } from "@/components/PlaceholderSprite";
import {
  PhotoMode,
  refusePinch,
  spriteSizeMm,
  tokenColor,
  vibrate,
} from "@/components/PhotoMode";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------- bridge */

/**
 * The one mutable object the 3D scene and the DOM overlay share. Written in
 * useFrame, read by the gesture handlers — never React state, because a drag
 * must not re-render the scene sixty times a second.
 *
 * It lives at module scope rather than in a ref passed down as a prop: there is
 * exactly one AR scene on screen at a time, and a shared mutable prop is the
 * thing the React compiler is right to refuse.
 */
type SceneLink = {
  hit: { active: boolean; x: number; y: number; z: number };
  /** camera position and its ground-plane basis, for turning a drag into metres */
  cam: {
    x: number;
    y: number;
    z: number;
    rightX: number;
    rightZ: number;
    fwdX: number;
    fwdZ: number;
    /** metres per pixel at one metre of distance */
    mPerPxAt1m: number;
  };
};

const sceneLink: SceneLink = {
  hit: { active: false, x: 0, y: 0, z: 0 },
  cam: {
    x: 0,
    y: 1.6,
    z: 0,
    rightX: 1,
    rightZ: 0,
    fwdX: 0,
    fwdZ: -1,
    mPerPxAt1m: 0.002,
  },
};

/** Nothing to subscribe to — this only tells us we are past the server render. */
const noopSubscribe = () => () => {};

/* ==================================================================== scene */

export function ArScene() {
  const roomImage = useStore((s) => s.roomImage);

  /** false during the server render and the first client render, then true */
  const mounted = React.useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  /** null while we are still asking the browser; false is a real answer */
  const [arSupported, setArSupported] = React.useState<boolean | null>(null);

  /* the XR store reaches for navigator, so it is built on the client only */
  const store = React.useMemo<XRStore | null>(() => {
    if (!mounted) return null;

    /*
     * ?xrsim=1 injects IWER, the emulated XR device that ships inside
     * @react-three/xr, so the immersive-ar path can be walked on a laptop with
     * no headset and no phone. It is opt-in by URL and nothing else reads it,
     * so a real device and production are untouched — and because IWER injects
     * navigator.xr itself, it also works over plain http, where WebXR is
     * absent for want of a secure context.
     */
    const emulate =
      new URLSearchParams(window.location.search).get("xrsim") === "1";

    return createXRStore({ hitTest: true, domOverlay: true, emulate });
  }, [mounted]);

  React.useEffect(() => {
    if (!mounted) return;
    let live = true;
    void (async () => {
      const xr = (
        navigator as Navigator & {
          xr?: { isSessionSupported: (mode: string) => Promise<boolean> };
        }
      ).xr;
      /*
       * A real Android answers on the first ask. The ?xrsim=1 emulator does
       * not: @react-three/xr installs IWER asynchronously, so navigator.xr can
       * still be missing or still be answering "no" for a beat after mount.
       * A few cheap retries cost a real device nothing and stop the emulated
       * device from being declared unsupported before it has finished loading.
       */
      for (let attempt = 0; attempt < 5 && live; attempt += 1) {
        let ok = false;
        try {
          const api = (
            navigator as Navigator & {
              xr?: { isSessionSupported: (mode: string) => Promise<boolean> };
            }
          ).xr;
          ok = (await (api ?? xr)?.isSessionSupported?.("immersive-ar")) ?? false;
        } catch {
          ok = false;
        }
        if (!live) return;
        if (ok) {
          setArSupported(true);
          return;
        }
        setArSupported(false);
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    })();
    return () => {
      live = false;
    };
  }, [mounted]);

  /* never a button that cannot work: the offer when AR is there, the honest
     note when it is not, and nothing at all while we are still asking */
  const footnote =
    store && arSupported === true ? (
      <EnterArButton store={store} />
    ) : arSupported === false && roomImage ? (
      <p className="glass-pill pointer-events-none max-w-full px-4 py-2 text-center text-[12px] text-muted-foreground">
        This browser has no live AR — Chrome on Android does. Your photo is to
        scale either way.
      </p>
    ) : null;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* the photo is the scene until an AR session starts, on every device */}
      <PhotoMode footnote={footnote} />

      {store ? <LiveLayer store={store} /> : null}
    </div>
  );
}

export default ArScene;

/* =============================================================== live layer */

/**
 * Out of session: the one button that starts it. It watches the session itself
 * so it can stand in PhotoMode's row and still step aside the moment a session
 * is running.
 */
function EnterArButton({ store }: { store: XRStore }) {
  const session = useZustand(store, (s) => s.session);
  if (session != null) return null;
  return (
    <button
      type="button"
      className={cn(
        "glass-accent tap pointer-events-auto inline-flex min-h-11 cursor-pointer items-center !rounded-full px-5 font-sans text-sm",
        // 240ms is DUR.micro, the hover speed
        "transition-transform duration-[240ms] hover:-translate-y-px active:translate-y-0",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      )}
      onClick={(event) => {
        // the stage under it listens for the taps that set the scale
        event.stopPropagation();
        void store.enterAR();
        vibrate(8);
      }}
    >
      Stand it in your room
    </button>
  );
}

type LiveLayerProps = {
  store: XRStore;
};

function LiveLayer({ store }: LiveLayerProps) {
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const moveItem = useStore((s) => s.moveItem);

  const session = useZustand(store, (s) => s.session);
  const inSession = session != null;

  const [floorFound, setFloorFound] = React.useState(false);
  /** sonner lives in the page root, which an AR session does not composite */
  const [overlayNote, setOverlayNote] = React.useState<string | null>(null);

  const activeItem = items.find((i) => i.id === activeItemId) ?? null;
  const activeRef = React.useRef(activeItem);
  React.useEffect(() => {
    activeRef.current = activeItem;
  }, [activeItem]);

  const say = React.useCallback((line: string) => {
    setOverlayNote(line);
    window.setTimeout(
      () => setOverlayNote((current) => (current === line ? null : current)),
      2600
    );
  }, []);

  /** put the active item where the reticle is standing */
  const placeHere = React.useCallback(() => {
    const item = activeRef.current;
    const hit = sceneLink.hit;
    if (!item) {
      say("Ask for something first, then tap the floor.");
      return;
    }
    if (!hit.active) {
      say("Move your phone slowly until the ring finds the floor.");
      return;
    }
    moveItem(item.id, [hit.x, hit.y, hit.z], item.rotationY);
    vibrate(12);
    say(`${item.category} placed.`);
  }, [moveItem, say]);

  return (
    <>
      <Canvas
        // transparent so the camera feed (in session) or the photo (out of it)
        // shows through; pointer events stay off until a session is running so
        // photo mode keeps its drags
        className={cn(
          "absolute inset-0",
          inSession ? "pointer-events-auto" : "pointer-events-none"
        )}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 1.6, 0], fov: 70, near: 0.01, far: 40 }}
      >
        <XR store={store}>
          <SceneBridge />

          {/* sprites only exist in 3D while a session runs — out of session the
              same items are already drawn over the photo underneath */}
          {inSession
            ? items.map((item) => (
                <PlaceholderSprite key={item.id} item={item} />
              ))
            : null}

          {inSession ? (
            <Reticle onFound={setFloorFound} onPlace={placeHere} />
          ) : null}

          {inSession ? (
            <XRDomOverlay>
              <SessionChrome
                floorFound={floorFound}
                note={overlayNote}
                onPlace={placeHere}
                onSay={say}
                onExit={() => void store.getState().session?.end()}
              />
            </XRDomOverlay>
          ) : null}
        </XR>
      </Canvas>
    </>
  );
}

/* ------------------------------------------------------------ scene bridge */

/** Writes the camera's ground basis into the shared link, once per frame. */
function SceneBridge() {
  const size = useThree((s) => s.size);

  useFrame((state) => {
    const camera = state.camera;
    const cam = sceneLink.cam;
    cam.x = camera.position.x;
    cam.y = camera.position.y;
    cam.z = camera.position.z;

    // right and forward, flattened onto the floor, normalised
    const e = camera.matrixWorld.elements;
    const rx = e[0];
    const rz = e[2];
    const rLen = Math.hypot(rx, rz) || 1;
    cam.rightX = rx / rLen;
    cam.rightZ = rz / rLen;
    // camera forward is -Z of its basis
    const fx = -e[8];
    const fz = -e[10];
    const fLen = Math.hypot(fx, fz) || 1;
    cam.fwdX = fx / fLen;
    cam.fwdZ = fz / fLen;

    const fov =
      camera instanceof PerspectiveCamera && camera.fov > 0 ? camera.fov : 70;
    cam.mPerPxAt1m =
      (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(size.height, 1);
  });

  return null;
}

/* ---------------------------------------------------------------- reticle */

const hitMatrix = new Matrix4();
const hitPoint = new Vector3();

type ReticleProps = {
  onFound: (found: boolean) => void;
  onPlace: () => void;
};

/**
 * The floor finder. WebXR's own hit test, run from the viewer's space, which
 * is what the phone is pointing at — the shape the samples in
 * ref/webxr-samples/hit-test.html use.
 */
function Reticle({ onFound, onPlace }: ReticleProps) {
  const ref = React.useRef<Mesh>(null);
  const found = React.useRef(false);
  /* the ring is the accent, read off the token a material cannot name; with no
     token to read it keeps the material's own white, which still shows */
  const ring = React.useMemo(() => tokenColor("--accent"), []);

  useXRHitTest(
    (results, getWorldMatrix) => {
      const hit = sceneLink.hit;
      if (results.length === 0) {
        hit.active = false;
      } else if (getWorldMatrix(hitMatrix, results[0])) {
        hitPoint.setFromMatrixPosition(hitMatrix);
        hit.active = true;
        hit.x = hitPoint.x;
        hit.y = hitPoint.y;
        hit.z = hitPoint.z;
      }
      if (hit.active !== found.current) {
        found.current = hit.active;
        onFound(hit.active);
      }
    },
    "viewer",
    ["plane", "mesh"]
  );

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const hit = sceneLink.hit;
    mesh.visible = hit.active;
    if (hit.active) mesh.position.set(hit.x, hit.y + 0.002, hit.z);
  });

  return (
    <mesh
      ref={ref}
      visible={false}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(event) => {
        event.stopPropagation();
        onPlace();
      }}
    >
      <ringGeometry args={[0.07, 0.1, 40]} />
      <meshBasicMaterial
        {...(ring ? { color: ring } : {})}
        transparent
        opacity={0.9}
        toneMapped={false}
        depthWrite={false}
        side={DoubleSide}
      />
    </mesh>
  );
}

/* --------------------------------------------------------- session chrome */

type SessionChromeProps = {
  floorFound: boolean;
  note: string | null;
  onPlace: () => void;
  onSay: (line: string) => void;
  onExit: () => void;
};

/**
 * What the user touches while the session is running. It is deliberately thin:
 * the room is never covered, and the only persistent readouts are the sprite's
 * own dimension label and the budget HUD.
 */
function SessionChrome({
  floorFound,
  note,
  onPlace,
  onSay,
  onExit,
}: SessionChromeProps) {
  const items = useStore((s) => s.items);
  const activeItemId = useStore((s) => s.activeItemId);
  const moveItem = useStore((s) => s.moveItem);

  const surfaceRef = React.useRef<HTMLDivElement | null>(null);

  const activeItem = items.find((i) => i.id === activeItemId) ?? null;
  const activeRef = React.useRef(activeItem);
  React.useEffect(() => {
    activeRef.current = activeItem;
  }, [activeItem]);

  /*
   * DRAG TO MOVE, on the overlay rather than by raycasting every frame. A pixel
   * of drag is worth more metres the further away the sprite is, so the
   * movement is scaled by its distance from the camera and applied along the
   * camera's own ground axes — dragging down brings it towards you.
   */
  useDrag(
    ({ delta: [dx, dy], event, first }) => {
      event.preventDefault?.();
      const item = activeRef.current;
      if (!item) {
        if (first) onSay("Tap a sprite first, then drag to move it.");
        return;
      }
      const cam = sceneLink.cam;
      const [px, py, pz] = item.position;
      const distance = Math.max(
        0.35,
        Math.hypot(cam.x - px, cam.y - py, cam.z - pz)
      );
      const metresPerPx = cam.mPerPxAt1m * distance;
      const right = dx * metresPerPx;
      const back = dy * metresPerPx;
      moveItem(
        item.id,
        [
          px + cam.rightX * right - cam.fwdX * back,
          py,
          pz + cam.rightZ * right - cam.fwdZ * back,
        ],
        item.rotationY
      );
    },
    { target: surfaceRef, eventOptions: { passive: false }, filterTaps: true }
  );

  /* the refusal, mirrored into the overlay because toasts cannot reach here */
  usePinch(
    ({ first, event }) => {
      event.preventDefault?.();
      if (!first) return;
      const item = activeRef.current;
      const heightMm = item ? spriteSizeMm(item).heightMm : null;
      refusePinch(heightMm);
      onSay(
        heightMm
          ? `Locked to real size — this one is ${Math.round(heightMm).toLocaleString("en-US")} mm tall.`
          : "Locked to real size."
      );
    },
    { target: surfaceRef, eventOptions: { passive: false } }
  );

  /*
   * GLASS OVER A CAMERA FEED. What is behind this chrome is whatever room the
   * phone is pointed at, so every piece is `glass-thick` / `glass-pill` — opaque
   * enough for ink on a black room or a white one. The glass classes set their
   * own `position`, so each piece is a positioned wrapper with the glass inside.
   */
  return (
    <div className="pointer-events-none fixed inset-0 select-none font-sans">
      {/* the drag surface sits under the buttons and over the camera feed */}
      <div ref={surfaceRef} className="pointer-events-auto absolute inset-0 touch-none" />

      {!floorFound ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 flex justify-center px-4">
          <div className="glass-thick max-w-[80%] px-5 py-2.5 text-center">
            <StatusLine
              messages={[
                "Move your phone slowly to find the floor.",
                "Point it at the floor about a metre ahead of you.",
              ]}
              className="text-foreground"
            />
          </div>
        </div>
      ) : null}

      {note ? (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
          <p className="glass-pill max-w-[80%] px-4 py-1.5 text-center text-xs text-foreground">
            {note}
          </p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
        <p className="glass-pill px-3 py-1 text-center text-[11px] text-muted-foreground">
          Stand-in image — the product you pick is linked.
        </p>
      </div>

      <div className="pointer-events-auto absolute inset-x-0 bottom-12 flex items-center justify-center gap-2 px-4">
        <button
          type="button"
          className="glass-accent tap min-h-11 cursor-pointer !rounded-full px-5 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onPlace}
        >
          Place it here
        </button>
        <button
          type="button"
          className="glass-pill tap min-h-11 cursor-pointer px-4 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onExit}
        >
          Back to the photo
        </button>
      </div>
    </div>
  );
}
