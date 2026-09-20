"use client";

/**
 * "SEE IT IN YOUR ROOM, RIGHT NOW."
 *
 * The room screen is flat: sprites composited onto the photo at true size,
 * which is honest and readable and has no parallax in it. Live AR exists in
 * components/ArScene.tsx and needs WebXR, which means an Android phone in
 * Chrome — not the laptop a judge is looking at.
 *
 * So this is the third view, and the only one that runs everywhere: the room
 * rebuilt as a shallow 3D set. The photo becomes a wall at its real measured
 * height, the floor is where the wall meets it, and the linked products stand
 * on that floor at their real size. Drag to walk the camera a few degrees
 * either way and everything moves as it should — the products shift against
 * the wall behind them, their contact shadows slide, and the room reads as
 * depth rather than as a picture.
 *
 * WHAT THIS IS NOT. It does not track the room, rebuild geometry from the
 * photo, or know where the sofa already is. Two patches in the team's
 * downloads do exactly that — YOLO11s-seg in a web worker, depth per pixel,
 * RANSAC for the floor plane, each piece lifted into a solid — and that is
 * the right next step, not a hackathon evening. Everything here is a plane,
 * a measurement and a shadow, and it is truthful about being a set.
 *
 * THE CAMERA OPTION IS REAL AR-ISH. With a webcam, the wall is replaced by
 * the live feed, so the product stands in front of whatever the camera can
 * see, at its real size, right now. Untracked — move the laptop and the
 * product stays where it was put — which is why the button says "see how this
 * looks" and not "augmented reality".
 *
 * Takes no props. Reads lib/store.ts, like every other overlay on this screen.
 */

import * as React from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Group, SRGBColorSpace, Texture, VideoTexture } from "three";
import { Box, Camera, ImageIcon, X } from "lucide-react";

import { spriteSizeMm } from "@/components/PhotoMode";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { PlacedItem } from "@/types";

/** A standard US ceiling, used when nobody has measured the wall. */
const DEFAULT_CEILING_MM = 2438;

/** How far back the wall stands. Roughly where a sofa's far wall sits. */
const WALL_DISTANCE_M = 3.2;

/** Two is a scene; six is a showroom nobody asked for. */
const MAX_PIECES = 2;

/* ------------------------------------------------------------- one piece */

/**
 * The product, standing on the floor at its real size.
 *
 * components/PlaceholderSprite.tsx does this already and is not reused here:
 * it belongs to the WebXR scene, reads the session's dom-overlay root through
 * useXR, and portals its dimension label into it. Outside a session that hook
 * has nothing to read and the sprite does not draw. This is the same idea
 * with nothing session-shaped in it, turned to face the camera around Y only
 * so it cannot tip over when you look down at it.
 */
function Piece({ item, x }: { item: PlacedItem; x: number }) {
  const group = React.useRef<Group>(null);
  const url =
    item.listingCutoutUrl ??
    (item.placeholderStatus === "ready" ? item.placeholderUrl : "");

  const size = spriteSizeMm(item);
  const height = (size.heightMm / 1000) * item.scale;
  const width = (size.widthMm / 1000) * item.scale;

  /* cylindrical billboard: around Y only, in world space, so crouching to
     look under a table cannot lay the piece on its back */
  useFrame(({ camera }) => {
    const node = group.current;
    if (!node) return;
    node.rotation.set(
      0,
      Math.atan2(camera.position.x - x, camera.position.z - PIECE_DEPTH_M),
      0
    );
  });

  if (!url) return null;

  return (
    <>
      {/*
        THE ONE THING THAT PUTS IT ON THE FLOOR. A DOM element casts no shadow
        into the scene, so the piece gets a soft dark ellipse of its own, lying
        on the floor where it stands. It is drawn as real geometry rather than
        painted into the picture, so it slides correctly as the camera moves.
      */}
      <mesh
        position={[x, 0.002, PIECE_DEPTH_M]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[Math.max(width, 0.25) * 1.3, Math.max(width, 0.25) * 0.55, 1]}
      >
        <circleGeometry args={[0.5, 40]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.34} />
      </mesh>

    <group ref={group} position={[x, height / 2, PIECE_DEPTH_M]}>
      {/*
        THE PRODUCT IS THE SAME <img> THE FLAT VIEW SHOWS, transformed into the
        scene rather than uploaded to the GPU.
        
        As a texture on a plane it came out black: the PNG is a trimmed cut-out
        with alpha, 284x994, and between the alpha, the non-power-of-two size
        and whatever the machine's WebGL is willing to do with mipmaps, what
        reached the shader was not what the browser had already decoded
        perfectly well for the room screen. drei's <Html transform> puts the
        real element in the scene with a CSS 3D transform, so the piece here is
        pixel-for-pixel the piece there, and there is no upload to get wrong.
        
        It does not occlude and is not occluded, which costs nothing in a set
        this shallow: the pieces stand in front of the wall and never behind it.
      */}
      <Html
        transform
        center
        sprite={false}
        distanceFactor={undefined}
        scale={(height / PIECE_PIXELS) * HTML_PX_PER_METRE}
        pointerEvents="none"
        zIndexRange={[10, 0]}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            height: PIECE_PIXELS,
            width: (width / height) * PIECE_PIXELS,
            objectFit: "contain",
            filter: "drop-shadow(0 12px 18px rgba(0,0,0,0.45))",
            userSelect: "none",
          }}
        />
      </Html>
    </group>
    </>
  );
}

