/**
 * Builds the dogfooding lab: five developer accounts on the local server,
 * their repositories under ~/todox-lab, and an agent config for each that can
 * reach that local server and nothing else.
 *
 *   pnpm lab:setup            create what is missing, keep what is there
 *   pnpm lab:setup --reset    delete the lab accounts and folder first (runs/ is kept)
 *   pnpm lab:setup --habit    also write the habit, as `install:mcp` now does by default
 *
 * Refuses a remote database (scripts/local-only.ts): the accounts are created
 * through the repositories, which follow DATABASE_URL, and a lab that wrote
 * five fake developers into production would be the 2026-08-15 incident again.
 */
import "../env";
import { localDatabaseOnly } from "../local-only";

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { disconnect } from "../../lib/db/client";
import * as invitationsRepo from "../../lib/repositories/project-invitations";
import * as projectsRepo from "../../lib/repositories/projects";
import * as usersRepo from "../../lib/repositories/users";
import { createApiToken } from "../../lib/services/auth";
import * as invitations from "../../lib/services/project-invitations";
import { invoke } from "../../lib/services/rpc";
import { hashPassword } from "../../lib/util/password";
import { writeMemoryFile } from "../install-mcp/memory";
import { FIXTURES } from "./fixtures";
import {
  claudeConfig,
  LAB,
  LAB_URL,
  MCP_SERVER,
  openCodeHome,
  OPENCODE_MODELS,
  passwordFor,
  repoDir,
  SECRETS,
  secretsDir,
  tokenFile,
  TSX,
} from "./paths";
import { PERSONAS, remoteFor, type AgentKind, type Persona, type PersonaKey } from "./personas";

localDatabaseOnly("lab:setup");
assertLocalServer(LAB_URL);

const emailFor = (p: Persona) => `${p.username}@lab.todox.local`;

function assertLocalServer(url: string): void {
  const host = new URL(url).hostname;
  if (host !== "localhost" && host !== "127.0.0.1")
    throw new Error(`lab agents talk to a local server only, not ${host}`);
}

/**
 * How each agent reaches todox. Claude Code gets what `install:mcp` writes by
 * default (HTTP); OpenCode gets the stdio process its installer recommends; the
 * self-hoster runs stdio everywhere. So the lab covers both transports, and
 * Mert's third session crosses from one to the other.
 */
type Transport = "http" | "stdio";
const transportFor = (persona: PersonaKey, agent: AgentKind): Transport =>
  persona === "jonas" || agent === "opencode" ? "stdio" : "http";

/**
 * HOME is the persona's own, empty one. The stdio server reads the client's
 * user-level memory file to decide whether to send setup notes, and a lab
 * agent has none -- it runs with project settings only, or a private XDG
 * home -- so the developer's own file must not answer for it.
 */
function stdioEnv(persona: PersonaKey, token: string, agent: AgentKind): Record<string, string> {
  const home = join(secretsDir(persona), "home");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return {
    HOME: home,
    TODOX_TOKEN: token,
    TODOX_URL: LAB_URL,
    TODOX_CLIENT_NAME: agent === "claude" ? "claude-code" : "opencode",
    TODOX_CLIENT_VERSION: "lab",
  };
}

