import { expect, test } from "@playwright/test";
import { seedOperatorWorkflow } from "./support";

test.beforeEach(async () => {
  await seedOperatorWorkflow();
});

test("operator signs in and confirms a candidate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Senha de acesso").fill("e2e-operator-password");
  await page.getByRole("button", { name: /entrar no painel/i }).click();

  await expect(page).toHaveURL(/\/inbox/);
  await expect(page.getByRole("heading", { name: "Inbox de sinais" })).toBeVisible();

  await page.getByLabel("Nome da festa").fill("Festa E2E confirmada");
  await page.getByRole("button", { name: /confirmar festa/i }).click();
  await expect(page.getByText("Festa confirmada")).toBeVisible();
});

test("navigation adapts to the current viewport", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Senha de acesso").fill("e2e-operator-password");
  await page.getByRole("button", { name: /entrar no painel/i }).click();

  const setupLink = page.getByRole("link", { name: /setup/i });
  await expect(setupLink).toBeVisible();
  await setupLink.click();
  await expect(page).toHaveURL(/\/setup/);

  if (testInfo.project.name === "mobile") {
    await expect(
      page.getByRole("navigation", { name: "Navegação principal" }),
    ).toBeVisible();
  }
});
