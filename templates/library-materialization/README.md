# Sentient library materialization template

Install `workflow.yml` as `.github/workflows/sentient-library-materialization.yml` in a target repository.

Sentient creates a request under `.sentient/library-requests/<id>.json`. The push-triggered repository workflow fetches source bytes from an exact public GitHub commit, verifies the expected Git blob SHA, enforces the destination precondition, writes exact bytes, records provenance in `.sentient/library-lock.json` by default, consumes the request, and commits the result.

This is the fallback when the conversational Custom Action has repository read/write primitives but no server-side cross-repository copy endpoint. It keeps source-byte Base64 reconstruction out of the model.

The v1 transport supports public source repositories. Private cross-repository sources require an explicitly configured least-privilege credential.

A successful materialization commit is not integration certification. Reread the destination at the resulting exact SHA and run the target repository's relevant verification.
