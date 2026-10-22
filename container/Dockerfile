# The one image BuildWorks runs a run's commands in
# (docs/features/sandboxed-implementer/plan.md; promoted unchanged from the
# spike's scripts/sandbox-spike/Dockerfile). Node and npm come from the base
# image, pinned by digest; Git is installed without a version, so two builds
# can differ and the frozen image ID is the toolchain's identity. It holds no
# Claude Code: the model runs on the host.
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
# The system's acceptance runner (docs/features/protected-acceptance-tests/plan.md,
# Task 1 spike record): Playwright and its Chromium under /opt/bw-browser, run
# only by the system's own command with the config below. A suite imports the
# runner through BW_PLAYWRIGHT_TEST, an absolute path, because a bare
# "@playwright/test" import resolves only from a package planted in the worktree.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/bw-browser/browsers \
    BW_PLAYWRIGHT_TEST=/opt/bw-browser/node_modules/@playwright/test/index.mjs
RUN npm install --prefix /opt/bw-browser @playwright/test@1.64.1 \
 && cd /opt/bw-browser && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /opt/bw-browser
COPY acceptance.config.mjs /opt/bw-browser/acceptance.config.mjs
# The reproduction runner (docs/features/reproduced-review-findings/plan.md):
# the same config with testDir /bw-checks, where reviewer reproductions mount.
COPY checks.config.mjs /opt/bw-browser/checks.config.mjs
