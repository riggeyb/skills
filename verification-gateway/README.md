# Verification Gateway

A narrow API that lets a Custom GPT request repository-owned verification without receiving a GitHub token or arbitrary remote shell.

## Security boundary

The gateway requires three secrets and one allowlist:

- `VERIFICATION_API_KEY` — sent by the Custom GPT Action as `X-Verification-Key`.
- `VERIFICATION_SIGNING_SECRET` — signs opaque stateless run IDs.
- `GITHUB_TOKEN` — server-side fine-grained token able to dispatch Actions and read runs/artifacts for allowlisted repositories.
- `VERIFICATION_ALLOWED_REPOS` — comma-separated exact `owner/repo` allowlist.

Never expose `GITHUB_TOKEN` or `VERIFICATION_SIGNING_SECRET` to the GPT.

## Repository contract

An allowlisted target repository must contain:

- `.github/workflows/gpt-verify.yml` on its default branch.
- `.gpt/verification.yaml` at the exact commit being tested.

The workflow must use `run-name: gpt-verify:${{ github.event.client_payload.verification_id }}` and checkout `github.event.client_payload.sha` exactly.

Use the template at `verification/templates/gpt-verify.yml` and the central composite action at `verification/action`.

## API

- `GET /api/capabilities`
- `POST /api/runs`
- `GET /api/run?id=<signed-run-id>`
- `GET /api/evidence?id=<signed-run-id>`

`POST /api/runs` body:

```json
{
  "repository": "owner/repo",
  "sha": "40-char commit sha",
  "branch": "main",
  "profile": "full",
  "requireExactHead": true
}
```

Certification requires all of:

1. the discovered Actions run succeeded;
2. the Actions run reports the requested exact SHA;
3. when exact-head certification is requested, the named remote branch still points to that SHA.

A green run on an older SHA is never reported as certified.
