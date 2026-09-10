import { test, expect } from "@playwright/test";

const origin = "https://sovereign-landing-chi.vercel.app";
const locales = [
  {
    lang: "en",
    path: "/",
    otherPath: "/fr/",
    otherName: "Français",
    suffix: "-en",
    title: "Sovereign — Your agents at work. You, anywhere.",
    hero: "Your agents at work.",
    install: "Install Sovereign",
    enlarge: /Enlarge/,
    tabs: ["Work from anywhere", "Connect your machines", "Stay in control"],
    machines: "Multiple machines.",
    review: "Keep the final say.",
    positioning: /harness-agnostic/,
    available: "Available today",
    agents: "Which coding agents can I use?",
    supported: "pi and Claude Code are supported today",
    planned: "Codex and OpenCode are planned, but not yet available",
    permissions: "Do agents ask for permission?",
    copy: "Copy installation commands",
    copied: "Commands copied.",
    fallback: "Select the commands",
    ogLocale: "en_GB",
    otherOgLocale: "fr_FR",
  },
  {
    lang: "fr",
    path: "/fr/",
    otherPath: "/",
    otherName: "English",
    suffix: "",
    title: "Sovereign — Vos agents au travail. Vous, où vous voulez.",
    hero: "Vos agents au travail.",
    install: "Installer Sovereign",
    enlarge: /Agrandir/,
    tabs: [
      "Pilotez à distance",
      "Retrouvez vos machines",
      "Gardez le contrôle",
    ],
    machines: "Plusieurs machines.",
    review: "Gardez le dernier regard.",
    positioning: /indépendante du harness/,
    available: "Disponibles aujourd’hui",
    agents: "Quels agents puis-je utiliser ?",
    supported: "pi et Claude Code sont pris en charge",
    planned: "Codex et OpenCode sont prévus, mais pas encore disponibles",
    permissions: "Les agents demandent-ils des permissions ?",
    copy: "Copier les commandes d’installation",
    copied: "Commandes copiées.",
    fallback: "Sélectionnez les commandes",
    ogLocale: "fr_FR",
    otherOgLocale: "en_GB",
  },
];

