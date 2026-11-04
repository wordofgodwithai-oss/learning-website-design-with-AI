// Generates the billing BFF route stubs. Run once: `node scripts/make-billing-routes.mjs`
// Kept in the repo so the route list stays in sync with REPORT.md section 8.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "src", "app", "api");

const routes = [
  ["create-stripe-session", "POST", "create-stripe-session"],
  ["plan-upgrade/checkout", "POST", "plan-upgrade-checkout"],
  ["plan-upgrade/complete", "POST", "plan-upgrade-complete"],
  ["annual-upgrade/options", "GET", "annual-upgrade-options"],
  ["annual-upgrade/checkout", "POST", "annual-upgrade-checkout"],
  ["create-customer-portal-session", "POST", "customer-portal-session"],
  ["cancel-subscription", "POST", "cancel-subscription"],
  ["pause-subscription", "POST", "pause-subscription"],
  ["resume-subscription", "POST", "resume-subscription"],
  ["can-pause-subscription", "GET", "can-pause-subscription"],
  ["remove-addon", "POST", "remove-addon"],
];

const template = (intent, method) => `import { getUserFromRequest } from "@/lib/auth";
import { fail, json, readJson } from "@/lib/http";
import { mockBillingActionResult } from "@/lib/billing/mock-billing";

/**
 * MOCK BILLING — ${method} /api/${intent.replace(/^.*-/, "")}
 *
 * TODO(REAL-BILLING): implement this against Stripe. See REPORT.md section 8
 * and src/lib/billing/mock-billing.ts.
 */
export async function ${method}(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) return fail(401, "Authentication failed.");
  const body = ${method === "GET" ? "Object.fromEntries(new URL(request.url).searchParams.entries())" : "await readJson<Record<string, unknown>>(request)"};
  return json(await mockBillingActionResult("${intent}", body));
}
`;

for (const [route, method, intent] of routes) {
  const dir = path.join(root, ...route.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "route.ts"), template(intent, method), "utf8");
  console.log("wrote", route, method);
}
