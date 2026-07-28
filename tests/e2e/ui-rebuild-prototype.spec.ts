import { expect, test } from "@playwright/test";

test.describe("UI rebuild prototype", () => {
  test("command centre filters data and restores focus after closing an exception", async ({ page }) => {
    await page.goto("/prototype/ui-rebuild");

    await expect(
      page.getByRole("heading", {
        name: "Kondisi yang membutuhkan perhatian hari ini",
        level: 1,
      }),
    ).toBeVisible();
    await expect(page.getByText("120 lokasi sesuai filter")).toBeVisible();

    await page.getByRole("combobox", { name: "Filter provinsi" }).selectOption("Jawa Barat");
    await expect(page.getByText("18 lokasi sesuai filter")).toBeVisible();

    const exception = page.getByRole("button", {
      name: "Kritis Keselamatan 2 jam Akses material tertutup pasang laut Kampung Nelayan Bahari 001 · KNMP Paket Barat I PIC belum ditetapkan · Konfirmasi penghentian area dan keputusan mitigasi",
    });
    await exception.click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tutup detail", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(exception).toBeFocused();
  });

  test("daily report keeps the minimum viewport free of page-level overflow", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/prototype/ui-rebuild?view=report");

    await expect(
      page.getByRole("heading", { name: "Catat pekerjaan hari ini", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navigasi bawah prototype" })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  });
});
