import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const json = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const manifest = json("manifest.json");
const pkg = json("package.json");
const lock = json("package-lock.json");
const versions = json("versions.json");
assert.equal(manifest.id, "simple-days");
assert.equal(manifest.name, "Simple Days");
assert.equal(manifest.author, "ChenXiaoW");
assert.match(manifest.id, /^[a-z]+(?:-[a-z]+)*$/);
assert.ok(!manifest.id.includes("obsidian") && !manifest.id.endsWith("plugin"));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.match(manifest.minAppVersion, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[""].version, manifest.version);
assert.equal(pkg.name, manifest.id);
assert.equal(lock.name, manifest.id);
assert.equal(lock.packages[""].name, manifest.id);
assert.equal(versions[manifest.version], manifest.minAppVersion);
if (process.env.GITHUB_REF_TYPE === "tag") assert.equal(process.env.GITHUB_REF_NAME, manifest.version);

for (const file of ["main.js", "manifest.json", "styles.css", "README.md", "README.zh-CN.md", "LICENSE", "versions.json"]) {
  assert.ok(readFileSync(new URL(`../${file}`, import.meta.url), "utf8").trim(), `Missing or empty ${file}`);
}
assert.ok(!existsSync(new URL("../data.json", import.meta.url)), "Personal schedule data must stay outside the release repository");
const bundle = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const dependencies = [...bundle.matchAll(/require\(["']([^"']+)["']\)/g)].map(match => match[1]);
assert.ok(dependencies.length > 0 && dependencies.every(name => name === "obsidian"), "Runtime dependencies must come from Obsidian");
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: new URL("../", import.meta.url), encoding: "utf8" }).split("\0");
assert.ok(!tracked.some(file => /(?:^|\/)(?:node_modules|\.obsidian)(?:\/|$)|(?:^|\/)data\.json$|(?:^|\/)\.env(?:\.|$)/.test(file)), "Private or generated files are tracked");
console.log(`Release files verified: ${manifest.name} ${manifest.version}, Obsidian >= ${manifest.minAppVersion}.`);
