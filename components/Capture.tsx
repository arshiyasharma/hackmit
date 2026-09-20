"use client";

import * as React from "react";
import exifr from "exifr";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import { Camera, ImageUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { StatusLine } from "@/components/ui/StatusLine";
import { withDemo } from "@/lib/demo";
import { DUR, EASE, ENTER, EXIT, REDUCED, STAGGER, cssEase } from "@/lib/motion";
import { NEUTRAL_ROOM_CONTEXT, useStore } from "@/lib/store";
import { useAppNav } from "@/lib/nav";
import { cn } from "@/lib/utils";
import type { Room, RoomContext } from "@/types";
import "./capture-glass.css";

/**
 * Capture — beat 01, "the room, empty".
 *
 * A centered photo picker accepts a drop, an upload, or a camera capture.
 * Once a camera is live, the feed fills the screen with one capture button.
 * Image processing and analysis share the same path.
 *
 * Two load-bearing details:
 *  - EXIF orientation is applied with exifr before anything downstream sees the
 *    pixels. A sideways-held phone must produce an upright photo, or every
 *    dimension in the fit check is wrong.
 *  - getUserMedia needs a secure context. Over plain http (a LAN IP at a
 *    hackathon) there is no camera at all, so the upload path is a first-class
 *    screen, not a fallback tacked on the side.
 *
 * The photo is read for STYLE and COLOUR and for nothing else — no mask, no
 * region, no crop. The shutter routes straight to /room with the still already
 * on screen; the room context lands underneath it.
 */

/* --------------------------------------------------------------- constants */

/** The long edge we keep. Photo mode's scale reference agrees with it. */
const MAX_EDGE = 1600;
/** What the style read gets. Palette and style words need no more than this. */
const ANALYSIS_EDGE = 512;

/** Anything longer than 2:1 is a panorama, not a corner of a room. */
const MAX_ASPECT = 2;

/** Mean luminance, 0..1. Under this we offer a retake — we never block one. */
const DARK_LUMINANCE = 0.22;

/*
 * LONGER THAN THE SERVER'S OWN BUDGET, on purpose. /api/analyze races its
 * providers for 14s and then answers, with a real read or with the neutral
 * palette. This side used to give up first, so a read that was about to
 * succeed showed as "couldn't read the style in that photo" while the server
 * log stayed clean. Whoever waits second waits longer.
 */
const ANALYZE_TIMEOUT_MS = 20000;

const ANALYSING = [
  "Reading the light in the room…",
  "Picking out your colours…",
  "Working out the style…",
];

/** What is happening to a picked file, said while it happens. */
const WORKING = ["Straightening your photo…", "Measuring the light…"];

/* -------------------------------------------------------------- upright-ing */

type Upright = {
  rad: number;
  scaleX: number;
  scaleY: number;
  dimensionSwapped: boolean;
};

const UPRIGHT_NONE: Upright = {
  rad: 0,
  scaleX: 1,
  scaleY: 1,
  dimensionSwapped: false,
};

/**
 * What exifr says we must do to the canvas, minus whatever the browser already
 * did while decoding.
 *
 * Modern browsers auto-apply EXIF orientation, older ones do not, and exifr's
 * own `canvas` flag is a user-agent guess. So we check the decoded pixel
 * dimensions against the dimensions the EXIF header declares: if the file says
 * 4032x3024 and the browser handed us 3024x4032, the rotation has already
 * happened and applying it again would lay the room on its side.
 */
async function uprightTransform(
  file: Blob,
  decodedWidth: number,
  decodedHeight: number
): Promise<Upright> {
  let rotation;
  try {
    rotation = await exifr.rotation(file);
  } catch {
    return UPRIGHT_NONE;
  }
  if (!rotation || typeof rotation.rad !== "number") return UPRIGHT_NONE;

  const needed: Upright = {
    rad: rotation.rad,
    scaleX: rotation.scaleX,
    scaleY: rotation.scaleY,
    dimensionSwapped: rotation.dimensionSwapped,
  };
  if (
    needed.rad === 0 &&
    needed.scaleX === 1 &&
    needed.scaleY === 1
  ) {
    return UPRIGHT_NONE;
  }

  // exifr's UA guess, used unless the dimensions tell us something better
  let alreadyApplied = rotation.canvas === false;

  if (needed.dimensionSwapped) {
    try {
      const header: unknown = await exifr.parse(file, [
        "ExifImageWidth",
        "ExifImageHeight",
      ]);
      const rawWidth = readNumber(header, "ExifImageWidth");
      const rawHeight = readNumber(header, "ExifImageHeight");
      if (rawWidth && rawHeight && rawWidth !== rawHeight) {
        if (decodedWidth === rawWidth && decodedHeight === rawHeight) {
          alreadyApplied = false;
        } else if (decodedWidth === rawHeight && decodedHeight === rawWidth) {
          alreadyApplied = true;
        }
      }
    } catch {
      /* no EXIF size block — keep the user-agent answer */
    }
  }

  return alreadyApplied ? UPRIGHT_NONE : needed;
}

function readNumber(source: unknown, key: string): number | undefined {
  if (!source || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/* ------------------------------------------------------------------ pixels */

/** An error with a sentence we are willing to show a person. */
class CaptureError extends Error {}

function meanLuminance(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): number {
  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, width, height).data;
  } catch {
    return 1;
  }
  const step = Math.max(1, Math.floor(Math.min(width, height) / 64));
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      count += 1;
    }
  }
  return count ? sum / (count * 255) : 1;
}

