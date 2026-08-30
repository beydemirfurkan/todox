/**
 * Builds the publishable stdio server into `dist-npm/`.
 *
 * Running it without a clone is the whole point: the README promises there is
 * nothing to install and no repository to fetch, and the local mode used to
 * need both. The tarball this produces is attached to a GitHub Release and
 * `npx` takes that URL directly, so there is no npm package and no account
 * anywhere in the path. The name stays `todox-mcp` because `todox` on npm has
 * belonged to somebody else since 2018, and a tarball still has to be called
 * something.
 *
 * What makes this a separate build rather than packing the root: the app
 * depends on Next, React, `pg` and nodemailer, and the stdio server depends on
 * none of them — it talks to the hosted API over HTTP and never opens a
 * database. Shipping the root manifest would install a web framework and a
 * Postgres driver to run a program that cannot use either.
 *
 * So the dependency list is not written by hand. It is read out of the compiled
 * output by walking the actual `require` graph from the entry point, and the
 * build fails if that graph reaches anything the package does not declare. That
 * is the guard: `mcp/tools.ts` is shared with the server, and the last time
 * something database-shaped leaked into it, the local transport lost a feature
 * silently for weeks.
 */
import "./env";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "dist-npm");
const ENTRY = join(OUT, "mcp", "server.js");

/** Everything the stdio server may reach. Anything else is a bug, not a dependency. */
const ALLOWED = ["@modelcontextprotocol/sdk", "zod"] as const;

const PACKAGE_NAME = "todox-mcp";

type Json = Record<string, unknown>;

/**
 * Node's own resolution, minus the parts this output cannot produce.
 *
 * `../i18n` is a directory here, and an earlier version of this walk resolved
 * it to `i18n.js`, found nothing, and reported the file as dead — which would
 * have pruned a module that is required at runtime and shipped a package that
 * throws on its first report. Directory-with-index is the case to get right.
 */
function resolveLocal(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, join(base, "index.js")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file the entry point can actually reach, and every package it needs. */
function walk(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const missing: string[] = [];

  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(/require\("([^"]+)"\)/g)) {
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".")) {
        const target = resolveLocal(file, spec);
        if (!target) missing.push(`${relative(OUT, file)} -> ${spec}`);
        else visit(target);
        continue;
      }
      // `@scope/name` keeps two segments; `name/deep/path` keeps one.
      packages.add(spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/"));
    }
  };

  visit(entry);
  return { files, packages, missing };
}

function everyEmittedFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? everyEmittedFile(p) : p.endsWith(".js") ? [p] : [];
  });
}

function main() {
  rmSync(OUT, { recursive: true, force: true });

  // `tsc` compiles every file the entry can *see*, which includes the ones it
  // only imports types from. Those are pruned below rather than shipped: a type
  // import of `./reports` is free at runtime, but the emitted `reports.js`
  // requires the repositories, and a file in the package that throws when
  // required is a trap even if nothing requires it today.
  // `node node_modules/typescript/bin/tsc` rather than going through pnpm: a
  // shell would concatenate the arguments instead of escaping them, and Node
  // refuses to spawn a `.cmd` without one. Calling the compiler's own entry
  // point with the running interpreter avoids needing either.
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.mcp.json"], {
    stdio: "inherit",
  });

  const { files, packages, missing } = walk(ENTRY);
  if (missing.length)
    throw new Error(`the compiled output has imports that resolve to nothing:\n  ${missing.join("\n  ")}`);

  const stray = [...packages].filter((p) => !(ALLOWED as readonly string[]).includes(p));
  if (stray.length)
    throw new Error(
      `the stdio server reached a package it must not need: ${stray.join(", ")}.\n` +
        `It runs on a laptop and talks to the API over HTTP — it has no database and no framework.\n` +
        `Something in mcp/ has picked up a server-side import; find it rather than adding it here.`,
    );

  const pruned = everyEmittedFile(OUT).filter((f) => !files.has(f));
  for (const f of pruned) rmSync(f);

  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Json;
  const deps = root.dependencies as Record<string, string>;

  const manifest = {
    name: PACKAGE_NAME,
    version: root.version,
    description:
      "todox MCP server (stdio): persistent working memory for coding agents, with local file hashing.",
    license: root.license ?? "MIT",
    repository: { type: "git", url: "git+https://github.com/beydemirfurkan/todox.git" },
    homepage: "https://www.todox.dev",
    keywords: ["mcp", "model-context-protocol", "ai-agents", "memory", "todox"],
    bin: { [PACKAGE_NAME]: "mcp/server.js" },
    // Read from the compiled graph, not written by hand, so it cannot drift
    // from what the code actually loads.
    dependencies: Object.fromEntries(
      [...packages].sort().map((p) => {
        const range = deps[p];
        if (!range) throw new Error(`${p} is required at runtime but is not a dependency of the app`);
        return [p, range];
      }),
    ),
    engines: { node: ">=20" },
  };

  writeFileSync(join(OUT, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of ["LICENSE", "docs/mcp.md"]) {
    if (existsSync(join(ROOT, file)))
      writeFileSync(join(OUT, file === "docs/mcp.md" ? "README.md" : file), readFileSync(join(ROOT, file)));
  }

  // The shebang says `npx tsx` in the repository, because that is how it runs
  // from source. In the package it is plain JavaScript.
  const entrySource = readFileSync(ENTRY, "utf8");
  writeFileSync(ENTRY, `#!/usr/bin/env node\n${entrySource.replace(/^#!.*\n/, "")}`);

  console.log(`\n${PACKAGE_NAME}@${manifest.version}`);
  console.log(`  ${files.size} files, ${pruned.length} pruned`);
  console.log(`  dependencies: ${Object.keys(manifest.dependencies).join(", ")}`);
  console.log(`  publish with: npm publish ${relative(ROOT, OUT)}\n`);
}

try {
  mkdirSync(OUT, { recursive: true });
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
