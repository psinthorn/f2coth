import { test, expect } from "@playwright/test";

// Wizard happy-path for the Contracts admin module.
//
// Preconditions:
//   - Stack is up (make up) with contract-api + docgen healthy
//   - Migrations 054 + 055 applied (seeds service-agreement + mutual-nda)
//   - An admin JWT available in ADMIN_JWT (contracts writes require admin)
//
// We seed sessionStorage with the token (same approach as the projects
// suite) and drive the three wizard steps: pick template → create a new
// customer → accept the pre-filled details → Create. The test asserts the
// redirect to the contract detail page, the generated F2-AGR doc-no, and the
// initial Draft status.
const ADMIN_JWT = process.env.ADMIN_JWT;

test.describe("admin contracts — new contract wizard", () => {
  test.skip(!ADMIN_JWT, "set ADMIN_JWT to run this suite against a live stack");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(([token]) => {
      window.sessionStorage.setItem("f2_access_token", token as string);
    }, [ADMIN_JWT]);
  });

  test("template → new customer → create → draft detail", async ({ page }) => {
    await page.goto("/admin/contracts/new");

    // Step 1 — pick the service-agreement template.
    await page.getByTestId("tpl-service-agreement").click();

    // Step 2 — create a brand-new customer.
    await page.getByRole("button", { name: /new customer/i }).click();
    const stamp = Date.now();
    await page.getByTestId("party-legal-en").fill(`Playwright Co ${stamp}`);
    await page.getByTestId("party-legal-th").fill(`บริษัท เพลย์ไรท์ ${stamp}`);
    await page.getByRole("button", { name: /next/i }).click();

    // Step 3 — defaults are pre-filled (3-month term, 15,000 THB/mo); create.
    await page.getByRole("button", { name: /create contract/i }).click();

    // Redirect to the detail page with a freshly allocated F2-AGR doc-no.
    await expect(page).toHaveURL(/\/admin\/contracts\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("contract-doc-no")).toContainText(/F2-AGR-\d{4}-\d{3}/);

    // A new contract starts as a Draft.
    await expect(page.getByText(/draft/i).first()).toBeVisible();
  });
});