/**
 * Draw the source upright, downscaled to a 1600px long edge, and measure how
 * dark it is. `rawWidth`/`rawHeight` are the decoded dimensions BEFORE any
 * rotation we still have to apply.
 */
function buildRoom(
  source: CanvasImageSource,
  rawWidth: number,
  rawHeight: number,
  upright: Upright
): Room {
  if (!rawWidth || !rawHeight) {
    throw new CaptureError("That photo didn't decode. Try another one.");
  }

  const uprightWidth = upright.dimensionSwapped ? rawHeight : rawWidth;
  const uprightHeight = upright.dimensionSwapped ? rawWidth : rawHeight;
  const aspect = Math.max(
    uprightWidth / uprightHeight,
    uprightHeight / uprightWidth
  );
  if (aspect > MAX_ASPECT) {
    throw new CaptureError("Too wide — try a straight-on shot of one corner.");
  }

  const fit = Math.min(1, MAX_EDGE / Math.max(rawWidth, rawHeight));
  const drawWidth = Math.max(1, Math.round(rawWidth * fit));
  const drawHeight = Math.max(1, Math.round(rawHeight * fit));
  const width = upright.dimensionSwapped ? drawHeight : drawWidth;
  const height = upright.dimensionSwapped ? drawWidth : drawHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new CaptureError("This browser wouldn't give us a canvas to draw on.");
  }

  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(upright.rad);
  ctx.scale(upright.scaleX, upright.scaleY);
  ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  ctx.restore();

  /*
   * A SECOND, SMALLER COPY, FOR THE MODEL ONLY.
   *
   * The 1600px still is what stands in the room and what the sprites are
   * measured against. The style read needs none of that: it is looking for
   * five colours and four words, and a 512px copy carries those perfectly
   * while being roughly a tenth of the bytes to upload and to tokenise. The
   * room never sees this one.
   */
  const thumb = document.createElement("canvas");
  const thumbFit = Math.min(1, ANALYSIS_EDGE / Math.max(width, height));
  thumb.width = Math.max(1, Math.round(width * thumbFit));
  thumb.height = Math.max(1, Math.round(height * thumbFit));
  thumb.getContext("2d")?.drawImage(canvas, 0, 0, thumb.width, thumb.height);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    analysisDataUrl: thumb.toDataURL("image/jpeg", 0.75),
    width,
    height,
    luminance: Math.round(meanLuminance(ctx, width, height) * 1000) / 1000,
    capturedAt: Date.now(),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new CaptureError("That file didn't open as a photo."));
    img.src = src;
  });
}