/** How many CSS pixels stand for the piece's full height before scaling. */
const PIECE_PIXELS = 520;

/*
 * drei's <Html transform> does not document a px-per-world-unit constant, so
 * this one is measured: at a scale of 1 the element stands about 52 CSS pixels
 * to the metre. It is the number that makes a 1,520 mm lamp read as 1,520 mm
 * against a 2,438 mm wall, which is checkable in the picture.
 */
const HTML_PX_PER_METRE = 52.4;

/** Where the pieces stand: in front of the wall, short of the camera. */
const PIECE_DEPTH_M = -1.25;

/* ------------------------------------------------------------------ scale */

/**
 * The room's real height in metres, from whatever measurement exists.
 *
 * The scale reference is the good answer — the user tapped ceiling and floor
 * and told us what that is in millimetres. Without one the photo's height is
 * assumed to be a standard ceiling, which is the same assumption the flat view
 * makes and says out loud in its caption.
 */
function useCeilingMetres(): { metres: number; measured: boolean } {
  const scale = useStore((s) => s.photoScale);

  return React.useMemo(() => {
    if (scale && scale.realMm > 0 && scale.heightFraction > 0) {
      return { metres: scale.realMm / scale.heightFraction / 1000, measured: true };
    }
    return { metres: DEFAULT_CEILING_MM / 1000, measured: false };
  }, [scale]);
}

/* ------------------------------------------------------------- the pieces */

/**
 * Stand the pieces in a row, shoulder to shoulder, centred on the camera.
 *
 * Each one gets its own width plus a hand's width of air, so a lamp beside a
 * sofa does not stand inside it. They are placed a little in front of the wall
 * rather than against it, because a product pressed flat to a backdrop is the
 * one thing that gives the set away.
 */
function placements(items: PlacedItem[]): Array<{ item: PlacedItem; x: number }> {
  const widths = items.map(
    (item) => (spriteSizeMm(item).widthMm / 1000) * item.scale
  );
  const gap = 0.22;
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (items.length - 1);

  let cursor = -total / 2;
  return items.map((item, i) => {
    const x = cursor + widths[i]! / 2;
    cursor += widths[i]! + gap;
    return { item, x };
  });
}

/* ------------------------------------------------------------ the backdrop */

