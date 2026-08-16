# todox, as one container beside its database.
#
# Deliberately NOT a `output: "standalone"` build. Standalone produces a much
# smaller image by pruning node_modules to what the server imports at runtime,
# and that prunes away `tsx` and everything under `scripts/` -- which is where
# `db:migrate` and `seed` live. The database is not reachable from the internet
# once this moves, by design, so migrations have to run from the server, which
# means they have to run from this image. A few hundred megabytes on a host
# with 187 GB free is the cheaper side of that trade.

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
# Lockfile first, so a change to application code does not re-resolve every
# dependency. `--frozen-lockfile` makes a stale lockfile a build failure rather
# than a silently different dependency tree.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Nothing queries the database at build time -- every page is force-dynamic --
# which is what lets this build without a connection string.
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production
# Next binds to localhost by default, which inside a container means nothing
# outside it can connect.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# The whole tree, dev dependencies included: see the note at the top. `node` is
# a non-root user the base image already provides.
COPY --from=build --chown=node:node /app /app
# Next's build cache: ~70 MB that only speeds up the *next* build, and this
# image will never run one. It is regenerated in the build stage every time.
RUN rm -rf /app/.next/cache
USER node

EXPOSE 3000

# Answers only once the server is actually serving, so a deploy that boots and
# then fails to start is not reported as healthy.
#
# This fetched /login, which renders a React page and touches nothing else --
# so a container whose database was unreachable reported itself healthy for as
# long as it kept serving HTML, which is exactly the window where a restart or
# a held deploy would have helped. /api/health takes a connection from the pool
# and round-trips a statement, and answers 503 when it cannot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are not run here. Applying DDL is a decision, and the schema is
# idempotent precisely so it can be made after a deploy rather than during one:
#   docker exec <container> pnpm db:migrate
CMD ["pnpm", "start"]