function writeSecret(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function writeClaudeConfig(persona: PersonaKey, token: string): void {
  const server =
    transportFor(persona, "claude") === "http"
      ? { type: "http", url: `${LAB_URL}/api/mcp`, headers: { Authorization: `Bearer ${token}` } }
      : { type: "stdio", command: TSX, args: [MCP_SERVER], env: stdioEnv(persona, token, "claude") };
  writeSecret(claudeConfig(persona), JSON.stringify({ mcpServers: { todox: server } }, null, 2));
}

/**
 * A private XDG config home, so OpenCode loads this file and not the
 * developer's own -- which carries other MCP servers, plugins and global
 * instructions that would both leak into the run and colour what it measures.
 * Credentials live under XDG_DATA_HOME and are untouched.
 */
function writeOpenCodeConfig(persona: PersonaKey, token: string): void {
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: OPENCODE_MODELS[persona],
    small_model: OPENCODE_MODELS[persona],
    autoupdate: false,
    // OpenCode 2 nests servers under `mcp.servers`; a v1-shaped entry is
    // silently ignored ("No MCP servers configured") -- see lib/mcp-clients.ts.
    mcp: {
      servers: {
        todox: {
          type: "local",
          command: [TSX, MCP_SERVER],
          environment: stdioEnv(persona, token, "opencode"),
          enabled: true,
        },
      },
    },
  };
  writeSecret(join(openCodeHome(persona), "opencode", "opencode.json"), JSON.stringify(config, null, 2));
}

async function ensureAccount(p: Persona) {
  const existing = await usersRepo.byUsername(p.username);
  if (existing) return existing;
  const user = await usersRepo.create({
    username: p.username,
    email: emailFor(p),
    name: p.name,
    password_hash: await hashPassword(passwordFor(p.key)),
  });
  await usersRepo.markEmailVerified(user.id);
  return user;
}

