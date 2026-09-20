"use client";

/**
 * THE SPRITE STANDING IN THE ROOM.
 *
 * A textured plane, cut out on transparent, standing on the floor where the
 * user put it. It is NOT a model of the product and it never pretends to be —
 * its PICTURE never changes when a different listing is linked. Its SIZE does,
 * and the size is the part that tells the truth.
 *
 * Three details are what separate "that's in the room" from "that's a sticker",
 * and none of them is decoration:
 *
 *   1. CYLINDRICAL BILLBOARD. The plane turns around Y to face the camera and
 *      stays UPRIGHT. A full billboard tips the lamp over when you crouch to
 *      look at its base, which reads as fake instantly.
 *   2. THE RESIZE IS SPRUNG, ~400 ms. Tapping a taller lamp makes the thing
 *      standing in the room visibly grow. Snapping it throws that away.
 *   3. THE TEXTURE IS NEVER PADDED. /api/placeholder trims the PNG so its
 *      bounding box IS the object; the plane is `height = dimsMm[1] / 1000` and
 *      `width = height * widthRatio`. Re-padding here would make a 1,500 mm
 *      lamp stand 1,800 mm tall.
 *
 * Sizing lives in components/PhotoMode.tsx — the scene path with no three.js —
 * so the live room and the photo can never disagree about how big a thing is.
 */

import * as React from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useXR } from "@react-three/xr";
import {
  DoubleSide,
  Group,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from "three";

import { NumberPlate } from "@/components/ui/NumberPlate";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem } from "@/types";
import {
  dimsCaption,
  dimsTone,
  emitItemEvent,
  labelDimsMm,
  OPEN_OPTIONS_EVENT,
  REMOVE_ITEM_EVENT,
  spriteSizeMm,
  vibrate,
} from "@/components/PhotoMode";

/* ------------------------------------------------------------------ spring */

/**
 * A critically-ish damped spring, integrated per frame. stiffness 220 /
 * damping 26 settles in about 400 ms with the small overshoot that makes the
 * resize readable rather than merely fast. The same numbers drive the photo
 * path's framer-motion transition, so both paths move alike.
 */
const STIFFNESS = 220;
const DAMPING = 26;
/** never integrate a whole tab-switch in one step */
const MAX_STEP = 1 / 30;

type SpringState = { value: number; velocity: number };

function stepSpring(
  spring: SpringState,
  target: number,
  delta: number
): void {
  const dt = Math.min(delta, MAX_STEP);
  const force = (target - spring.value) * STIFFNESS;
  const damping = spring.velocity * DAMPING;
  spring.velocity += (force - damping) * dt;
  spring.value += spring.velocity * dt;
  // park it exactly on target rather than jittering forever
  if (Math.abs(target - spring.value) < 0.0005 && Math.abs(spring.velocity) < 0.002) {
    spring.value = target;
    spring.velocity = 0;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ----------------------------------------------------------------- texture */

/**
 * Loaded by hand rather than through `useTexture`, because a suspending loader
 * would blank the whole scene while one sprite's PNG is in flight. A failure
 * leaves `texture` null and the skeleton keeps standing where it stood.
 */
function usePlaceholderTexture(url: string): Texture | null {
  /* the loaded texture is kept WITH the url it came from, so a new url shows
     the skeleton again without a setState in the effect body */
  const [loaded, setLoaded] = React.useState<{
    url: string;
    texture: Texture;
  } | null>(null);

  React.useEffect(() => {
    if (!url) return;
    let live = true;
    let created: Texture | null = null;
    new TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = 4;
        created = tex;
        if (live) setLoaded({ url, texture: tex });
        else tex.dispose();
      },
      undefined,
      () => {
        // a failed cutout is not an error state: the skeleton keeps standing
      }
    );
    return () => {
      live = false;
      created?.dispose();
    };
  }, [url]);

  return loaded && loaded.url === url ? loaded.texture : null;
}

/* ====================================================== the sprite itself */

export type PlaceholderSpriteProps = {
  item: PlacedItem;
};

