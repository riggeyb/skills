import assert from "node:assert/strict";
import test from "node:test";
import { SecretRedactor } from "../src/redaction.js";

test("secret redactor reference counts raw and encoded variants", () => {
  const redactor = new SecretRedactor();
  const secret = "sentient-private-beta-secret";
  const encoded = Buffer.from(secret).toString("base64");

  redactor.register(secret);
  redactor.register(secret);
  redactor.unregister(secret);

  assert.equal(redactor.redact(`raw=${secret}`), "raw=[REDACTED]");
  assert.equal(redactor.redact(`encoded=${encoded}`), "encoded=[REDACTED]");

  redactor.unregister(secret);
  assert.equal(redactor.redact(secret), secret);
  assert.equal(
    redactor.redact("github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"),
    "[REDACTED]",
  );
});
