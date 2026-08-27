import { describe, expect, it } from "vitest";
import { conversationContextBlock } from "@/lib/ai/conversation";

describe("conversationContextBlock", () => {
  it("mempertahankan urutan dan membatasi jumlah giliran", () => {
    const block = conversationContextBlock(
      [
        { role: "user", content: "progress hari ini" },
        { role: "assistant", content: "Kedung Mutih 42%." },
        { role: "user", content: "kalau kemarin?" },
      ],
      { maxTurns: 2 },
    );
    expect(block).not.toContain("progress hari ini");
    expect(block).toContain("MARLIN: Kedung Mutih 42%.");
    expect(block).toContain("Penanya: kalau kemarin?");
  });

  it("kosong bila tidak ada riwayat", () => {
    expect(conversationContextBlock([])).toBe("");
  });
});
