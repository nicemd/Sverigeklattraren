import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("emits an OpenAI-compatible intake schema without unsupported uri format", async () => {
  const script = `
    import { zodTextFormat } from "openai/helpers/zod";
    import { intakeSchema } from "./lib/agents/schemas.ts";
    const json = JSON.stringify(zodTextFormat(intakeSchema, "suggestion_intake"));
    process.stdout.write(JSON.stringify({
      hasUriFormat: json.includes('"format":"uri"'),
      hasHttpPattern: json.includes("https?")
    }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url),
  });
  assert.deepEqual(JSON.parse(stdout), { hasUriFormat: false, hasHttpPattern: true });
});