for (const locale of locales) {
  test.describe(locale.lang, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(locale.path);
    });

    test("renders the product, GitHub links and no horizontal overflow", async ({
      page,
    }) => {
      await expect(page).toHaveTitle(locale.title);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        locale.hero,
      );
      await expect(page.getByRole("main")).toHaveCount(1);
      for (const area of [
        page.getByRole("banner"),
        page.getByRole("contentinfo"),
      ]) {
        await expect(
          area.getByRole("link", { name: "GitHub" }),
        ).toHaveAttribute(
          "href",
          "https://github.com/YannickHerrero/sovereign",
        );
      }
      await expect(
        page.getByRole("link", { name: locale.install }).first(),
      ).toHaveAttribute("href", "#installation");
      await expect(
        page.locator(".installation .section-heading a"),
      ).toHaveAttribute(
        "href",
        "https://github.com/YannickHerrero/sovereign#build-and-installation",
      );
      const invalidLinks = await page
        .locator('a[href^="#"]')
        .evaluateAll((links) =>
          links
            .filter(
              (link) =>
                link.hash && !document.getElementById(link.hash.slice(1)),
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
        // The language selector stays visible, including on a small phone.
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator(".language-switch")).toBeInViewport();
        const overlaps = await page.evaluate(() => {
          const brand = document
            .querySelector(".header .brand")
            .getBoundingClientRect();
          const actions = document
            .querySelector(".header-actions")
            .getBoundingClientRect();
          return brand.right > actions.left && brand.bottom > actions.top;
        });
        expect(overlaps).toBe(false);
      }
    });

    test("loads local, localized captures without resource or runtime errors", async ({
      page,
    }) => {
      const failures = [];
      page.on("pageerror", (error) => failures.push(error.message));
      page.on("response", (response) => {
        if (response.status() >= 400) failures.push(response.url());
      });
      page.on("request", (request) => {
        if (new URL(request.url()).hostname !== "127.0.0.1")
          failures.push(request.url());
      });
      await page.reload();
      const hero = page.locator(".product-preview img");
      for (const [width, name] of [
        [390, "mobile-conversation"],
        [1440, "desktop-conversation"],
      ]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() => hero.evaluate((img) => img.currentSrc))
          .toContain(`${name}${locale.suffix}.png`);
        await expect
          .poll(() =>
            hero.evaluate((img) => img.complete && img.naturalWidth > 0),
          )
          .toBe(true);
      }
      for (const tab of await page.getByRole("tab").all()) {
        await tab.click();
        const image = page.getByRole("tabpanel").locator("img");
        await image.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            image.evaluate((img) => img.complete && img.naturalWidth > 0),
          )
          .toBe(true);
        const link = page
          .getByRole("tabpanel")
          .getByRole("link", { name: locale.enlarge });
        await expect(link).toHaveAttribute(
          "href",
          await image.getAttribute("src"),
        );
        await expect(link).toHaveAttribute("target", "_blank");
      }
      expect(failures).toEqual([]);
    });

    test("tabs work by pointer and keyboard", async ({ page }) => {
      const [remote, machines, review] = locale.tabs.map((name) =>
        page.getByRole("tab", { name: new RegExp(name) }),
      );
      await machines.click();
      await expect(machines).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("tabpanel")).toHaveCount(1);
      await expect(page.getByRole("tabpanel")).toContainText(locale.machines);
      await machines.focus();
      await page.keyboard.press("ArrowRight");
      await expect(review).toBeFocused();
      await expect(page.getByRole("tabpanel")).toContainText(locale.review);
      await page.keyboard.press("ArrowRight");
      await expect(remote).toBeFocused();
      await page.keyboard.press("End");
      await expect(review).toBeFocused();
      await page.keyboard.press("Home");
      await expect(remote).toHaveAttribute("aria-selected", "true");
    });

    test("separates available harnesses from the roadmap", async ({ page }) => {
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        locale.positioning,
      );
      await expect(page.locator(".compatibility")).toContainText(
        locale.available,
      );
      for (const name of ["pi", "Claude Code"])
        await expect(page.locator(".compatibility")).toContainText(name);
      for (const name of ["Codex", "OpenCode"])
        await expect(page.locator(".compatibility")).not.toContainText(name);
      await page.locator("summary", { hasText: locale.agents }).click();
      await expect(page.locator("details[open]")).toContainText(
        locale.supported,
      );
      await expect(page.locator("details[open]")).toContainText(locale.planned);
    });

    test("FAQ retains the permission caveat", async ({ page }) => {
      const question = page.locator("summary", { hasText: locale.permissions });
      await question.click();
      await expect(page.locator("details[open]")).toContainText(
        "bypassPermissions",
      );
      await question.click();
      await expect(page.locator("details[open]")).toHaveCount(0);
    });

    test("copies the displayed commands with a localized confirmation", async ({
      page,
    }) => {
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText: async (text) => {
              window.copiedText = text;
            },
          },
          configurable: true,
        }),
      );
      await page.getByRole("button", { name: locale.copy }).click();
      await expect(page.getByRole("status")).toHaveText(locale.copied);
      expect(await page.evaluate(() => window.copiedText)).toBe(
        await page.locator("#install-commands").textContent(),
      );
    });

    test("offers a localized clipboard fallback", async ({ page }) => {
      await page.evaluate(() =>
        Object.defineProperty(navigator, "clipboard", {
          value: {
            writeText: async () => {
              throw new Error("Permission denied");
            },
          },
          configurable: true,
        }),
      );
      await page.getByRole("button", { name: locale.copy }).click();
      await expect(page.getByRole("status")).toContainText(locale.fallback);
    });

    test("serves localized SEO metadata and reciprocal language links", async ({
      page,
      request,
    }) => {
      const response = await request.get(locale.path);
      expect(response.status()).toBe(200);
      const html = await response.text();
      expect(html).toContain(`<html lang="${locale.lang}">`);
      expect(html).toContain(locale.hero);
      expect(html).toContain(locale.title);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        origin + locale.path,
      );
      for (const [lang, path] of [
        ["en", "/"],
        ["fr", "/fr/"],
        ["x-default", "/"],
      ]) {
        await expect(page.locator(`link[hreflang="${lang}"]`)).toHaveAttribute(
          "href",
          origin + path,
        );
      }
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        origin + locale.path,
      );
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        "content",
        `${origin}/screenshots/desktop-conversation${locale.suffix}.png`,
      );
      await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
        "content",
        locale.ogLocale,
      );
      await expect(
        page.locator('meta[property="og:locale:alternate"]'),
      ).toHaveAttribute("content", locale.otherOgLocale);
      await expect(
        page.locator('.language-switch a[aria-current="page"]'),
      ).toHaveAttribute("hreflang", locale.lang);
    });

    test("switches language explicitly and keeps the choice on reload", async ({
      page,
    }) => {
      await page.setExtraHTTPHeaders({
        "Accept-Language": locale.lang === "en" ? "fr-FR" : "en-US",
      });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", locale.lang);
      const language = page
        .locator(".language-switch")
        .getByRole("link", { name: locale.otherName });
      await expect(language).toBeVisible();
      await language.click();
      await expect(page).toHaveURL(new RegExp(`${locale.otherPath}$`));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        locale.lang === "en" ? "fr" : "en",
      );
      await page.goBack();
      await expect(page.locator("html")).toHaveAttribute("lang", locale.lang);
    });

    test.describe("without JavaScript", () => {
      test.use({ javaScriptEnabled: false });
      test("content and language navigation remain usable", async ({
        page,
      }) => {
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          locale.hero,
        );
        await page.locator("summary", { hasText: locale.permissions }).click();
        await expect(page.locator("details[open]")).toContainText(
          "bypassPermissions",
        );
        await page
          .locator(".language-switch")
          .getByRole("link", { name: locale.otherName })
          .click();
        await expect(page.locator("html")).toHaveAttribute(
          "lang",
          locale.lang === "en" ? "fr" : "en",
        );
      });
    });
  });
}

