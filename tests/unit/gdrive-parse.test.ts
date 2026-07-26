import { describe, expect, it } from "vitest";
import {
  GDRIVE_REDIRECT_PATH,
  buildMultipartBody,
  driveRedirectUri,
  parseDriveFolderId,
  publicOrigin,
} from "@/lib/gdrive/parse";

/** Integrasi Google Drive — util murni. DECISIONS 141. */

describe("parseDriveFolderId", () => {
  const ID = "1AbC_dEfGhIjKlMnOpQrStUvWxYz12345";

  it("menerima ID mentah", () => {
    expect(parseDriveFolderId(ID)).toBe(ID);
    expect(parseDriveFolderId(`  ${ID}  `)).toBe(ID);
  });

  it("menerima berbagai bentuk URL folder Drive", () => {
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${ID}`)).toBe(ID);
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)).toBe(ID);
    expect(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${ID}`)).toBe(ID);
    expect(parseDriveFolderId(`https://drive.google.com/open?id=${ID}`)).toBe(ID);
  });

  it("menolak input yang bukan folder Drive", () => {
    expect(parseDriveFolderId("")).toBeNull();
    expect(parseDriveFolderId("bukan id")).toBeNull();
    expect(parseDriveFolderId("pendek123")).toBeNull();
    expect(parseDriveFolderId("https://example.com/drive/folders/abc123def456ghi")).toBeNull();
    expect(parseDriveFolderId("https://drive.google.com/file/d/xyz/view")).toBeNull();
  });

  it("URL docs.google.com dengan ?id= tetap dikenali (subdomain google.com)", () => {
    expect(parseDriveFolderId(`https://docs.google.com/open?id=${ID}`)).toBe(ID);
  });
});

describe("buildMultipartBody", () => {
  it("menyusun multipart/related: metadata JSON + isi + boundary penutup", () => {
    const data = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
    const { body, contentType } = buildMultipartBody({ name: "a.pdf", parents: ["F1"] }, "application/pdf", data);
    const text = body.toString("latin1");
    expect(contentType).toMatch(/^multipart\/related; boundary=/);
    expect(text).toContain('{"name":"a.pdf","parents":["F1"]}');
    expect(text).toContain("Content-Type: application/pdf");
    expect(text).toContain("%PDF");
    expect(text.trimEnd().endsWith("--")).toBe(true);
  });

  it("isi biner tidak rusak (byte-for-byte)", () => {
    const data = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const { body } = buildMultipartBody({ name: "b.bin" }, "application/octet-stream", data);
    expect(body.includes(data)).toBe(true);
  });
});

describe("publicOrigin & driveRedirectUri", () => {
  it("env eksplisit APP_PUBLIC_URL menang atas header apa pun", () => {
    expect(
      publicOrigin({ envUrl: "https://marlin.co.id", railwayDomain: "x.up.railway.app", host: "0.0.0.0:8080" }),
    ).toBe("https://marlin.co.id");
    // URL dengan garis miring di akhir tetap dinormalisasi.
    expect(publicOrigin({ envUrl: "https://marlin.co.id/" })).toBe("https://marlin.co.id");
    // Host polos tanpa skema juga diterima.
    expect(publicOrigin({ envUrl: "marlin.co.id" })).toBe("https://marlin.co.id");
  });

  it("RAILWAY_PUBLIC_DOMAIN dipakai bila env eksplisit kosong", () => {
    expect(publicOrigin({ railwayDomain: "marlin.up.railway.app", host: "0.0.0.0:8080" })).toBe(
      "https://marlin.up.railway.app",
    );
  });

  it("alamat bind container DITOLAK — ini penyebab redirect_uri https://0.0.0.0:8080", () => {
    expect(publicOrigin({ host: "0.0.0.0:8080" })).toBeNull();
    expect(publicOrigin({ host: "[::]:8080" })).toBeNull();
    expect(publicOrigin({ host: "marlin.railway.internal" })).toBeNull();
    // Bind address diabaikan, lanjut ke sumber berikutnya yang sah.
    expect(publicOrigin({ forwardedHost: "0.0.0.0:8080", host: "marlin.co.id" })).toBe("https://marlin.co.id");
  });

  it("memaksa https untuk domain publik (proxy meneruskan http internal)", () => {
    expect(publicOrigin({ host: "marlin.up.railway.app", forwardedProto: "http" })).toBe(
      "https://marlin.up.railway.app",
    );
    expect(publicOrigin({ forwardedHost: "marlin.up.railway.app", host: "internal:8080", forwardedProto: "http" })).toBe(
      "https://marlin.up.railway.app",
    );
  });

  it("host lokal tetap boleh http (dev)", () => {
    expect(publicOrigin({ host: "localhost:3000", forwardedProto: "http" })).toBe("http://localhost:3000");
    expect(publicOrigin({ host: "127.0.0.1:3000" })).toBe("http://127.0.0.1:3000");
  });

  it("daftar berkoma diambil yang pertama", () => {
    expect(publicOrigin({ forwardedHost: "a.example.com, b.example.com", forwardedProto: "http" })).toBe(
      "https://a.example.com",
    );
  });

  it("tanpa sumber sama sekali → null (jangan menebak)", () => {
    expect(publicOrigin({})).toBeNull();
    expect(driveRedirectUri({})).toBeNull();
  });

  it("redirect URI memakai path callback yang sama persis", () => {
    expect(driveRedirectUri({ host: "marlin.up.railway.app", forwardedProto: "http" })).toBe(
      `https://marlin.up.railway.app${GDRIVE_REDIRECT_PATH}`,
    );
    expect(GDRIVE_REDIRECT_PATH).toBe("/api/gdrive/callback");
  });
});
