import { getSession } from "../data/graph";

export type WorkspaceContactRole = "outreach" | "nurture";
export type WorkspaceOutreachSource =
  | "manual";

export interface WorkspaceContact {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  location: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  roles: WorkspaceContactRole[];
  outreach: {
    status: string;
    priority: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceContactInput {
  name: string;
  company?: string;
  title?: string;
  location?: string;
  photoUrl?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
}

export type UpdateWorkspaceContactInput = Partial<CreateWorkspaceContactInput>;

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function dateString(value: unknown): string {
  if (!value) return new Date(0).toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function contactFromGraph(
  properties: Record<string, unknown>,
  labels: string[],
): WorkspaceContact {
  const outreach = labels.includes("Lead");
  const nurture = labels.includes("NurtureContact");
  return {
    id: String(properties.id),
    name: String(
      properties.name
        ?? properties.email
        ?? "Unnamed contact",
    ),
    company: stringOrNull(properties.company),
    title: stringOrNull(properties.title),
    location: stringOrNull(properties.location),
    photoUrl: stringOrNull(properties.photoUrl),
    email: stringOrNull(properties.email),
    phone: stringOrNull(properties.phone),
    linkedinUrl: stringOrNull(properties.linkedinUrl),
    websiteUrl: stringOrNull(properties.websiteUrl),
    roles: [
      ...(outreach ? ["outreach" as const] : []),
      ...(nurture ? ["nurture" as const] : []),
    ],
    outreach: outreach
      ? {
          status: String(properties.status ?? "new"),
          priority: String(properties.priority ?? "medium"),
        }
      : null,
    createdAt: dateString(properties.createdAt),
    updatedAt: dateString(properties.updatedAt ?? properties.createdAt),
  };
}

export async function addWorkspaceContactRole(
  id: string,
  role: WorkspaceContactRole,
  options?: {
    outreachSource?: WorkspaceOutreachSource;
    sourceProvider?: string;
  },
): Promise<WorkspaceContact | null> {
  const session = await getSession();
  try {
    const result = await session.run(
      role === "outreach"
        ? `
          MATCH (contact {id: $id})
          WHERE contact:Contact OR contact:Lead
          SET contact:Contact:Lead,
              contact.status = coalesce(contact.status, 'new'),
              contact.priority = coalesce(contact.priority, 'medium'),
              contact.source = coalesce(contact.source, $outreachSource, 'manual'),
              contact.sourceProvider = coalesce(contact.sourceProvider, $sourceProvider),
              contact.tags = coalesce(contact.tags, []),
              contact.customAttributes = coalesce(contact.customAttributes, '{}'),
              contact.nameWasDerived = coalesce(contact.nameWasDerived, false),
              contact.revision = coalesce(contact.revision, 0),
              contact.updatedAt = localdatetime()
          RETURN contact, labels(contact) AS labels
          LIMIT 1
        `
        : `
          MATCH (contact {id: $id})
          WHERE contact:Contact OR contact:Lead
          SET contact:Contact:NurtureContact, contact.updatedAt = localdatetime()
          RETURN contact, labels(contact) AS labels
          LIMIT 1
        `,
      {
        id,
        outreachSource: options?.outreachSource ?? null,
        sourceProvider: options?.sourceProvider ?? null,
      },
    );
    const record = result.records[0];
    return record
      ? contactFromGraph(
          record.get("contact").properties,
          record.get("labels") as string[],
        )
      : null;
  } finally {
    await session.close();
  }
}

/**
 * Promote the historical Outreach-owned graph label into the canonical
 * workspace identity without removing the Lead role projection.
 */
export async function ensureWorkspaceContactLabels(): Promise<number> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (contact:Lead)
      WHERE NOT contact:Contact
      SET contact:Contact
      RETURN count(contact) AS promoted
      `,
    );
    const value = result.records[0]?.get("promoted");
    return typeof value?.toNumber === "function"
      ? value.toNumber()
      : Number(value ?? 0);
  } finally {
    await session.close();
  }
}

export async function listWorkspaceContacts(input?: {
  search?: string;
  limit?: number;
}): Promise<WorkspaceContact[]> {
  const session = await getSession();
  try {
    const search = input?.search?.trim() ?? "";
    const limit = Math.min(500, Math.max(1, input?.limit ?? 200));
    const result = await session.run(
      `
      MATCH (contact)
      WHERE (contact:Contact OR contact:Lead)
        AND (
          $search = ''
          OR toLower(coalesce(contact.name, '')) CONTAINS toLower($search)
          OR toLower(coalesce(contact.email, '')) CONTAINS toLower($search)
          OR toLower(coalesce(contact.company, '')) CONTAINS toLower($search)
        )
      RETURN contact, labels(contact) AS labels
      ORDER BY contact.updatedAt DESC, contact.createdAt DESC
      LIMIT $limit
      `,
      { search, limit },
    );
    return result.records.map((record) =>
      contactFromGraph(
        record.get("contact").properties,
        record.get("labels") as string[],
      ),
    );
  } finally {
    await session.close();
  }
}

export async function getWorkspaceContactById(
  id: string,
): Promise<WorkspaceContact | null> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (contact {id: $id})
      WHERE contact:Contact OR contact:Lead
      RETURN contact, labels(contact) AS labels
      LIMIT 1
      `,
      { id },
    );
    const record = result.records[0];
    return record
      ? contactFromGraph(
          record.get("contact").properties,
          record.get("labels") as string[],
        )
      : null;
  } finally {
    await session.close();
  }
}

