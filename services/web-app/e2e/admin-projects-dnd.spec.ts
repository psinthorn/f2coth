import { test, expect } from "@playwright/test";

// Drag & drop coverage for the Projects & Checklists admin board.
//
// Preconditions:
//   - Stack is up (make up)
//   - checklist-api migrations 038 + 039 applied (seed 12 templates)
//   - An admin JWT is available in sessionStorage before the board loads.
//
// We stub the admin login by seeding sessionStorage with a token minted
// by auth-api. Runners without a fresh token can set ADMIN_JWT in the env.

const ADMIN_JWT = process.env.ADMIN_JWT;

test.describe("admin projects — drag & drop", () => {
  test.skip(!ADMIN_JWT, "set ADMIN_JWT to run this suite against a live stack");

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(([token]) => {
      window.sessionStorage.setItem("f2_access_token", token as string);
    }, [ADMIN_JWT]);
  });

  test("attach → reorder → detach preserves order on reload", async ({ page, request }) => {
    // Create a fresh project so we don't depend on data from prior runs.
    const create = await request.post("/api/checklists/admin/projects", {
      headers: { Authorization: `Bearer ${ADMIN_JWT}`, "Content-Type": "application/json" },
      data: { client_name: "E2E Test Co", name: `Playwright ${Date.now()}` },
    });
    expect(create.ok()).toBeTruthy();
    const project = await create.json();

    await page.goto(`/admin/projects/${project.id}`);

    // Library and empty attached panel both render.
    await expect(page.getByTestId("module-library")).toBeVisible();
    await expect(page.getByTestId("attached-panel")).toBeVisible();

    // Drag template A into the attached panel.
    const dragA = page.getByTestId("library-card-A");
    const drop = page.getByTestId("attached-panel");
    await dragA.dragTo(drop);
    await expect(page.getByTestId("attached-card-A")).toBeVisible();

    // Drag template B in as well.
    await page.getByTestId("library-card-B").dragTo(drop);
    await expect(page.getByTestId("attached-card-B")).toBeVisible();

    // Reorder: drag B above A.
    await page.getByTestId("attached-card-B").dragTo(page.getByTestId("attached-card-A"));

    // Reload — the persisted order should still be B, A.
    await page.reload();
    const cards = page.locator("[data-testid^='attached-card-']");
    await expect(cards.first()).toHaveAttribute("data-testid", "attached-card-B");
    await expect(cards.nth(1)).toHaveAttribute("data-testid", "attached-card-A");

    // Cleanup.
    await request.delete(`/api/checklists/admin/projects/${project.id}`, {
      headers: { Authorization: `Bearer ${ADMIN_JWT}` },
    });
  });
});
