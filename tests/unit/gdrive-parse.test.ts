import { describe, expect, it } from "vitest";
import { buildMultipartBody, parseDriveFolderId } from "@/lib/gdrive/parse";

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