test("both documents retain the same layout structure and installation commands", async ({
  page,
}) => {
  const versions = [];
  for (const locale of locales) {
    await page.goto(locale.path);
    versions.push(
      await page.evaluate(() => ({
        structure: [
          ...document.querySelectorAll("main section, main [id], main img"),
        ].map((el) => [el.tagName, el.id, el.className]),
        commands: document
          .getElementById("install-commands")
          .textContent.split("\n")
          .filter((line) => line.trim() && !line.trim().startsWith("#")),
      })),
    );
  }
  expect(versions[0]).toEqual(versions[1]);
});

test("robots and sitemap advertise both canonical languages", async ({
  request,
  page,
}) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const entries = await page.evaluate(
    (xml) => {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      if (doc.querySelector("parsererror"))
        throw new Error("Invalid sitemap XML");
      return [...doc.getElementsByTagName("url")].map((url) => ({
        loc: url.getElementsByTagName("loc")[0].textContent,
        languages: [
          ...url.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link"),
        ].map((link) => [
          link.getAttribute("hreflang"),
          link.getAttribute("href"),
        ]),
      }));
    },
    await sitemap.text(),
  );
  expect(entries).toEqual(
    locales.map((locale) => ({
      loc: origin + locale.path,
      languages: [
        ["en", origin + "/"],
        ["fr", origin + "/fr/"],
        ["x-default", origin + "/"],
      ],
    })),
  );
});
