import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Load environment variables from .env.local
let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let serviceKey = process.env.SUPABASE_SECRET_KEY || "";
let publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

if (!supabaseUrl && existsSync(resolve(process.cwd(), ".env.local"))) {
  const envContent = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "NEXT_PUBLIC_SUPABASE_URL") supabaseUrl = val;
    if (key === "SUPABASE_SECRET_KEY") serviceKey = val;
    if (key === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") publishableKey = val;
  }
}

test.describe("Worklog Sheet End-to-End", () => {
  let testUserId: string;
  let testEmail: string;

  test.beforeAll(async () => {
    // Generate unique test user
    const stamp = Date.now();
    testEmail = `worklog-e2e-${stamp}@example.com`;
    const password = `Pw-${stamp}-Xy!`;

    // 1. Create user via Supabase Admin API
    const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: testEmail,
        password,
        email_confirm: true,
      }),
    });
    const userData = await userRes.json();
    testUserId = userData.id;

    // 2. Sign in to obtain access token to bootstrap workspace
    const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: testEmail, password }),
    });
    const authData = await authRes.json();
    const userToken = authData.access_token;

    // 3. Bootstrap workspace for this test user
    await fetch(`${supabaseUrl}/rest/v1/rpc/bootstrap_workspace`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_name: "E2E Test Studio",
        p_display_name: "Test Runner",
      }),
    });
  });

  test.afterAll(async () => {
    // Cleanup test user
    if (testUserId) {
      try {
        await fetch(`${supabaseUrl}/auth/v1/admin/users/${testUserId}`, {
          method: "DELETE",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        });
      } catch {
        // Ignored if append-only constraint prevents direct deletion
      }
    }
  });

  test("sign in via magic link, log work, share publicly, and verify accessibility", async ({
    page,
    browser,
  }) => {
    // 1. Generate magic link via admin API
    const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "magiclink",
        email: testEmail,
      }),
    });
    const linkData = await linkRes.json();
    const hashedToken = linkData.properties?.hashed_token;
    expect(hashedToken).toBeTruthy();

    // 2. Navigate to /auth/confirm to establish browser session
    await page.goto(`/auth/confirm?token_hash=${hashedToken}&type=magiclink&next=/sheet`);
    await page.waitForURL("**/sheet");
    await expect(page.getByRole("heading", { name: /What got done/i })).toBeVisible();

    // 3. Open composer and submit an entry with a Figma link
    const composerTrigger = page.getByRole("button", { name: /What did you work on\?/i });
    await composerTrigger.click();

    const titleInput = page.getByPlaceholder("What did you work on?");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Redesigned the Dashboard Layout");

    const noteInput = page.getByLabel("Detail");
    await noteInput.fill("Cleaned up whitespace and updated typography.");

    const linkInput = page.getByLabel("Add a link");
    await linkInput.fill("https://www.figma.com/design/test12345/Dashboard");
    await page.getByRole("button", { name: "Add" }).click();

    // Assert link badge is attached in draft list
    await expect(page.getByText("figma")).toBeVisible();

    // Submit the entry
    await page.getByRole("button", { name: /Log it/i }).click();

    // 4. Assert entry appears on the sheet
    await expect(page.getByText("Redesigned the Dashboard Layout")).toBeVisible();
    await expect(page.getByText("Cleaned up whitespace and updated typography.")).toBeVisible();

    // 5. Click share button to generate a public link
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const shareDialog = page.getByRole("dialog");
    await expect(shareDialog).toBeVisible();

    await shareDialog.getByRole("button", { name: /Create link/i }).click();

    // Wait for share link to be populated
    const shareInput = shareDialog.getByLabel("Share link");
    await expect(shareInput).toBeVisible();
    const shareUrl = await shareInput.inputValue();
    expect(shareUrl).toContain("/s/");

    // Close share dialog
    await shareDialog.getByRole("button", { name: "Done" }).click();

    // 6. Test guest view in fresh incognito context (completely unauthenticated)
    const incognito = await browser.newContext();
    const guestPage = await incognito.newPage();
    await guestPage.goto(shareUrl);

    // Guest sees the work sheet with the entry
    await expect(guestPage.getByText("Redesigned the Dashboard Layout")).toBeVisible();

    // 7. Verify accessibility on the guest sheet
    const accessibilityScanResults = await new AxeBuilder({ page: guestPage })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"]) // Contrast verified separately in design tokens
      .analyze();
    expect(accessibilityScanResults.violations).toEqual([]);

    await incognito.close();
  });
});