export async function getWorkspaceContactByEmail(
  email: string,
): Promise<WorkspaceContact | null> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (contact)
      WHERE (contact:Contact OR contact:Lead)
        AND contact.email IS NOT NULL
        AND toLower(contact.email) = toLower($email)
      RETURN contact, labels(contact) AS labels
      LIMIT 1
      `,
      { email: email.trim() },
    );
    const record = result.records[0];
    return record
      ? contactFromGraph(
          record.get("contact").properties,
          record.get("labels") as string[],
        )
      : null;
  } finally {
    await session.close();
  }
}

/**
 * Delete only an unassigned, disconnected workspace identity. Service roles
 * must be removed through their owning product before the canonical person can
 * be deleted.
 */
export async function deleteWorkspaceContact(id: string): Promise<boolean> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (contact:Contact {id: $id})
      WHERE NOT contact:Lead AND NOT contact:NurtureContact
      OPTIONAL MATCH (contact)-[relationship]-()
      WITH contact, count(relationship) AS relationshipCount
      WHERE relationshipCount = 0
      DELETE contact
      RETURN count(contact) AS deleted
      `,
      { id },
    );
    const value = result.records[0]?.get("deleted");
    const deleted = typeof value?.toNumber === "function"
      ? value.toNumber()
      : Number(value ?? 0);
    return deleted > 0;
  } finally {
    await session.close();
  }
}