async function ensureToken(p: Persona, userId: number): Promise<string> {
  if (existsSync(tokenFile(p.key))) return readFileSync(tokenFile(p.key), "utf8").trim();
  const { token } = await createApiToken(userId, `lab ${p.key}`);
  writeSecret(tokenFile(p.key), token);
  return token;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function authorEnv(p: Persona) {
  return ["-c", `user.name=${p.name}`, "-c", `user.email=${emailFor(p)}`];
}

/** A fresh repository from the fixture, one commit, a remote nobody pushes to. */
function createRepo(p: Persona, name: keyof typeof FIXTURES): void {
  const dir = repoDir(p.key, name);
  for (const [path, content] of Object.entries(FIXTURES[name])) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", remoteFor(p.key, name));
  git(dir, "add", "-A");
  git(dir, ...authorEnv(p), "commit", "-q", "-m", "Initial commit");
}

/** A second checkout of somebody else's repository, on the same remote. */
function cloneRepo(p: Persona, name: string, owner: PersonaKey): void {
  const dir = repoDir(p.key, name);
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("git", ["clone", "-q", repoDir(owner, name), dir]);
  git(dir, "remote", "set-url", "origin", remoteFor(owner, name));
}

function ensureRepos(p: Persona): void {
  for (const project of p.projects) {
    if (existsSync(join(repoDir(p.key, project.name), ".git"))) continue;
    if (project.cloneOf) cloneRepo(p, project.name, project.cloneOf);
    else createRepo(p, project.name);
  }
}

/**
 * The one project that exists before anybody's agent touches it: a team's
 * shared repository is already in somebody's account when a new member joins.
 * Everything else registers itself on the persona's first get_context -- that
 * first contact is part of what the lab is measuring.
 */
async function ensureSharedLedger(owner: { id: number }, member: Persona): Promise<void> {
  const remote = remoteFor("mert", "ledger-api");
  let project = (await projectsRepo.withRepoUrl(owner.id)).find((row) => row.repo_url === remote);
  if (!project) {
    await invoke({ userId: owner.id }, "createProject", {
      name: "ledger-api",
      repo_url: remote,
      root_path: repoDir("mert", "ledger-api"),
      summary: "Double-entry ledger for the payments team.",
    });
    project = (await projectsRepo.withRepoUrl(owner.id)).find((row) => row.repo_url === remote);
  }
  if (!project) throw new Error("ledger-api was not created for mert");

  const memberUser = await usersRepo.byUsername(member.username);
  if (!memberUser) throw new Error(`${member.username} does not exist`);
  const at = new Date().toISOString();
  const pending = await invitationsRepo.listPendingForEmail(emailFor(member), at);
  let invitation = pending.find((row) => row.project_id === project.id);
  if (!invitation) {
    const sent = await invitations.invite({
      userId: owner.id,
      projectId: project.id,
      email: emailFor(member),
      lang: "tr",
    });
    // "exists" means already a member: the state we want.
    if (sent === "exists") return;
    if (sent !== "sent") throw new Error(`inviting ${member.key} to ledger-api: ${sent}`);
    invitation = (await invitationsRepo.listPendingForEmail(emailFor(member), at)).find(
      (row) => row.project_id === project.id,
    );
  }
  if (!invitation) throw new Error("the invitation to ledger-api did not appear");
  const accepted = await invitations.accept({
    userId: memberUser.id,
    email: emailFor(member),
    invitationId: invitation.id,
    emailVerified: true,
    lang: "tr",
  });
  if (!accepted) throw new Error(`${member.key} could not accept the ledger-api invitation`);
}

/**
 * The four lines `install:mcp` writes into a client's user-level memory file,
 * written where each lab agent and its stdio server will look.
 *
 * - OpenCode reads `$XDG_CONFIG_HOME/opencode/AGENTS.md`, and the lab gives it
 *   a private XDG home, so that file is exactly what an installed OpenCode
 *   reads.
 * - Claude Code runs with project settings only, so it never reads a user
 *   CLAUDE.md; `lab:run --habit` appends the same block to its prompt instead
 *   (see run.ts). Pointing it at another home would need a second login.
 * - The stdio server checks for the habit under HOME before it decides to send
 *   setup notes, so the persona's own home gets both files: an installed user
 *   would not be nagged for a habit they have.
 *
 * Written by the installer's own function, so the lab measures the text a
 * real install leaves and not a copy of it.
 */
async function writeHabit(persona: PersonaKey): Promise<void> {
  const home = join(secretsDir(persona), "home");
  await writeMemoryFile(join(openCodeHome(persona), "opencode", "AGENTS.md"));
  await writeMemoryFile(join(home, ".config", "opencode", "AGENTS.md"));
  await writeMemoryFile(join(home, ".claude", "CLAUDE.md"));
}

async function reset(): Promise<void> {
  for (const p of PERSONAS) {
    const user = await usersRepo.byUsername(p.username);
    if (user) await usersRepo.remove(user.id);
  }
  // Everything but the runs. A repeated lab resets before each repetition,
  // and the earlier runs are what the new one is compared against.
  if (!existsSync(LAB)) return;
  for (const entry of readdirSync(LAB))
    if (entry !== "runs") rmSync(join(LAB, entry), { recursive: true, force: true });
}

async function main(): Promise<void> {
  if (process.argv.includes("--reset")) await reset();
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  chmodSync(SECRETS, 0o700);

  const accounts = new Map<PersonaKey, { id: number }>();
  // Owners before clones: Ayşe's ledger-api is a clone of Mert's.
  for (const p of [...PERSONAS].sort((a, b) => Number(a.key === "ayse") - Number(b.key === "ayse"))) {
    const user = await ensureAccount(p);
    accounts.set(p.key, user);
    const token = await ensureToken(p, user.id);
    mkdirSync(secretsDir(p.key), { recursive: true, mode: 0o700 });
    writeClaudeConfig(p.key, token);
    writeOpenCodeConfig(p.key, token);
    if (process.argv.includes("--habit")) await writeHabit(p.key);
    ensureRepos(p);
  }
  const ayse = PERSONAS.find((p) => p.key === "ayse");
  const mert = accounts.get("mert");
  if (ayse && mert) await ensureSharedLedger(mert, ayse);

  for (const p of PERSONAS)
    console.log(
      `[lab] ${p.key.padEnd(5)} ${p.username.padEnd(10)} ${p.projects.map((x) => x.name).join(", ")}`,
    );
  console.log(`[lab] ready in ${LAB}; agents talk to ${LAB_URL} only`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => disconnect());
