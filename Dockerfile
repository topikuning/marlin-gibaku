# MARLIN — multi-stage build untuk Railway (builder: DOCKERFILE, bukan Nixpacks)
# Debian slim (bukan alpine): Prisma engine compat, OpenSSL, sharp/libvips.

# ── base ─────────────────────────────────────────────────────
FROM node:24.18.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ── dependencies ─────────────────────────────────────────────
FROM base AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder ──────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# Prisma 7 generate tidak butuh koneksi DB; build Next standalone.
# Placeholder env agar validasi zod build-time lolos; nilai riil dari Railway saat runtime.
RUN pnpm prisma generate && \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    SESSION_SECRET="build-placeholder-secret-0123456789abcdef" \
    APP_ENV="production" \
    pnpm next build

# ── runner ───────────────────────────────────────────────────
FROM node:24.18.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# tini = PID 1 (signal handling SIGTERM), ca-certificates + openssl utk TLS (R2/Postgres).
# fontconfig + fonts-dejavu-core = cadangan agar cap teks foto (sharp/librsvg) tetap
# ter-render walau config font runtime gagal (aplikasi tetap membawa font sendiri).
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini ca-certificates openssl fontconfig fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

# Prisma CLI global (pinned) untuk preDeploy `prisma migrate deploy` di Railway.
# Telemetri/update-check dimatikan: pre-deploy tidak boleh bergantung network keluar.
RUN npm install -g prisma@7.8.0 && npm cache clean --force
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
ENV CHECKPOINT_DISABLE=1

# Non-root user (dengan home dir — cache/config CLI butuh $HOME yang valid)
RUN groupadd --gid 1001 marlin && useradd --uid 1001 --gid marlin --create-home --shell /usr/sbin/nologin marlin
ENV HOME=/home/marlin

# Standalone output: server + node_modules minimal yang dibutuhkan runtime.
# sharp + @img (termasuk libvips-cpp.so) kini ikut LENGKAP lewat
# outputFileTracingIncludes di next.config — tracer tak bisa melihat dependensi
# dlopen native, jadi harus di-include eksplisit. Hack /opt/sharp lama dihapus.
COPY --from=builder --chown=marlin:marlin /app/.next/standalone ./
# Verifikasi saat BUILD: sharp harus bisa dimuat & MEMPROSES gambar dari tree
# standalone ini (resolusi yang sama dgn runtime). Gagal → build gagal di sini,
# bukan diam-diam gagal di runtime ("foto tanpa cap").
RUN node -e "require('sharp')({create:{width:8,height:8,channels:3,background:'#000'}}).webp().toBuffer().then(b=>console.log('sharp OK di standalone,',b.length,'bytes'))"
COPY --from=builder --chown=marlin:marlin /app/.next/static ./.next/static
COPY --from=builder --chown=marlin:marlin /app/public ./public
COPY --from=builder --chown=marlin:marlin /app/assets ./assets
# Schema + migrations + config untuk migrate deploy
COPY --from=builder --chown=marlin:marlin /app/prisma ./prisma
COPY --from=builder --chown=marlin:marlin /app/prisma.config.js ./prisma.config.js
# Data demo untuk BOOTSTRAP_DEMO_DATA=true (deployment uji coba)
COPY --from=builder --chown=marlin:marlin /app/seed-data ./seed-data

USER marlin
EXPOSE 3000
# Railway menyuntik $PORT; Next standalone membaca PORT env.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