export function PlaceholderSprite({ item }: PlaceholderSpriteProps) {
  const activeItemId = useStore((s) => s.activeItemId);
  const setActiveItem = useStore((s) => s.setActiveItem);
  const active = activeItemId === item.id;

  const groupRef = React.useRef<Group>(null);
  const meshRef = React.useRef<Group>(null);
  const labelRef = React.useRef<Group>(null);

  const texture = usePlaceholderTexture(
    item.placeholderStatus === "ready" ? item.placeholderUrl : ""
  );

  const size = spriteSizeMm(item);
  // the user's own size carries into the live room too, so a sprite they
  // resized in the photo is the same sprite when they enter AR
  const targetHeight = (size.heightMm / 1000) * item.scale;
  const targetWidth = (size.widthMm / 1000) * item.scale;

  /* the springs start ON target, so an item appears at its size and only a
     LINK CHANGE animates */
  const heightSpring = React.useRef<SpringState>({
    value: targetHeight,
    velocity: 0,
  });
  const widthSpring = React.useRef<SpringState>({
    value: targetWidth,
    velocity: 0,
  });

  const reduced = React.useMemo(() => prefersReducedMotion(), []);

  useFrame((state, delta) => {
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (!group || !mesh) return;

    /* 1. the resize, sprung */
    if (reduced) {
      heightSpring.current.value = targetHeight;
      widthSpring.current.value = targetWidth;
    } else {
      stepSpring(heightSpring.current, targetHeight, delta);
      stepSpring(widthSpring.current, targetWidth, delta);
    }
    const h = heightSpring.current.value;
    const w = widthSpring.current.value;
    mesh.scale.set(w, h, 1);
    // the plane's own origin is its centre; stand its BASE on the floor
    mesh.position.set(0, h / 2, 0);
    if (labelRef.current) labelRef.current.position.set(0, h + 0.12, 0);

    /* 2. CYLINDRICAL billboard — around Y only, so crouching cannot tip it */
    const camera = state.camera;
    group.rotation.set(
      0,
      Math.atan2(
        camera.position.x - group.position.x,
        camera.position.z - group.position.z
      ),
      0
    );
  });

  /* tap reopens the options; a long press starts the remove gesture */
  const pressTimer = React.useRef<number | null>(null);
  const longPressed = React.useRef(false);

  const clearPress = React.useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);
  React.useEffect(() => clearPress, [clearPress]);

  const label = labelDimsMm(item);
  const caption = dimsCaption(item);

  /*
   * In an immersive session the page's own DOM is not composited — only the
   * WebXR dom-overlay root is. Portal the label there while a session is
   * running so the numbers survive on the phone, and back to the canvas's
   * parent when it ends.
   */
  const domOverlayRoot = useXR((s) => s.domOverlayRoot);
  const portal = React.useMemo(() => {
    if (!domOverlayRoot) return undefined;
    return { current: domOverlayRoot as HTMLElement } as React.RefObject<HTMLElement>;
  }, [domOverlayRoot]);

  const failed = item.fit?.verdict === "fail";
  const tight = item.fit?.verdict === "tight";

  return (
    <group ref={groupRef} position={item.position}>
      <group ref={meshRef}>
        <mesh
          onPointerDown={() => {
            longPressed.current = false;
            clearPress();
            pressTimer.current = window.setTimeout(() => {
              longPressed.current = true;
              vibrate(16);
              emitItemEvent(REMOVE_ITEM_EVENT, item.id);
            }, 550);
          }}
          onPointerUp={clearPress}
          onPointerLeave={clearPress}
          onPointerCancel={clearPress}
          onClick={(event) => {
            event.stopPropagation();
            clearPress();
            if (longPressed.current) return;
            setActiveItem(item.id);
            emitItemEvent(OPEN_OPTIONS_EVENT, item.id);
          }}
        >
          <planeGeometry args={[1, 1]} />
          {texture ? (
            <meshBasicMaterial
              map={texture}
              /*
               * AN ALPHA-TESTED CUTOUT, NOT A BLENDED ONE. This is deliberate
               * and both halves matter:
               *
               *   `transparent` stays OFF. /api/placeholder flood-fills a white
               *   background to alpha 0, but those texels keep their WHITE rgb;
               *   with blending on, linear filtering and mipmaps bleed that
               *   white into the edge and the sprite wears a pale fringe —
               *   which is exactly what shows up against a dark room. With
               *   blending off a fragment is either drawn whole or discarded,
               *   so there is nothing to bleed.
               *
               *   `depthWrite` therefore stays ON (the default). An alpha test
               *   discards before the depth write, so a cutout cannot punch a
               *   hole in the sprite behind it, and the depth buffer sorts two
               *   sprites standing near each other exactly — where the
               *   transparent pass would sort them by centroid and flicker as
               *   the user walks between them.
               */
              alphaTest={0.5}
              toneMapped={false}
              side={DoubleSide}
            />
          ) : (
            /* the skeleton: the right proportion in the right place, so the
               composition is visible while /api/placeholder is drawing */
            <meshBasicMaterial
              color={item.placeholderStatus === "failed" ? "#b4713c" : "#c97b5f"}
              transparent
              opacity={0.22}
              depthWrite={false}
              toneMapped={false}
              side={DoubleSide}
            />
          )}
        </mesh>
      </group>

      {/* the ONE dimension label, world-anchored above the active sprite */}
      <group ref={labelRef}>
        {active ? (
          <Html
            center
            portal={portal}
            pointerEvents="none"
            zIndexRange={[30, 10]}
            className="pointer-events-none"
          >
            <div className="flex flex-col items-center gap-1">
              <div className="flex flex-col items-center gap-0.5 whitespace-nowrap rounded-full border border-line/60 bg-background/75 px-3 py-1 backdrop-blur-md">
                <span className="flex items-baseline gap-1">
                  <NumberPlate
                    value={label?.widthMm ?? null}
                    size="sm"
                    label="width"
                  />
                  <span className="text-xs text-muted-foreground">×</span>
                  <NumberPlate
                    value={label?.heightMm ?? null}
                    unit="mm"
                    size="sm"
                    label="height"
                  />
                </span>
                <span
                  className={cn(
                    "text-[10px]",
                    dimsTone(item) === "warn"
                      ? "text-warn"
                      : "text-muted-foreground"
                  )}
                >
                  {caption}
                </span>
              </div>

              {/* the fit verdict, printed exactly as the kernel returned it */}
              {item.fit && (failed || tight) ? (
                <p
                  className={cn(
                    "max-w-[15rem] whitespace-normal rounded-xl bg-background/80 px-2 py-1 text-center text-[10px] backdrop-blur-md",
                    failed ? "text-warn" : "text-muted-foreground"
                  )}
                >
                  {item.fit.reason}
                </p>
              ) : null}

              <p className="text-[10px] text-muted-foreground">
                Stand-in image — the product you pick is linked.
              </p>
            </div>
          </Html>
        ) : null}
      </group>
    </group>
  );
}

export default PlaceholderSprite;
