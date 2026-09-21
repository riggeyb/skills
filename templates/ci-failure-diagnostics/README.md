# CI Failure Diagnostic Publication

This template makes a failing CI diagnosis repository-readable without requiring a client to download job logs or artifact ZIPs.

Use the reusable workflow from a caller job that runs after the test/build job and is gated with `if: ${{ failure() }}`. The caller should pass the exact tested source SHA, a normalized failure fingerprint, the failing workflow/job/step identity, a bounded actionable summary, and any artifact or screenshot hash that helps bind richer evidence.

The template publishes only bounded JSON and its SHA-256 checksum to a dedicated evidence branch. It does not copy screenshots or arbitrary logs into Git history. Those remain artifacts. The diagnostic path is immutable and keyed by source SHA, run ID/attempt, and fingerprint.

For pull requests from forks or other untrusted code, do not switch to `pull_request_target` merely to obtain write permissions. Keep untrusted execution separated from privileged publication; if the token cannot safely write the evidence branch, retain the diagnostic as an artifact or use a separately reviewed publication design.

A typical caller shape is:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: ./scripts/test.sh

  publish-failure:
    needs: test
    if: ${{ failure() }}
    uses: ./.github/workflows/publish-ci-failure-diagnostic.yml
    permissions:
      contents: write
    with:
      source_sha: ${{ github.sha }}
      failure_fingerprint: "browser:undo-button-not-visible"
      workflow_name: "CI"
      job_name: "test"
      error_class: "assertion"
      summary: "Undo button was not visible within the bounded browser wait."
```

The caller is responsible for deriving the failure fingerprint and summary from trustworthy test output. Do not invent a diagnosis from a job name alone.
