import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(
  here,
  "../../src/audio_review_desk/static/tour/scene-vendor.js",
);
await build({
  entryPoints: [path.join(here, "entry.js")],
  outfile: out,
  bundle: true,
  format: "esm",
  minify: true,
  legalComments: "inline",
  target: "es2022",
});
await fs.copyFile(
  path.join(here, "node_modules/three/LICENSE"),
  path.join(path.dirname(out), "three-LICENSE.txt"),
);
const bytes = await fs.readFile(out);
await fs.writeFile(
  path.join(here, "bundle.json"),
  JSON.stringify(
    {
      name: "three",
      version: "0.180.0",
      license: "MIT",
      file: "scene-vendor.js",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Three.js 0.180.0: ${bytes.length} bytes`);
