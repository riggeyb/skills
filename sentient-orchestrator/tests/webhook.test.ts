import assert from "node:assert/strict";
import test from "node:test";
import { extractSentientCommand, verifyGitHubSignature } from "../src/webhook.js";
import { createHmac } from "node:crypto";

test("extracts @sentient command", () => {
  assert.equal(extractSentientCommand("@sentient build this feature"), "build this feature");
  assert.equal(extractSentientCommand("hello"), null);
});

test("verifies GitHub SHA-256 signature", () => {
  const body = JSON.stringify({ hello: "world" });
  const secret = "test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyGitHubSignature(body, signature, secret), true);
  assert.equal(verifyGitHubSignature(body, "sha256=bad", secret), false);
});
