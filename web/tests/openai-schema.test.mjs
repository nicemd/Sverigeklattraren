import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("emits an OpenAI-compatible intake schema without unsupported uri format", async () => {
  const script = `
    import { zodTextFormat } from "openai/helpers/zod";
    import { editSchema, intakeSchema } from "./lib/agents/schemas.ts";
    const json = JSON.stringify([zodTextFormat(intakeSchema, "suggestion_intake"), zodTextFormat(editSchema, "editorial_change")]);
    process.stdout.write(JSON.stringify({
      hasUriFormat: json.includes('"format":"uri"'),
      hasHttpPattern: json.includes("https?"),
      hasSourceId: json.includes('"sourceId"')
    }));
  `;
  const { stdout } = await execFileAsync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: new URL("..", import.meta.url),
  });
  assert.deepEqual(JSON.parse(stdout), { hasUriFormat: false, hasHttpPattern: true, hasSourceId: true });
});
