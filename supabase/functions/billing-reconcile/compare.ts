// Pure rules of the daily Stripe reconciliation: compare what Stripe says about each subscription with what the database holds, and
// decide what is a safe correction and what only needs a human. No Deno or network access: tested in Node.
// Stripe is the source of truth. The same fields are kept as the webhook keeps them (status, end of the period, cancel at period end).

const FINISHED_STATUSES = new Set(["canceled", "incomplete_expired"]);

export const RECENT_UPDATE_GRACE_MS = 60 * 60 * 1000; // a row changed in the last hour is left alone (the webhook may be mid-flight)

export interface StripeSubscription {
  id: string;
  customerId: string | null;
  status: string;
  periodEnd: string | null; // ISO, whole seconds
  cancelAtPeriodEnd: boolean;
  workspaceId: string | null; // from the subscription metadata set when the checkout was created
}

export interface DatabaseSubscription {
  workspace_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  updated_at: string;
}

export interface Change { field: "status" | "current_period_end" | "cancel_at_period_end"; database: unknown; stripe: unknown }

export type Finding =
  | { kind: "fix"; workspaceId: string; subscriptionId: string; changes: Change[]; target: StripeSubscription; databaseUpdatedAt: string }
  | { kind: "create"; workspaceId: string; subscriptionId: string; target: StripeSubscription }
  | { kind: "review"; reason: ReviewReason; workspaceId: string | null; subscriptionId: string | null; detail: string };

export type ReviewReason =
  | "subscription_not_in_stripe"
  | "customer_mismatch"
  | "workspace_mismatch"
  | "stripe_subscription_unknown_workspace_has_other"
  | "stripe_subscription_without_workspace";

export interface Summary { checked: number; inSync: number; skippedRecent: number; fixes: number; creates: number; reviews: number }

const toSeconds = (value: string | null): number | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : Math.floor(time / 1000);
};

/**
 * @param workspaceExists ids of the workspaces that exist (only for subscriptions Stripe knows and the database does not)
 */