async function roomFromFile(file: File): Promise<Room> {
  if (file.type && !file.type.startsWith("image/")) {
    throw new CaptureError("That isn't an image. Pick a photo of the room.");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const upright = await uprightTransform(
      file,
      img.naturalWidth,
      img.naturalHeight
    );
    return buildRoom(img, img.naturalWidth, img.naturalHeight, upright);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------------------------------------------------------- analysis */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function readStrings(source: unknown, key: string, limit: number): string[] {
  if (!source || typeof source !== "object") return [];
  const value = (source as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .slice(0, limit);
}

function readText(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const LIGHTING = new Set(["warm", "cool", "neutral"]);

/** Whatever /api/analyze answers, we only keep what we can actually render. */
function readContext(payload: unknown): RoomContext | null {
  const palette = readStrings(payload, "palette", 5).filter((hex) =>
    HEX.test(hex)
  );
  if (palette.length === 0) return null;
  const lighting = readText(payload, "lighting");
  return {
    palette,
    // shopping words, lowercase, so they read the same in the search string
    styleTags: readStrings(payload, "styleTags", 5).map((t) =>
      t.trim().toLowerCase()
    ),
    lighting:
      lighting && LIGHTING.has(lighting)
        ? (lighting as RoomContext["lighting"])
        : "neutral",
    roomType: readText(payload, "roomType"),
    suggestions: readStrings(payload, "suggestions", 6),
    source: "model",
  };
}

/**
 * Fire-and-forget: this outlives the component, because we route to /room the
 * moment the shutter fires and the answer lands in the store either way.
 * Nothing in this app is ever blocked by one failed call.
 */
async function runAnalysis(room: Room): Promise<void> {
  const setRoomContext = useStore.getState().setRoomContext;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
  try {
    const res = await fetch(withDemo("/api/analyze"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dataUrl: room.analysisDataUrl ?? room.dataUrl,
        width: room.width,
        height: room.height,
        luminance: room.luminance,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`analyze answered ${res.status}`);
    const context = readContext(await res.json());
    if (!context) throw new Error("analyze sent no palette");
    setRoomContext(context);
  } catch {
    // never block: a neutral palette, no style words, and the strip says so
    setRoomContext(NEUTRAL_ROOM_CONTEXT);
    toast("Couldn't read the style in that photo — the search will be generic.");
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------- phases */

type DropReason = "boot" | "desktop" | "denied" | "insecure";

type Phase =
  | { kind: "drop"; reason: DropReason }
  | { kind: "camera" }
  | {
      kind: "dark";
      room: Room;
      /** how the photo arrived, and the screen it arrived from: where "Retake" leads */
      via: "shutter" | "file";
      from: Phase | null;
    }
  | { kind: "handoff"; room: Room };

/**
 * What this device can actually do, read once on the client.
 *
 * "boot" is the server's answer, so the first client render matches the HTML
 * and there is no hydration mismatch. A laptop's front-facing webcam is not
 * what this screen is for, so a fine pointer opens the drop zone and leaves the
 * camera on offer.
 */
type Env = "boot" | "insecure" | "desktop" | "handheld";

function readEnv(): Env {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return "insecure";
  }
  const handheld =
    window.matchMedia("(pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0;
  return handheld ? "handheld" : "desktop";
}

const subscribeToNothing = () => () => {};
const serverEnv = (): Env => "boot";

function bootReason(env: Env): DropReason {
  if (env === "insecure") return "insecure";
  if (env === "desktop") return "desktop";
  return "boot";
}

/* -------------------------------------------------------------------- looks */

/*
 * Every duration and curve on this screen comes from lib/motion.ts. The two a
 * stylesheet transition needs are handed down as custom properties, so a hover
 * keeps the same time as everything `motion` moves.
 */
const MOTION_VARS = {
  "--micro": `${DUR.micro}s`,
  "--ease-out": cssEase("out"),
} as React.CSSProperties;

const MICRO = { duration: DUR.micro, ease: EASE.out } as const;

/** The motion sheet holds the type back this long, so the room is seen first. */
const TYPE_DELAY = 0.25;

/** The palette's own colours at part strength; a raw rgb() would drift from the tokens. */
const wash = (token: string, percent: number) =>
  `color-mix(in srgb, var(${token}) ${percent}%, transparent)`;

/*
 * The light the glass sits in: soft, from above, pooled behind the pane, in
 * the accent's two palest tints so it takes the colour of whichever room the
 * product stands in. Flat paper gives a frosted pane nothing to bend. Room III
 * paints a light of its own behind every screen; this one travels with the
 * screen, so the pane looks the same on its own URL.
 */
const LIGHT = [
  `radial-gradient(58% 48% at 92% 6%, ${wash("--accent-pale", 62)}, transparent 70%)`,
  `radial-gradient(50% 42% at 4% 12%, ${wash("--accent-wash", 95)}, transparent 72%)`,
  `radial-gradient(70% 52% at 68% 108%, ${wash("--accent-pale", 44)}, transparent 70%)`,
].join(", ");

function PaperLight() {
  return (
    <div
      aria-hidden
      className="capture-paper-light pointer-events-none absolute inset-0 -z-10"
      style={{ background: LIGHT }}
    />
  );
}

/* a button answers the pointer by moving, never by changing its blur or its shadow */
const PRESS =
  "cursor-pointer transition-[translate,scale,color,background-color] duration-[var(--micro)] ease-[var(--ease-out)] hover:-translate-y-px active:translate-y-0 active:scale-[0.985]";
const FOCUS_ON_PAPER =
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent";
/*
 * The glass classes are written after Tailwind's utilities in the same layer,
 * so their 22px radius beats a plain `rounded-full`; hence the `!`.
 */
const PRIMARY = `glass-accent rounded-full! inline-flex h-12 items-center justify-center gap-2.5 px-7 text-[15px] font-medium ${PRESS} ${FOCUS_ON_PAPER}`;
const SECONDARY = `glass-pill inline-flex h-12 items-center justify-center gap-2.5 px-6 text-[15px] font-medium text-foreground hover:text-accent ${PRESS} ${FOCUS_ON_PAPER}`;

const STATUS_MONO = "font-mono text-[13px] tracking-[0.02em] text-foreground";

/** A word arriving: a fade, held back with the headline and staggered like one of its lines. */
function arriving(reduced: boolean, order: number) {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: reduced
      ? REDUCED
      : { ...ENTER, delay: TYPE_DELAY + order * STAGGER.line },
  };
}

function carriesFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/* ---------------------------------------------------------------- component */

export function Capture() {
  // the room is a URL on its own, and a screen swap inside the landing's room III
  const nav = useAppNav();
  const reduced = useReducedMotion() === true;

  const env = React.useSyncExternalStore(
    subscribeToNothing,
    readEnv,
    serverEnv
  );

  // null means "wherever this device starts": the drop zone, which is also what
  // a phone shows for the one frame before its camera feed arrives, so the swap
  // is a fade rather than a flash of a different screen.
  const [phase, setPhase] = React.useState<Phase | null>(null);
  const active: Phase = phase ?? { kind: "drop", reason: bootReason(env) };
  const [message, setMessage] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [working, setWorking] = React.useState(false);
  const [cameraReady, setCameraReady] = React.useState(false);

  const palette = useStore((s) => s.roomContext?.palette);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const uploadRef = React.useRef<HTMLInputElement | null>(null);
  const cameraRollRef = React.useRef<HTMLInputElement | null>(null);
  const liveRef = React.useRef(true);
  /** we ask for the camera once; a refusal opens the drop zone, not a loop */
  const askedRef = React.useRef(false);
  /** a drag crosses every child on its way in; only the last leave is a leave */
  const dragDepth = React.useRef(0);

  const stopCamera = React.useCallback(() => {
    setCameraReady(false);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const attachVideo = React.useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    // Measure/attach on the ref callback, never only in an effect: a stream
    // that arrived first would otherwise sit unattached until something else
    // re-rendered.
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => {});
    }
  }, []);

  const startCamera = React.useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      if (!liveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const el = videoRef.current;
      if (el) {
        el.srcObject = stream;
        void el.play().catch(() => {});
      }
      setMessage(null);
      setPhase({ kind: "camera" });
    } catch (error) {
      // "there is no camera here" is a different sentence from "you said no"
      const refused =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      setPhase({
        kind: "drop",
        reason: refused ? "denied" : "desktop",
      });
    }
  }, []);

  // A phone opens straight into the feed. Everything else waits for a tap.
  React.useEffect(() => {
    if (env !== "handheld") return;
    if (phase !== null || streamRef.current || askedRef.current) return;
    askedRef.current = true;
    void startCamera();
  }, [env, phase, startCamera]);

  React.useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  /* ------------------------------------------------------------- committing */

  const commit = React.useCallback(
    (room: Room) => {
      const store = useStore.getState();
      store.setRoomImage(room);
      stopCamera();
      setPhase({ kind: "handoff", room });
      void runAnalysis(room);
      // The still is already on screen. The room context lands underneath it.
      nav.push("/room");
    },
    [nav, stopCamera]
  );

  const accept = React.useCallback(
    (room: Room, via: "shutter" | "file") => {
      if (room.luminance !== undefined && room.luminance < DARK_LUMINANCE) {
        setPhase((from) => ({ kind: "dark", room, via, from }));
        return;
      }
      commit(room);
    },
    [commit]
  );

  const takeFile = React.useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      setMessage(null);
      setWorking(true);
      try {
        accept(await roomFromFile(file), "file");
      } catch (error) {
        setMessage(
          error instanceof CaptureError
            ? error.message
            : "That photo didn't work. Try another one."
        );
      } finally {
        setWorking(false);
      }
    },
    [accept]
  );

  const shoot = React.useCallback(() => {
    const el = videoRef.current;
    if (!el || !el.videoWidth) return;
    // the shutter is felt as well as seen, on a device that can
    if (typeof navigator.vibrate === "function") navigator.vibrate(8);
    setMessage(null);
    try {
      // A live frame carries no EXIF — it is already the right way up.
      accept(buildRoom(el, el.videoWidth, el.videoHeight, UPRIGHT_NONE), "shutter");
    } catch (error) {
      setMessage(
        error instanceof CaptureError
          ? error.message
          : "That frame didn't work. Try again."
      );
    }
  }, [accept]);

  const retake = React.useCallback(() => {
    setMessage(null);
    if (streamRef.current) {
      setCameraReady(false);
      setPhase({ kind: "camera" });
      return;
    }
    // A photo that came from a file has no camera to go back to. On a laptop
    // that is the usual way in, and "Retake" must not switch a webcam on that
    // nobody asked for: it leads back to the drop zone the file came from,
    // with whatever that drop zone was saying about the camera.
    if (phase?.kind === "dark" && phase.via === "file") {
      setPhase(phase.from?.kind === "drop" ? phase.from : null);
      return;
    }
    if (env === "handheld" || env === "desktop") {
      void startCamera();
      return;
    }
    // no camera on this device or this origin — back to the drop zone, never
    // a dead end
    setPhase(null);
  }, [env, phase, startCamera]);

  /** The way back out of the feed. A laptop's webcam is often the wrong camera. */
  const closeCamera = React.useCallback(() => {
    stopCamera();
    setMessage(null);
    // "desktop" is the drop zone that keeps the camera on offer, which is what
    // someone who has just closed it wants, whatever they are holding
    setPhase({ kind: "drop", reason: "desktop" });
  }, [stopCamera]);

  // Escape returns to the photo picker without adding controls over the feed.
  const cameraUp = active.kind === "camera";
  React.useEffect(() => {
    if (!cameraUp) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeCamera();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cameraUp, closeCamera]);

  /*
   * The dark-room card is a dialog, so Escape answers it — with the safe
   * answer. Room III closes on a bare Escape and turns the browser's Back into
   * one; it stands aside for anything with role="dialog", and this is what it
   * expects to find listening.
   */
  const darkUp = active.kind === "dark";
  React.useEffect(() => {
    if (!darkUp) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      retake();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [darkUp, retake]);

  /* ------------------------------------------------------------------ views */

  const hiddenInputs = (
    <>
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void takeFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRollRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void takeFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );

  // thick glass: it is read over a camera feed as often as over the pane
  const banner = message ? (
    <motion.p
      key="problem"
      role="alert"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: reduced ? REDUCED : EXIT }}
      transition={reduced ? REDUCED : ENTER}
      className="capture-notice glass-thick flex items-start gap-2.5 px-4 py-3 text-left text-sm leading-snug text-foreground"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <span>{message}</span>
    </motion.p>
  ) : null;

  if (active.kind === "camera") {
    return (
      <div data-pixx-product="" className="capture-camera">
        <video
          ref={attachVideo}
          playsInline
          muted
          autoPlay
          onLoadedData={() => setCameraReady(true)}
          aria-label="Live camera view of the room"
          className="capture-camera-feed"
        />
        {message ? (
          <p role="alert" className="capture-camera-error">{message}</p>
        ) : null}
        <button
          type="button"
          autoFocus
          onClick={shoot}
          disabled={!cameraReady || working}
          className="capture-camera-shutter"
        >
          Take the picture
        </button>
      </div>
    );
  }

  if (active.kind === "dark" || active.kind === "handoff") {
    const room = active.room;
    const waiting = active.kind === "handoff";
    return (
      <div
        data-pixx-product=""
        className="capture-review relative isolate flex min-h-dvh w-full flex-col items-center justify-center bg-background px-[clamp(16px,5vw,80px)] pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(72px,calc(env(safe-area-inset-top)+56px))]"
        style={MOTION_VARS}
      >
        <PaperLight />

        {/* the photo as a print on paper: large, centred, a soft shadow under it */}
        <motion.figure
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduced ? REDUCED : ENTER}
          className="m-0 flex w-full max-w-[76rem] flex-col items-center gap-7"
        >
          <div
            className="relative max-w-full overflow-hidden rounded-none bg-muted"
            style={{ boxShadow: "var(--glass-shadow)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL: there is nothing for the image optimiser to fetch */}
            <img
              src={room.dataUrl}
              width={room.width}
              height={room.height}
              alt="The photo you just took"
              draggable={false}
              className="block h-auto max-h-[62dvh] w-auto max-w-full select-none"
            />

            {/* the wait is a line of light along the foot of the print. Never a spinner. */}
            {waiting && !reduced ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 block h-[3px] overflow-hidden"
              >
                <motion.span
                  className="block h-full w-1/3"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, var(--accent), transparent)",
                  }}
                  animate={{ x: ["-100%", "300%"] }}
                  transition={{
                    duration: DUR.scene,
                    ease: EASE.inOut,
                    repeat: Infinity,
                  }}
                />
              </span>
            ) : null}
          </div>

          {waiting ? (
            <figcaption className="flex w-full flex-col items-center gap-4 text-center">
              <p className="eyebrow text-accent">01 — Your room</p>

              <StatusLine
                messages={ANALYSING}
                intervalMs={2000}
                className={STATUS_MONO}
              />

              {/* the palette lands under the print: five swatches, 40ms apart */}
              <div className="flex min-h-8 items-center justify-center gap-2.5">
                <AnimatePresence>
                  {(palette ?? []).slice(0, 5).map((hex, i) => (
                    <motion.span
                      key={`${hex}-${i}`}
                      title={hex}
                      initial={
                        reduced
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.4, y: -8 }
                      }
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={
                        reduced
                          ? REDUCED
                          : { ...ENTER, delay: i * STAGGER.chip }
                      }
                      className="size-8 rounded-full ring-1 ring-foreground/20"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </figcaption>
          ) : null}
        </motion.figure>

        {!waiting ? (
          <div className="absolute inset-0 z-10 grid place-items-center p-4">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="capture-dark-title"
              onKeyDown={(event) => {
                // two buttons and nothing else to answer: Tab stays between them
                if (event.key !== "Tab") return;
                const stops =
                  event.currentTarget.querySelectorAll<HTMLElement>("button");
                if (stops.length === 0) return;
                const first = stops[0];
                const last = stops[stops.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={reduced ? REDUCED : ENTER}
              className="glass-thick glass-sheen w-full max-w-[27rem] p-7 desk:p-8"
            >
              <p className="eyebrow text-warn">Low light</p>
              <p
                id="capture-dark-title"
                className="font-display mt-3 text-balance text-[26px] font-medium leading-[1.12] tracking-[0.01em]"
              >
                It&rsquo;s dark in here — the colours may come out wrong.
                Retake?
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  autoFocus
                  onClick={retake}
                  className={cn(PRIMARY, "flex-1 px-4")}
                >
                  Retake
                </button>
                <button
                  type="button"
                  onClick={() => commit(room)}
                  className={cn(SECONDARY, "flex-1 px-4")}
                >
                  Use anyway
                </button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </div>
    );
  }

  /* The first step: one photo, by upload, drop, or camera. */
  const reason = active.reason;
  const lifted = dragging && !reduced;

  return (
    <div
      // Accept drops across the page so a file cannot navigate away from the app.
      onDragEnter={(e) => {
        if (!carriesFiles(e)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!carriesFiles(e)) return;
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void takeFile(e.dataTransfer.files?.[0]);
      }}
      data-pixx-product=""
      className="capture-upload"
      style={MOTION_VARS}
    >
      {hiddenInputs}

      <div className="capture-panel">
        <motion.div {...arriving(reduced, 0)} className="capture-heading">
          <h1 className="capture-title">Start with your room</h1>
          <p className="capture-description">
            Upload a photo, then find pieces that fit your space.
          </p>
        </motion.div>

        <motion.section
          aria-labelledby="capture-drop-title"
          aria-busy={working}
          animate={{ y: lifted ? -3 : 0 }}
          transition={reduced ? REDUCED : MICRO}
          data-dragging={dragging}
          className="capture-dropzone"
        >
          <span aria-hidden className="capture-drop-icon">
            <ImageUp className="size-5" strokeWidth={1.5} />
          </span>

          <h2 id="capture-drop-title" className="capture-drop-title">
            {dragging ? "Drop your photo to begin" : "Drop your room photo here"}
          </h2>

          <div className="capture-actions">
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              disabled={working}
              className="capture-button capture-button-primary"
            >
              <ImageUp className="size-4" aria-hidden />
              Upload a photo
            </button>

            {reason === "insecure" || reason === "denied" ? (
              <button
                type="button"
                onClick={() => cameraRollRef.current?.click()}
                disabled={working}
                className="capture-button capture-button-secondary"
              >
                <Camera className="size-4" aria-hidden />
                Take a photo
              </button>
            ) : null}

            {reason === "desktop" ? (
              <button
                type="button"
                onClick={() => void startCamera()}
                disabled={working}
                className="capture-button capture-button-secondary"
              >
                <Camera className="size-4" aria-hidden />
                Use camera
              </button>
            ) : null}
          </div>

          {reason === "denied" ? (
            <p className="capture-help">
              Camera access is off. Enable it in your browser&rsquo;s site settings,
              then reload, or upload a photo.
            </p>
          ) : null}

          {reason === "insecure" ? (
            <p className="capture-help">
              Live camera access isn&rsquo;t available here. Take a photo with your
              camera app, then upload it.
            </p>
          ) : null}

          {working ? (
            <StatusLine
              messages={WORKING}
              intervalMs={1400}
              className="capture-status"
            />
          ) : null}

          <AnimatePresence>{banner}</AnimatePresence>
        </motion.section>

        <p className="capture-tip">
          One clear photo, taken straight on. No panoramas.
        </p>
      </div>
    </div>
  );
}

export default Capture;
