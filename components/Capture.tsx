"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import exifr from "exifr";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Camera, ImageUp, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { StatusLine } from "@/components/ui/StatusLine";
import { withDemo } from "@/lib/demo";
import { NEUTRAL_ROOM_CONTEXT, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { Room, RoomContext } from "@/types";

/**
 * Capture — the first ten seconds.
 *
 * Someone is standing in their living room holding a phone. The live feed IS
 * the screen: one sentence, one shutter, one way to upload instead. Everything
 * else is friction.
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

/** Anything longer than 2:1 is a panorama, not a corner of a room. */
const MAX_ASPECT = 2;

/** Mean luminance, 0..1. Under this we offer a retake — we never block one. */
const DARK_LUMINANCE = 0.22;

/*
 * LONGER THAN THE SERVER'S OWN BUDGET, on purpose.
 *
 * /api/analyze races its providers for 22s and then answers — with a real read
 * if it got one, with the neutral palette if it did not. At 20s this side gave
 * up first, so a read that was about to succeed showed as "couldn't read the
 * style in that photo" and the server logged nothing, because nothing had gone
 * wrong. Whoever waits second must wait longer.
 */
const ANALYZE_TIMEOUT_MS = 35000;

const HEADLINE = "Photograph the room you want to change.";

const ANALYSING = [
  "Reading the light in the room…",
  "Picking out your colours…",
  "Working out the style…",
];

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

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
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
        dataUrl: room.dataUrl,
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
  | { kind: "dark"; room: Room }
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

/* ---------------------------------------------------------------- component */

export function Capture() {
  const router = useRouter();
  const reduced = useReducedMotion();

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

  const palette = useStore((s) => s.roomContext?.palette);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const uploadRef = React.useRef<HTMLInputElement | null>(null);
  const cameraRollRef = React.useRef<HTMLInputElement | null>(null);
  const liveRef = React.useRef(true);
  /** we ask for the camera once; a refusal opens the drop zone, not a loop */
  const askedRef = React.useRef(false);

  const stopCamera = React.useCallback(() => {
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
      router.push("/room");
    },
    [router, stopCamera]
  );

  const accept = React.useCallback(
    (room: Room) => {
      if (room.luminance !== undefined && room.luminance < DARK_LUMINANCE) {
        setPhase({ kind: "dark", room });
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
        accept(await roomFromFile(file));
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
    setMessage(null);
    try {
      // A live frame carries no EXIF — it is already the right way up.
      accept(buildRoom(el, el.videoWidth, el.videoHeight, UPRIGHT_NONE));
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
      setPhase({ kind: "camera" });
      return;
    }
    if (env === "handheld" || env === "desktop") {
      void startCamera();
      return;
    }
    // no camera on this device or this origin — back to the drop zone, never
    // a dead end
    setPhase(null);
  }, [env, startCamera]);

  /* ------------------------------------------------------------------ views */

  const springy = reduced
    ? { duration: 0.15 }
    : ({ type: "spring", stiffness: 420, damping: 34 } as const);

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

  const banner = message ? (
    <motion.p
      role="alert"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springy}
      className="flex items-start gap-2 rounded-xl border border-warn/40 bg-surface/95 px-3 py-2 text-left text-sm text-foreground shadow-sm backdrop-blur"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <span>{message}</span>
    </motion.p>
  ) : null;

  if (active.kind === "camera") {
    return (
      <div className="relative min-h-dvh w-full overflow-hidden bg-black">
        {hiddenInputs}

        <video
          ref={attachVideo}
          playsInline
          muted
          autoPlay
          aria-label="Live camera view of the room"
          className="absolute inset-0 size-full object-cover"
        />

        {/* scrim, so one line of serif stays readable over any room */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1/3"
          style={{
            background:
              "linear-gradient(to bottom, rgb(0 0 0 / 0.62), rgb(0 0 0 / 0))",
          }}
          aria-hidden
        />

        <div className="absolute inset-x-0 top-0 gutter pt-[max(28px,env(safe-area-inset-top))]">
          <motion.h1
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={springy}
            className="font-display mx-auto max-w-md text-balance text-[26px] leading-tight text-white drop-shadow-sm"
          >
            {HEADLINE}
          </motion.h1>
        </div>

        <div className="absolute inset-x-0 bottom-0">
          <div className="gutter pb-3">
            <div className="mx-auto max-w-md">
              <AnimatePresence>{banner}</AnimatePresence>
            </div>
          </div>

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
            style={{
              background:
                "linear-gradient(to top, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0))",
            }}
            aria-hidden
          />

          <div className="relative gutter pb-[max(24px,env(safe-area-inset-bottom))]">
            <div className="mx-auto grid max-w-md grid-cols-[1fr_auto_1fr] items-center">
              <div className="justify-self-start">
                <button
                  type="button"
                  onClick={() => uploadRef.current?.click()}
                  className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-sm text-white/90 transition-colors hover:bg-white/10 active:bg-white/15"
                >
                  <ImageUp className="size-4" aria-hidden />
                  Upload a photo
                </button>
              </div>

              <motion.button
                type="button"
                onClick={shoot}
                aria-label="Take the photo"
                whileTap={reduced ? undefined : { scale: 0.92 }}
                transition={springy}
                className="flex size-[72px] items-center justify-center rounded-full border-[3px] border-white/85 bg-transparent outline-none focus-visible:ring-4 focus-visible:ring-white/50"
              >
                <span className="block size-14 rounded-full bg-white" />
              </motion.button>

              <div aria-hidden />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (active.kind === "dark" || active.kind === "handoff") {
    const room = active.room;
    return (
      <div className="relative min-h-dvh w-full overflow-hidden bg-background">
        <div
          className="absolute inset-0 bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${room.dataUrl})` }}
          role="img"
          aria-label="The photo you just took"
        />

        {/* the palette lands in the top bar: five swatches, 40ms apart */}
        <div className="absolute inset-x-0 top-0 gutter pt-[max(16px,env(safe-area-inset-top))]">
          <div className="mx-auto flex max-w-md items-center gap-2">
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
                      ? { duration: 0.15 }
                      : {
                          type: "spring",
                          stiffness: 520,
                          damping: 30,
                          delay: i * 0.04,
                        }
                  }
                  className="size-7 rounded-full ring-1 ring-foreground/20"
                  style={{ backgroundColor: hex }}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 gutter pb-[max(24px,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-md">
            {active.kind === "handoff" ? (
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springy}
                className="rounded-2xl bg-foreground/85 px-4 py-3 backdrop-blur-sm"
              >
                <StatusLine
                  messages={ANALYSING}
                  intervalMs={2000}
                  className="text-background"
                />
              </motion.div>
            ) : (
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springy}
                className="rounded-2xl border border-line bg-surface/95 p-4 shadow-lg backdrop-blur"
              >
                <p className="text-sm">
                  It&rsquo;s dark in here — the colours may come out wrong.
                  Retake?
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={retake}
                    className="h-11 flex-1 rounded-full bg-accent px-4 text-sm font-medium text-[var(--on-accent)] transition-opacity hover:opacity-90"
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    onClick={() => commit(room)}
                    className="h-11 flex-1 rounded-full border border-line px-4 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    Use anyway
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* the drop zone — desktop, denied camera, or plain http on a phone */
  const reason = active.reason;
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background">
      {hiddenInputs}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void takeFile(e.dataTransfer.files?.[0]);
        }}
        className="flex flex-1 items-stretch gutter py-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(16px,env(safe-area-inset-bottom))]"
      >
        <motion.div
          animate={{ scale: dragging && !reduced ? 1.01 : 1 }}
          transition={springy}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-6 rounded-3xl border-2 border-dashed p-6 text-center transition-colors",
            dragging ? "border-accent bg-accent/5" : "border-line bg-surface/40"
          )}
        >
          <ImageUp className="size-8 text-muted-foreground" aria-hidden />

          <h1 className="font-display mx-auto max-w-sm text-balance text-3xl leading-tight">
            {HEADLINE}
          </h1>

          <p className="max-w-xs text-sm text-muted-foreground">
            Drop a photo here, or pick one from this device.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => uploadRef.current?.click()}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-[var(--on-accent)] transition-opacity hover:opacity-90"
            >
              <ImageUp className="size-4" aria-hidden />
              Upload a photo
            </button>

            {reason === "insecure" || reason === "denied" ? (
              <button
                type="button"
                onClick={() => cameraRollRef.current?.click()}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Camera className="size-4" aria-hidden />
                Take a photo
              </button>
            ) : null}

            {reason === "desktop" ? (
              <button
                type="button"
                onClick={() => void startCamera()}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Camera className="size-4" aria-hidden />
                Use the camera
              </button>
            ) : null}
          </div>

          {reason === "denied" ? (
            <p className="max-w-xs text-sm text-muted-foreground">
              Camera access is off for this site. Turn it back on in your
              browser&rsquo;s site settings, then reload.
            </p>
          ) : null}

          {reason === "insecure" ? (
            <p className="max-w-xs text-sm text-muted-foreground">
              The live camera needs an https address. Take the photo with your
              camera app and pick it here — it works just as well.
            </p>
          ) : null}

          {working ? (
            <StatusLine
              messages={["Straightening your photo…", "Measuring the light…"]}
              intervalMs={1400}
            />
          ) : null}

          <div className="min-h-[1rem] w-full max-w-sm">
            <AnimatePresence>{banner}</AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default Capture;