export function compareSubscriptions(
  database: DatabaseSubscription[],
  stripe: StripeSubscription[],
  workspaceExists: Set<string>,
  now: Date,
): { findings: Finding[]; summary: Summary } {
  const findings: Finding[] = [];
  const summary: Summary = { checked: 0, inSync: 0, skippedRecent: 0, fixes: 0, creates: 0, reviews: 0 };
  const stripeById = new Map(stripe.map((item) => [item.id, item]));
  const knownSubscriptionIds = new Set<string>();
  const workspacesWithRow = new Set(database.map((row) => row.workspace_id));

  for (const row of database) {
    if (!row.stripe_subscription_id) continue; // nothing to compare against Stripe
    knownSubscriptionIds.add(row.stripe_subscription_id);
    summary.checked++;
    const remote = stripeById.get(row.stripe_subscription_id);
    if (!remote) {
      findings.push({ kind: "review", reason: "subscription_not_in_stripe", workspaceId: row.workspace_id, subscriptionId: row.stripe_subscription_id, detail: "The database points to a Stripe subscription that Stripe does not list." });
      summary.reviews++;
      continue;
    }
    if (row.stripe_customer_id && remote.customerId && row.stripe_customer_id !== remote.customerId) {
      findings.push({ kind: "review", reason: "customer_mismatch", workspaceId: row.workspace_id, subscriptionId: remote.id, detail: "The Stripe customer of this subscription is not the one recorded for the workspace." });
      summary.reviews++;
      continue;
    }
    if (remote.workspaceId && remote.workspaceId !== row.workspace_id) {
      findings.push({ kind: "review", reason: "workspace_mismatch", workspaceId: row.workspace_id, subscriptionId: remote.id, detail: "Stripe says this subscription belongs to a different workspace." });
      summary.reviews++;
      continue;
    }
    const changes: Change[] = [];
    if (row.status !== remote.status) changes.push({ field: "status", database: row.status, stripe: remote.status });
    if (toSeconds(row.current_period_end) !== toSeconds(remote.periodEnd)) changes.push({ field: "current_period_end", database: row.current_period_end, stripe: remote.periodEnd });
    if (Boolean(row.cancel_at_period_end) !== Boolean(remote.cancelAtPeriodEnd)) changes.push({ field: "cancel_at_period_end", database: row.cancel_at_period_end, stripe: remote.cancelAtPeriodEnd });
    if (!changes.length) { summary.inSync++; continue; }
    if (now.getTime() - Date.parse(row.updated_at) < RECENT_UPDATE_GRACE_MS) { summary.skippedRecent++; continue; }
    findings.push({ kind: "fix", workspaceId: row.workspace_id, subscriptionId: remote.id, changes, target: remote, databaseUpdatedAt: row.updated_at });
    summary.fixes++;
  }

  // Subscriptions Stripe has for a workspace and the database has no record of (for example the checkout notice never arrived).
  // A finished subscription (canceled, or a checkout that expired) is history, not a difference: a workspace that cancelled and
  // subscribed again has the old one in Stripe forever, so those are ignored. Only a live one is looked at.
  const createdFor = new Set<string>(); // a workspace has one record: a second live subscription for it is for a person to look at
  const unknown = stripe.filter((item) => !knownSubscriptionIds.has(item.id) && item.workspaceId && !FINISHED_STATUSES.has(item.status));
  for (const remote of unknown) {
    const workspaceId = remote.workspaceId as string;
    if (!workspaceExists.has(workspaceId)) {
      findings.push({ kind: "review", reason: "stripe_subscription_without_workspace", workspaceId, subscriptionId: remote.id, detail: "Stripe has a live subscription for a workspace that does not exist (any more)." });
      summary.reviews++;
    } else if (workspacesWithRow.has(workspaceId) || createdFor.has(workspaceId)) {
      findings.push({ kind: "review", reason: "stripe_subscription_unknown_workspace_has_other", workspaceId, subscriptionId: remote.id, detail: "The workspace has a live subscription in Stripe besides the one recorded: it may be charged twice." });
      summary.reviews++;
    } else {
      createdFor.add(workspaceId);
      findings.push({ kind: "create", workspaceId, subscriptionId: remote.id, target: remote });
      summary.creates++;
    }
  }
  return { findings, summary };
}

/** True when the subscription gives access right now (the same rule the database uses). */
export function hasAccess(status: string, periodEnd: string | null, now: Date): boolean {
  return status === "active" && Boolean(periodEnd) && Date.parse(periodEnd as string) > now.getTime();
}

/** Plain text of the report. No personal data: only workspace ids, subscription ids and the plan fields that differed. */
export function reportText(summary: Summary, findings: Finding[], applied: Record<string, string>): string {
  const lines = [
    `Pathway: daily Stripe reconciliation found differences.`,
    `Checked ${summary.checked} subscription(s): ${summary.inSync} in sync, ${summary.fixes} corrected, ${summary.creates} created, ${summary.reviews} need a person to look.`,
    "",
  ];
  for (const finding of findings) {
    const key = `${finding.workspaceId}:${finding.subscriptionId}`;
    if (finding.kind === "review") {
      lines.push(`NEEDS REVIEW (${finding.reason}) workspace ${finding.workspaceId ?? "-"} subscription ${finding.subscriptionId ?? "-"}: ${finding.detail}`);
    } else if (finding.kind === "create") {
      lines.push(`${applied[key] === "done" ? "CREATED" : "NOT CREATED"} workspace ${finding.workspaceId} subscription ${finding.subscriptionId} with status ${finding.target.status}.`);
    } else {
      lines.push(`${applied[key] === "done" ? "CORRECTED" : "NOT CORRECTED"} workspace ${finding.workspaceId} subscription ${finding.subscriptionId}: ${finding.changes.map((change) => `${change.field} ${String(change.database)} -> ${String(change.stripe)}`).join("; ")}.`);
    }
  }
  return lines.join("\n");
}
