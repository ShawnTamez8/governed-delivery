# The one image BuildWorks runs a run's commands in
# (docs/features/sandboxed-implementer/plan.md; promoted unchanged from the
# spike's scripts/sandbox-spike/Dockerfile). Node and npm come from the base
# image, pinned by digest; Git is the only addition, installed without a
# version, so two builds can differ and the frozen image ID is the toolchain's
# identity. It holds no Claude Code: the model runs on the host.
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*