export async function ensureWorkspaceContact(
  input: CreateWorkspaceContactInput & { id?: string },
): Promise<{ contact: WorkspaceContact; created: boolean }> {
  const session = await getSession();
  try {
    const email = input.email?.trim() || null;
    if (input.id || email) {
      const existing = await session.run(
        `
        MATCH (contact)
        WHERE (contact:Contact OR contact:Lead)
          AND (
            ($id IS NOT NULL AND contact.id = $id)
            OR ($email IS NOT NULL AND toLower(contact.email) = toLower($email))
          )
        SET contact:Contact,
            contact.name = CASE
              WHEN contact.name IS NULL OR contact.name = '' THEN $name
              ELSE contact.name
            END,
            contact.company = coalesce(contact.company, $company),
            contact.title = coalesce(contact.title, $title),
            contact.location = coalesce(contact.location, $location),
            contact.photoUrl = coalesce(contact.photoUrl, $photoUrl),
            contact.email = coalesce(contact.email, $email),
            contact.phone = coalesce(contact.phone, $phone),
            contact.linkedinUrl = coalesce(contact.linkedinUrl, $linkedinUrl),
            contact.websiteUrl = coalesce(contact.websiteUrl, $websiteUrl),
            contact.updatedAt = localdatetime()
        RETURN contact, labels(contact) AS labels
        LIMIT 1
        `,
        {
          id: input.id ?? null,
          name: input.name.trim(),
          company: input.company?.trim() || null,
          title: input.title?.trim() || null,
          location: input.location?.trim() || null,
          photoUrl: input.photoUrl?.trim() || null,
          email,
          phone: input.phone?.trim() || null,
          linkedinUrl: input.linkedinUrl?.trim() || null,
          websiteUrl: input.websiteUrl?.trim() || null,
        },
      );
      const record = existing.records[0];
      if (record) {
        return {
          contact: contactFromGraph(
            record.get("contact").properties,
            record.get("labels") as string[],
          ),
          created: false,
        };
      }
    }

    const created = await session.run(
      `
      CREATE (contact:Contact {
        id: coalesce($id, randomUUID()),
        name: $name,
        company: $company,
        title: $title,
        location: $location,
        photoUrl: $photoUrl,
        email: $email,
        phone: $phone,
        linkedinUrl: $linkedinUrl,
        websiteUrl: $websiteUrl,
        createdAt: localdatetime(),
        updatedAt: localdatetime()
      })
      RETURN contact, labels(contact) AS labels
      `,
      {
        id: input.id ?? null,
        name: input.name.trim(),
        company: input.company?.trim() || null,
        title: input.title?.trim() || null,
        location: input.location?.trim() || null,
        photoUrl: input.photoUrl?.trim() || null,
        email,
        phone: input.phone?.trim() || null,
        linkedinUrl: input.linkedinUrl?.trim() || null,
        websiteUrl: input.websiteUrl?.trim() || null,
      },
    );
    const record = created.records[0];
    return {
      contact: contactFromGraph(
        record.get("contact").properties,
        record.get("labels") as string[],
      ),
      created: true,
    };
  } finally {
    await session.close();
  }
}

export async function updateWorkspaceContact(
  id: string,
  patch: UpdateWorkspaceContactInput,
): Promise<WorkspaceContact | null> {
  const session = await getSession();
  try {
    const values = {
      id,
      name: patch.name?.trim() || null,
      company: patch.company?.trim() || null,
      title: patch.title?.trim() || null,
      location: patch.location?.trim() || null,
      photoUrl: patch.photoUrl?.trim() || null,
      email: patch.email?.trim().toLowerCase() || null,
      phone: patch.phone?.trim() || null,
      linkedinUrl: patch.linkedinUrl?.trim() || null,
      websiteUrl: patch.websiteUrl?.trim() || null,
      fields: Object.keys(patch),
    };
    const result = await session.run(
      `
      MATCH (contact {id: $id})
      WHERE contact:Contact OR contact:Lead
      SET contact:Contact,
          contact.name = CASE WHEN 'name' IN $fields THEN coalesce($name, contact.name) ELSE contact.name END,
          contact.company = CASE WHEN 'company' IN $fields THEN $company ELSE contact.company END,
          contact.title = CASE WHEN 'title' IN $fields THEN $title ELSE contact.title END,
          contact.location = CASE WHEN 'location' IN $fields THEN $location ELSE contact.location END,
          contact.photoUrl = CASE WHEN 'photoUrl' IN $fields THEN $photoUrl ELSE contact.photoUrl END,
          contact.email = CASE WHEN 'email' IN $fields THEN $email ELSE contact.email END,
          contact.phone = CASE WHEN 'phone' IN $fields THEN $phone ELSE contact.phone END,
          contact.linkedinUrl = CASE WHEN 'linkedinUrl' IN $fields THEN $linkedinUrl ELSE contact.linkedinUrl END,
          contact.websiteUrl = CASE WHEN 'websiteUrl' IN $fields THEN $websiteUrl ELSE contact.websiteUrl END,
          contact.updatedAt = localdatetime()
      RETURN contact, labels(contact) AS labels
      LIMIT 1
      `,
      values,
    );
    const record = result.records[0];
    return record
      ? contactFromGraph(
          record.get("contact").properties,
          record.get("labels") as string[],
        )
      : null;
  } finally {
    await session.close();
  }
}
