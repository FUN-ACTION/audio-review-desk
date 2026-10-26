import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here,"../../src/audio_review_desk/static");
await build({entryPoints:[path.join(here,"entry.mjs")],outfile:path.join(target,"motion-vendor.js"),bundle:true,minify:true,
  format:"esm",target:["es2022"],legalComments:"none",define:{"process.env.NODE_ENV":'"production"'},
  banner:{js:"// Motion 14.6.0 (MIT). See motion-LICENSE.txt. Rebuild: scripts/motion-build/build.mjs"}});
const notices=[];
for(const name of ["motion","framer-motion","motion-dom","motion-utils"]){
  const dir=path.join(here,"node_modules",name),pkg=JSON.parse(await readFile(path.join(dir,"package.json"),"utf8"));
  notices.push(`${name} ${pkg.version}\n${await readFile(path.join(dir,"LICENSE.md"),"utf8")}`);
}
await writeFile(path.join(target,"motion-LICENSE.txt"),notices.join("\n\n"));
const bytes=await readFile(path.join(target,"motion-vendor.js"));
await writeFile(path.join(here,"bundle.json"),JSON.stringify({version:"14.6.0",bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")},null,2)+"\n");
console.log(`Bundled Motion: ${bytes.length} bytes`);