/** The room photo, standing at its real height, a wall's distance away. */
function PhotoWall({ ceiling }: { ceiling: number }) {
  const roomImage = useStore((s) => s.roomImage);
  const [texture, setTexture] = React.useState<Texture | null>(null);

  React.useEffect(() => {
    if (!roomImage?.dataUrl) return;
    let live = true;
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!live) return;
      const t = new Texture(image);
      t.colorSpace = SRGBColorSpace;
      t.needsUpdate = true;
      setTexture(t);
    };
    image.src = roomImage.dataUrl;
    return () => {
      live = false;
    };
  }, [roomImage?.dataUrl]);

  if (!texture || !roomImage) return null;

  /*
   * The photo's HEIGHT is the measured wall, so the width follows from the
   * photo's own aspect. Anything else would stretch the room sideways to fit
   * a number nobody measured.
   */
  const aspect = roomImage.width / roomImage.height;
  const height = ceiling;
  const width = height * aspect;

  return (
    <mesh position={[0, height / 2, -WALL_DISTANCE_M]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/** The webcam, filling the frame behind everything. */
function CameraWall({ ceiling }: { ceiling: number }) {
  const [texture, setTexture] = React.useState<VideoTexture | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    let stream: MediaStream | null = null;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((granted) => {
        if (!live) {
          granted.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = granted;
        const video = document.createElement("video");
        video.srcObject = granted;
        video.muted = true;
        video.playsInline = true;
        void video.play();
        const t = new VideoTexture(video);
        t.colorSpace = SRGBColorSpace;
        setTexture(t);
      })
      .catch(() => {
        if (live) setFailed(true);
      });

    return () => {
      live = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (failed || !texture) return null;

  // 16:9 is what a laptop camera gives; the wall's height still sets the scale
  const height = ceiling * 1.1;
  return (
    <mesh position={[0, height / 2, -WALL_DISTANCE_M]}>
      <planeGeometry args={[(height * 16) / 9, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/* --------------------------------------------------------------- the scene */

function Scene({
  items,
  ceiling,
  live,
}: {
  items: PlacedItem[];
  ceiling: number;
  live: boolean;
}) {
  const placed = React.useMemo(() => placements(items), [items]);

  return (
    <>
      {/* a soft key from the front left and fill from above: enough shape on a
          textured plane without pretending we know where the window is */}
      <ambientLight intensity={1.1} />
      <directionalLight position={[-2.4, 3.2, 2.6]} intensity={1.5} />

      {live ? <CameraWall ceiling={ceiling} /> : <PhotoWall ceiling={ceiling} />}

      {placed.map(({ item, x }) => (
        <Piece key={item.id} item={item} x={x} />
      ))}

      <OrbitControls
        target={[0, Math.min(0.9, ceiling / 2.6), PIECE_DEPTH_M]}
        enablePan={false}
        /* a few degrees either way. Wide enough to feel like moving your head,
           narrow enough that the backdrop is never caught being flat */
        minAzimuthAngle={-Math.PI / 9}
        maxAzimuthAngle={Math.PI / 9}
        minPolarAngle={Math.PI / 3.2}
        maxPolarAngle={Math.PI / 1.9}
        minDistance={1.4}
        maxDistance={4.2}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

/* ---------------------------------------------------------------- the view */

export function LiveLookButton({ onOpen }: { onOpen: () => void }) {
  const items = useStore((s) => s.items);
  const ready = items.some((item) => item.linkedProduct);
  if (!ready) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "tap pointer-events-auto flex min-h-10 items-center gap-1.5 rounded-full",
        "border border-line bg-surface/90 px-3 text-[13px] backdrop-blur-md"
      )}
    >
      <Box className="size-4 text-accent" aria-hidden />
      See it in your room
    </button>
  );
}

export default function LiveLook({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const items = useStore((s) => s.items);
  const { metres, measured } = useCeilingMetres();
  const [live, setLive] = React.useState(false);

  const pieces = React.useMemo(
    () => items.filter((item) => item.linkedProduct).slice(0, MAX_PIECES),
    [items]
  );

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open || pieces.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-background">
      <Canvas
        camera={{ fov: 52, position: [0, Math.min(1.5, metres * 0.62), 1.7] }}
        gl={{ outputColorSpace: SRGBColorSpace, alpha: false }}
        onCreated={({ gl }) => {
          gl.setClearColor("#1b1613");
          // the sprites are already sRGB PNGs; do not double-correct them
          gl.outputColorSpace = SRGBColorSpace;
        }}
      >
        <React.Suspense fallback={null}>
          <Scene items={pieces} ceiling={metres} live={live} />
        </React.Suspense>
      </Canvas>

      {/* chrome, outside the canvas so it is ordinary DOM */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <p
          className={cn(
            "pointer-events-none max-w-[60%] rounded-2xl bg-surface/85 px-3 py-2",
            "text-[12px] leading-snug text-muted-foreground backdrop-blur-md"
          )}
        >
          {live
            ? "Your camera, with the piece standing in front of it at its real size."
            : measured
              ? `Your room, ${Math.round(metres * 100)} cm wall to floor. Drag to look around.`
              : "Drag to look around. Set the scale in the room view for real sizes."}
        </p>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLive((now) => !now)}
            className={cn(
              "tap flex min-h-10 items-center gap-1.5 rounded-full border border-line",
              "bg-surface/90 px-3 text-[13px] backdrop-blur-md"
            )}
          >
            {live ? (
              <ImageIcon className="size-4" aria-hidden />
            ) : (
              <Camera className="size-4 text-accent" aria-hidden />
            )}
            {live ? "Photo" : "Camera"}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className={cn(
              "tap grid size-10 place-items-center rounded-full border border-line",
              "bg-surface/90 backdrop-blur-md"
            )}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <p
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-4 mx-auto w-fit rounded-full",
          "bg-surface/85 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur-md"
        )}
      >
        A flat set, not a scan — full room geometry is the next build.
      </p>
    </div>
  );
}
