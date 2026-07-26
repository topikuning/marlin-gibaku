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
  it("memaksa https untuk domain publik (proxy Railway meneruskan http internal)", () => {
    // Ini penyebab nyata error Google 400 invalid_request sebelum diperbaiki.
    expect(publicOrigin(null, "marlin.up.railway.app", "http")).toBe("https://marlin.up.railway.app");
    expect(publicOrigin("marlin.up.railway.app", "internal:8080", "http")).toBe("https://marlin.up.railway.app");
    expect(publicOrigin(null, "marlin.co.id", null)).toBe("https://marlin.co.id");
  });

  it("host lokal tetap boleh http (dev)", () => {
    expect(publicOrigin(null, "localhost:3000", "http")).toBe("http://localhost:3000");
    expect(publicOrigin(null, "127.0.0.1:3000", null)).toBe("http://127.0.0.1:3000");
  });

  it("x-forwarded-host menang atas host, dan daftar koma diambil yang pertama", () => {
    expect(publicOrigin("a.example.com, b.example.com", "internal", "http")).toBe("https://a.example.com");
  });

  it("tanpa host sama sekali → null (jangan menebak)", () => {
    expect(publicOrigin(null, null, "https")).toBeNull();
    expect(driveRedirectUri(null, null, null)).toBeNull();
  });

  it("redirect URI memakai path callback yang sama persis", () => {
    expect(driveRedirectUri(null, "marlin.up.railway.app", "http")).toBe(
      `https://marlin.up.railway.app${GDRIVE_REDIRECT_PATH}`,
    );
    expect(GDRIVE_REDIRECT_PATH).toBe("/api/gdrive/callback");
  });
});
