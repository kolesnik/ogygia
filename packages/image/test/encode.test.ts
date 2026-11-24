import fs from "node:fs";
import sharp from "sharp";
import { beforeAll, describe, expect, test } from "vitest";
import { plan_image, settle, write_variant } from "../src/vite/encode.ts";
import { DEFAULT_BREAKPOINTS, ladder } from "../src/vite/options.ts";
import { placeholder_style } from "../src/placeholder.ts";
import { make_images } from "./fixtures.ts";

let img: Awaited<ReturnType<typeof make_images>>;
beforeAll(async () => {
  img = await make_images();
});

describe("ladder", () => {
  test("every breakpoint under the intrinsic width, then the intrinsic width", () => {
    expect(ladder(1800, [640, 960, 1280, 1600, 2048], undefined)).toEqual([
      640, 960, 1280, 1600, 1800,
    ]);
  });
  test("capped at the top breakpoint", () => {
    expect(ladder(4000, [640, 960, 1280, 1600, 2048], undefined)).toEqual([
      640, 960, 1280, 1600, 2048,
    ]);
  });
  test("an image under every breakpoint is written once, at its own width", () => {
    expect(ladder(500, [640, 960], undefined)).toEqual([500]);
  });
  test("the default ladder starts small, so a listing thumbnail or avatar at 1× is not sent 640 pixels", () => {
    expect(ladder(2400, DEFAULT_BREAKPOINTS, undefined)).toEqual([
      320, 480, 640, 960, 1280, 1600, 2048,
    ]);
  });

  test("a display width writes 1×, 2× and the breakpoints between", () => {
    expect(ladder(4000, [640, 960, 1280, 1600, 2048], 720)).toEqual([
      720, 960, 1280, 1440,
    ]);
  });
});

describe("plan_image", () => {
  test("a photo: every width in AVIF and WebP, and a placeholder", async () => {
    const plan = await plan_image(img.jpg, settle({}, {}));
    expect([plan.width, plan.height, plan.animated]).toEqual([
      2400,
      1600,
      false,
    ]);
    expect(plan.variants.map((v) => v.name)).toEqual([
      "harbor-dusk-320.avif",
      "harbor-dusk-480.avif",
      "harbor-dusk-640.avif",
      "harbor-dusk-960.avif",
      "harbor-dusk-1280.avif",
      "harbor-dusk-1600.avif",
      "harbor-dusk-2048.avif",
      "harbor-dusk-320.webp",
      "harbor-dusk-480.webp",
      "harbor-dusk-640.webp",
      "harbor-dusk-960.webp",
      "harbor-dusk-1280.webp",
      "harbor-dusk-1600.webp",
      "harbor-dusk-2048.webp",
    ]);
    expect(plan.ph).toMatch(/^data:image\/webp;base64,/);
  });

  test("the placeholder is a tiny WebP made at build, its data URL at most 400 bytes, in the image's shape", async () => {
    const w = 1200;
    const h = 800;
    const noise = Buffer.alloc(w * h * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
    const noisy = `${img.dir}/noise.png`;
    await sharp(noise, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toFile(noisy);
    for (const file of [img.jpg, noisy]) {
      const plan = await plan_image(file, settle({}, {}));
      expect(plan.ph!.length).toBeLessThanOrEqual(400);
      const bytes = Buffer.from(plan.ph!.split(",")[1]!, "base64");
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(16);
      expect(meta.height).toBe(Math.round((16 * plan.height) / plan.width));
    }
  });

  test("the placeholder paints as a background with no decode at render", () => {
    const url = "data:image/webp;base64,UklGRg==";
    expect(placeholder_style(url)).toBe(
      `background-image:url(${url});background-size:cover;background-repeat:no-repeat`,
    );
    expect(placeholder_style(undefined)).toBe("");
  });

  test("the same file and settings plan to the same id; other settings to another", async () => {
    const a = await plan_image(img.jpg, settle({}, {}));
    const b = await plan_image(img.jpg, settle({}, {}));
    const c = await plan_image(img.jpg, settle({}, { quality: 50 }));
    expect(a.id).toBe(b.id);
    expect(c.id).not.toBe(a.id);
  });

  test("two files with the same bytes each name their variants after themselves", async () => {
    const twin = `${img.jpg.slice(0, img.jpg.lastIndexOf("/"))}/Twin Copy.jpg`;
    fs.copyFileSync(img.jpg, twin);
    const a = await plan_image(img.jpg, settle({}, {}));
    const b = await plan_image(twin, settle({}, {}));
    expect(a.variants[0]!.name).toBe("harbor-dusk-320.avif");
    expect(b.variants[0]!.name).toBe("twin-copy-320.avif");
  });

  test("a transparent image gets no placeholder: the blur would show through it", async () => {
    const plan = await plan_image(img.alpha, settle({}, {}));
    expect(plan.ph).toBeUndefined();
  });

  test("placeholder: false makes none", async () => {
    const plan = await plan_image(
      img.small,
      settle({}, { placeholder: false }),
    );
    expect(plan.ph).toBeUndefined();
  });

  test("an animated GIF becomes animated WebP only, frames kept", async () => {
    const plan = await plan_image(img.gif, settle({}, {}));
    expect(plan.animated).toBe(true);
    expect([plan.width, plan.height]).toEqual([320, 240]);
    expect(new Set(plan.variants.map((v) => v.format))).toEqual(
      new Set(["webp"]),
    );
    const out = await write_variant(
      img.gif,
      plan,
      plan.variants[0]!,
      settle({}, {}),
    );
    const meta = await sharp(out, { animated: true }).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.pages).toBe(3);
  });

  test("an SVG passes through, never rasterized", async () => {
    const plan = await plan_image(img.svg, settle({}, {}));
    expect(plan.variants).toEqual([
      { width: 120, format: "svg", name: "mark.svg" },
    ]);
    const out = await write_variant(
      img.svg,
      plan,
      plan.variants[0]!,
      settle({}, {}),
    );
    expect(fs.readFileSync(out, "utf8")).toContain("<svg");
  });

  test("EXIF orientation is applied: a portrait stored sideways reports its shown size", async () => {
    const plan = await plan_image(img.rotated, settle({}, {}));
    expect([plan.width, plan.height]).toEqual([200, 300]);
    const out = await write_variant(
      img.rotated,
      plan,
      plan.variants.at(-1)!,
      settle({}, {}),
    );
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([200, 300]);
  });

  test("an aspect crop changes the intrinsic size and every variant", async () => {
    const s = settle({}, { ops: { aspect: "1/1" }, formats: ["webp"] });
    const plan = await plan_image(img.jpg, s);
    expect([plan.width, plan.height]).toEqual([1600, 1600]);
    const out = await write_variant(img.jpg, plan, plan.variants[0]!, s);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([320, 320]);
  });

  test("a variant is written at its width in its format", async () => {
    const s = settle({}, {});
    const plan = await plan_image(img.jpg, s);
    const v = plan.variants.find(
      (x) => x.format === "avif" && x.width === 640,
    )!;
    const out = await write_variant(img.jpg, plan, v, s);
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["heif", 640, 427]);
  });

  test("a file that is not an image fails with its code", async () => {
    fs.writeFileSync(`${img.dir}/broken.png`, "not a png");
    await expect(
      plan_image(`${img.dir}/broken.png`, settle({}, {})),
    ).rejects.toThrow(/could not be read/);
  });
});
