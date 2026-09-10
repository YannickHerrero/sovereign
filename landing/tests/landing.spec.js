import { test, expect } from "@playwright/test";

test("renders the product, valid local links and no horizontal overflow", async ({
  page,
}) => {
  const errors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      externalRequests.push(request.url());
  });
  await page.goto("/");
  await expect(page).toHaveTitle(/Sovereign/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Vos agents au travail.",
  );
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Installer Sovereign" }).first(),
  ).toHaveAttribute("href", "#installation");
  const invalidLinks = await page
    .locator('a[href^="#"]')
    .evaluateAll((links) =>
      links
        .filter(
          (link) => link.hash && !document.getElementById(link.hash.slice(1)),
        )
        .map((link) => link.hash),
    );
  expect(invalidLinks).toEqual([]);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const tab of await page.getByRole("tab").all()) {
      await tab.click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("feature tabs work by pointer and keyboard", async ({ page }) => {
  await page.goto("/");
  const remote = page.getByRole("tab", { name: /Pilotez à distance/ });
  const machines = page.getByRole("tab", { name: /Retrouvez vos machines/ });
  const review = page.getByRole("tab", { name: /Gardez le contrôle/ });
  await machines.click();
  await expect(machines).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveCount(1);
  await expect(page.getByRole("tabpanel")).toContainText("Plusieurs machines.");
  await machines.focus();
  await page.keyboard.press("ArrowRight");
  await expect(review).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText(
    "Gardez le dernier regard.",
  );
  await page.keyboard.press("ArrowRight");
  await expect(remote).toBeFocused();
  await page.keyboard.press("End");
  await expect(review).toBeFocused();
  await page.keyboard.press("Home");
  await expect(remote).toHaveAttribute("aria-selected", "true");
});

test("FAQ exposes the security and permission caveats", async ({ page }) => {
  await page.goto("/");
  const question = page.locator("summary", {
    hasText: "Les agents demandent-ils des permissions ?",
  });
  await question.click();
  await expect(page.locator("details[open]")).toContainText(
    "bypassPermissions",
  );
  await question.click();
  await expect(page.locator("details[open]")).toHaveCount(0);
});

test("copies the displayed installation commands", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.copiedText = text;
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Copier les commandes" }).click();
  await expect(page.getByRole("status")).toHaveText("Commandes copiées.");
  expect(await page.evaluate(() => window.copiedText)).toBe(
    await page.locator("#install-commands").textContent(),
  );
});

test("offers a manual fallback when clipboard access fails", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Permission denied");
        },
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Copier les commandes" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Sélectionnez les commandes",
  );
});
