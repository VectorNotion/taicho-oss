export interface Funnel {
  id: string;
  name: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  email: string;
  timezone: string | null;
  attributes: Record<string, unknown>;
  subscriptionStatus: "subscribed" | "unsubscribed" | "suppressed";
  workspaceContactId: string | null;
  /** @deprecated Historical compatibility only. */
  outreachProspectId: string | null;
}

export interface PlainTextEmail {
  id: string;
  funnelId: string;
  name: string;
  subject: string;
  body: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
