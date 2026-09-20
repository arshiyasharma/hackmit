import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const texture = vi.hoisted(() => vi.fn());
vi.mock("./placeholder", () => ({ loadTexture: texture, exists: vi.fn().mockResolvedValue(false) }));
vi.mock("../motion", () => ({
  gsap: { killTweensOf: vi.fn() }, reducedMotion: () => true, ease: {}, T: {}, done: vi.fn(),
}));
import { Stage } from "./Stage";
import { World } from "./World";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("requestAnimationFrame", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function pending() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function stageWithBuild(build: Promise<void>) {
  const stage = Object.create(Stage.prototype) as Stage;
  Object.assign(stage, {
    disposed: false, raf: 0, cleanup: [], frames: new Set(),
    canvas: { parentElement: null },
    world: { build: vi.fn(() => build), dispose: vi.fn(), update: vi.fn() },
    flat: { dispose: vi.fn() },
    post: { values: {}, dispose: vi.fn(), render: vi.fn() },
    renderer: { dispose: vi.fn() },
  });
  return stage;
}

describe("landing disposal during async loading", () => {
  it("does not resize or reattach the stage when assets finish after unmount", async () => {
    const load = pending();
    const stage = stageWithBuild(load.promise);
    const resize = vi.spyOn(stage, "resize");
    const initialization = stage.init();
    stage.dispose();
    load.resolve();
    await expect(initialization).resolves.toBeUndefined();
    expect(resize).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(stage.renderer.dispose).toHaveBeenCalledTimes(1);
  });
  it("ignores resize notifications after the canvas was detached", () => {
    const stage = stageWithBuild(Promise.resolve());
    expect(() => stage.resize()).not.toThrow();
  });
  it("disposes once and does not render a queued frame after disposal", () => {
    const stage = stageWithBuild(Promise.resolve());
    stage.dispose(); stage.dispose(); stage.frame(0, 0);
    expect(stage.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(stage.world.update).not.toHaveBeenCalled();
  });
  it("stops World construction when an in-flight texture completes after disposal", async () => {
    const load = pending();
    texture.mockImplementation(() => load.promise.then(() => new THREE.Texture()));
    const dispose = vi.spyOn(THREE.PlaneGeometry.prototype, "dispose");
    const world = new World();
    const building = world.build(["one", "two", "three", "four"]);
    world.dispose();
    load.resolve();
    await building;
    expect(world.modules).toHaveLength(0);
    expect(world.strip.children).toHaveLength(0);
    expect(texture).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
