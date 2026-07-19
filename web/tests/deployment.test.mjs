import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");

test("serves atomically published content independently of the source snapshot", async () => {
  const [compose, contentModule, publisher] = await Promise.all([
    readFile(path.join(root, "docker-compose.yml"), "utf8"),
    readFile(path.join(process.cwd(), "lib", "content.ts"), "utf8"),
    readFile(path.join(root, "scripts", "publish-main.sh"), "utf8"),
  ]);

  assert.match(compose, /CONTENT_ROOT: \/published\/current\/content/);
  assert.match(compose, /\.\/published:\/published:ro/);
  assert.match(contentModule, /process\.env\.CONTENT_ROOT/);
  assert.match(publisher, /git archive "\$target_sha" content/);
  assert.match(publisher, /mv -Tf "\$next_link" "\$current_link"/);
});

test("builds Docker images only for application changes", async () => {
  const [workflow, proposalWorkflow, publisher] = await Promise.all([
    readFile(path.join(root, ".github", "workflows", "deploy.yml"), "utf8"),
    readFile(path.join(root, ".github", "workflows", "proposal.yml"), "utf8"),
    readFile(path.join(root, "scripts", "publish-main.sh"), "utf8"),
  ]);

  assert.match(workflow, /paths:\s+[\s\S]*"web\/\*\*"/);
  assert.doesNotMatch(workflow, /DAVTOR1_SSH_KEY|ssh -i/);
  assert.doesNotMatch(proposalWorkflow, /gh workflow run deploy\.yml/);
  assert.match(publisher, /web\/tests\/\*\)\s+;;\s+web\/\*\|Dockerfile/);
  assert.match(publisher, /web\/\*\|Dockerfile\|docker-compose\.yml\|\.dockerignore/);
  assert.match(publisher, /if \[\[ "\$app_changed" == true \]\]; then\s+if ! sudo docker pull/);
});

test("poll publisher keeps rollback and clean-tree guards", async () => {
  const publisher = await readFile(path.join(root, "scripts", "publish-main.sh"), "utf8");
  assert.match(publisher, /git status --porcelain/);
  assert.match(publisher, /git merge --ff-only/);
  assert.match(publisher, /rollback_app/);
  assert.match(publisher, /flock -n/);
});
