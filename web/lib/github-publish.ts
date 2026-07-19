import "server-only";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type ProposalFile = { path: string; content: string };

const gitIdentity = {
  GIT_AUTHOR_NAME: "Sverigeklättraren agent",
  GIT_AUTHOR_EMAIL: "agent@sverigeklattraren.local",
  GIT_COMMITTER_NAME: "Sverigeklättraren agent",
  GIT_COMMITTER_EMAIL: "agent@sverigeklattraren.local",
};

function runGit(args: string[], cwd: string, env: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, { cwd, env: { ...process.env, ...gitIdentity, ...env } });
    let stderr = "";
    const timeout = setTimeout(() => child.kill(), 90_000);
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timeout); if (code === 0) { resolve(); return; } reject(new Error(stderr.trim() || (signal ? `git timed out (${signal})` : `git exited ${code}`))); });
  });
}

function repositoryName() {
  const value = process.env.GITHUB_REPOSITORY || "nicemd/Sverigeklattraren";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error("GITHUB_REPOSITORY har ogiltigt format.");
  return value;
}

function safeBranchPart(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 45) || "forslag";
}

function safeRepositoryPath(value: string) {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error(`Ogiltig sökväg i förslaget: ${value}`);
  return normalized;
}

async function findPullRequest(repository: string, branch: string) {
  const [owner] = repository.split("/");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`https://api.github.com/repos/${repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Sverigeklattraren-agent" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const pulls = await response.json() as Array<{ html_url?: string; number?: number }>;
      if (pulls[0]?.html_url) return { url: pulls[0].html_url, number: pulls[0].number || null };
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return { url: null, number: null };
}

export async function pushProposalBranch(areaSlug: string, stamp: string, commitMessage: string, files: ProposalFile[]) {
  const repository = repositoryName();
  const keyPath = process.env.GITHUB_PROPOSAL_KEY_PATH || "/run/secrets/github-proposal-key";
  await access(keyPath).catch(() => { throw new Error("GitHub-nyckeln för ändringsförslag är inte konfigurerad."); });
  const branch = `proposal/${safeBranchPart(areaSlug)}-${stamp.replace(/[^0-9TZ-]/g, "-").toLowerCase()}`;
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "sverigeklattraren-proposal-"));
  const checkout = path.join(temporaryRoot, "repository");
  const sshKey = keyPath.replaceAll("\\", "/").replaceAll('"', '\\"');
  const gitEnv = { GIT_SSH_COMMAND: `ssh -i "${sshKey}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/github-known-hosts` };
  try {
    await runGit(["clone", "--depth", "1", "--branch", "main", `git@github.com:${repository}.git`, checkout], temporaryRoot, gitEnv);
    await runGit(["checkout", "-b", branch], checkout, gitEnv);
    for (const file of files) {
      const relative = safeRepositoryPath(file.path);
      const destination = path.join(checkout, ...relative.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, file.content, "utf8");
    }
    await runGit(["add", "--", ...files.map((file) => safeRepositoryPath(file.path))], checkout, gitEnv);
    await runGit(["commit", "-m", commitMessage], checkout, gitEnv);
    await runGit(["push", "--set-upstream", "origin", branch], checkout, gitEnv);
    const pullRequest = await findPullRequest(repository, branch);
    return {
      branch,
      branchUrl: `https://github.com/${repository}/tree/${encodeURIComponent(branch)}`,
      pullRequestUrl: pullRequest.url,
      pullRequestNumber: pullRequest.number,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
