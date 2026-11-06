import esbuild from "esbuild";
import { builtinModules } from "node:module";

const isWatch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...builtinModules],
  format: "cjs",
  target: "es2018",
  sourcemap: false,
  treeShaking: true,
  outfile: "main.js",
});

if (isWatch) {
  await context.watch();
  console.log("watching...");
} else {
  await context.rebuild();
  await context.dispose();
}
