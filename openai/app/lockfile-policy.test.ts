import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lockfile = readFileSync(
  new URL("../pnpm-lock.yaml", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../pnpm-workspace.yaml", import.meta.url),
  "utf8",
);

test("keeps the standalone lockfile behind the release-age window", () => {
  assert.match(workspace, /^minimumReleaseAge: 1440$/m);
  assert.doesNotMatch(lockfile, /js-yaml@4\.3\.2/);
  assert.doesNotMatch(lockfile, /node-releases@2\.0\.54/);
});
