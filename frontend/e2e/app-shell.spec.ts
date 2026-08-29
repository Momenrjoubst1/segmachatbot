import { expect, test } from "@playwright/test";

/**
 * App-shell smoke: the production bundle mounts, reaches an interactive
 * state, and throws no uncaught page errors. Auth-dependent flows are out
 * of scope here (no backend in CI); these assert the shell is alive.
 */
test("app shell mounts on / with a live composer and zero page errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/");

  // Guest-mode anchors: the composer textbox, its prompt label and the free
  // messages counter prove the whole shell (sidebar + thread + composer)
  // mounted interactive.
  await expect(page.getByRole("textbox").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Ask Sigma")).toBeVisible();
  await expect(page.getByText(/free messages used/)).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("/login renders the auth form", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/login");
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('input[type="password"]')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("unknown routes render the NotFound boundary, not a crash", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  await page.goto("/definitely-not-a-route");
  await expect(page.locator("body")).not.toBeEmpty();
  // The React tree survived: the shell element still owns the page.
  await expect(page.locator("#root, #__next, body > div").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
