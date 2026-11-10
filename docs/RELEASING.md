# Releasing

Distribution: **GitHub Releases only** (D-4). CI never tags or publishes
(R-2); every step that makes something public is manual and needs the owner's
explicit approval of the release candidate.

## 1. Prepare the release candidate

1. Bump the version in `package.json`, `package-lock.json` and
   `static/manifest.json` (all three must match; `npm run package` and
   `test/release.test.ts` fail otherwise). Update `CHANGELOG.md`.
2. Merge through the usual PR workflow. CI on `main` runs `check`, packages
   the ZIP, runs the browser E2E **on the unzipped ZIP**, and uploads that same
   ZIP as the workflow artifact `chatgpt-autopilot-release-zip`.
3. Locally, `npm run package` produces the same layout in
   `release/chatgpt-autopilot-<version>.zip` (no source maps).

## 2. Test the exact artifact (owner)

1. GitHub → Actions → the CI run for the release commit on `main` →
   Artifacts → download `chatgpt-autopilot-release-zip` (GitHub delivers it
   zipped; unzip once to get `chatgpt-autopilot-<version>.zip`).
2. Unzip `chatgpt-autopilot-<version>.zip` into a new folder. In
   `chrome://extensions`, remove any development copy, turn on Developer mode,
   **Load unpacked** → that folder. Reload ChatGPT tabs.
3. Run the release-candidate rows in `docs/LIVE_VALIDATION.md` ("Release
   candidate on the installed ZIP"): P-L1/P-L2 (delays below 30 s), S1–S2,
   M3-L3, and the accessibility checklist.

## 3. Publish (only after the owner approves the release candidate)

1. `git tag v<version> <release commit>` and push the tag.
2. GitHub → Releases → *Draft a new release* for that tag; attach **the same
   ZIP that was tested** (from the artifact, not a rebuild); paste the
   `CHANGELOG.md` section as release notes.
3. Record the release in `AUTOPILOT.md`.
