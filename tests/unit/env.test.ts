import { describe, expect, it, vi } from "vitest";

// PENTING: import "@/lib/env" mengeksekusi loadEnv() saat load module.
// Set env minimal DULU (stubEnv), baru dynamic import (top-level await, ESM).
vi.stubEnv("APP_ENV", "test");
vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/marlin_test");
vi.stubEnv("SESSION_SECRET", "s".repeat(48));
// Pastikan tidak ada konfigurasi R2 parsial yang bocor dari environment luar.
vi.stubEnv("R2_ENDPOINT", "");
vi.stubEnv("R2_BUCKET", "");
vi.stubEnv("R2_ACCESS_KEY_ID", "");
vi.stubEnv("R2_SECRET_ACCESS_KEY", "");

const { normalizeR2Endpoint, EnvError, env } = await import("@/lib/env");

describe("normalizeR2Endpoint", () => {
  it("trim whitespace + trailing slash", () => {
    expect(normalizeR2Endpoint("  abc123.r2.cloudflarestorage.com/  ")).toBe(
      "https://abc123.r2.cloudflarestorage.com",
    );
  });

  it("tambah https bila tanpa protokol", () => {
    expect(normalizeR2Endpoint("abc123.r2.cloudflarestorage.com")).toBe(
      "https://abc123.r2.cloudflarestorage.com",
    );
  });

  it("https eksplisit dipertahankan", () => {
    expect(normalizeR2Endpoint("https://abc123.r2.cloudflarestorage.com")).toBe(
      "https://abc123.r2.cloudflarestorage.com",
    );
  });

  it("tolak http (wajib TLS)", () => {
    expect(() => normalizeR2Endpoint("http://abc123.r2.cloudflarestorage.com")).toThrow(EnvError);
  });

  it("tolak domain r2.dev (domain publik, bukan endpoint S3)", () => {
    expect(() => normalizeR2Endpoint("https://pub-xyz.r2.dev")).toThrow(EnvError);
    expect(() => normalizeR2Endpoint("r2.dev")).toThrow(EnvError);
  });

  it("tolak protokol ganda", () => {
    expect(() => normalizeR2Endpoint("https://https://abc.r2.cloudflarestorage.com")).toThrow(
      EnvError,
    );
  });

  it("tolak path (bucket diatur terpisah)", () => {
    expect(() =>
      normalizeR2Endpoint("https://abc123.r2.cloudflarestorage.com/bucket"),
    ).toThrow(EnvError);
  });

  it("tolak string bukan URL", () => {
    expect(() => normalizeR2Endpoint("bukan url ada spasi")).toThrow(EnvError);
  });
});

describe("loadEnv (via import)", () => {
  it("env terisi dari process.env, R2 kosong → null", () => {
    expect(env.APP_ENV).toBe("test");
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(env.r2).toBeNull();
  });
});
