import { getSession } from '@content-automation/platform/data/graph';
import { currentExecutionContext } from '@content-automation/observability';
import {
  emitProductEventFromContext,
  recordProductEventFromContext,
} from '@content-automation/platform/events/emit';
import type {
  Prospect,
  ProspectNote,
  ProspectActivity,
  ProspectActivityType,
  ProspectPriority,
  CreateProspectInput,
  UpdateProspectInput,
  ProspectFilters,
  OutreachMessage,
  OutreachMessageWithProspect,
  CreateOutreachInput,
  UpdateOutreachInput,
  ProspectResearch,
  CompanyInsight,
  CompetitorInfo,
  CreateActivityInput,
  UpdateActivityInput,
  LegacyQualification,
  CreateQualificationInput,
} from '../domain/types';

// ============= PROSPECTS CRUD =============

export async function createProspect(data: CreateProspectInput): Promise<Prospect> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      CREATE (l:Contact:Prospect {
        id: randomUUID(),
        name: $name,
        company: $company,
        title: $title,
        location: $location,
        photoUrl: $photoUrl,
        email: $email,
        phone: $phone,
        linkedinUrl: $linkedinUrl,
        twitterUrl: $twitterUrl,
        youtubeUrl: $youtubeUrl,
        instagramUrl: $instagramUrl,
        facebookUrl: $facebookUrl,
        websiteUrl: $websiteUrl,
        status: 'new',
        source: $source,
        sourceProvider: $sourceProvider,
        nameWasDerived: $nameWasDerived,
        priority: $priority,
        tags: $tags,
        customAttributes: $customAttributes,
        revision: 1,
        about: $about,
        referredBy: $referredBy,
        createdAt: localdatetime(),
        updatedAt: localdatetime(),
        lastContactedAt: null
      })
      RETURN l
      `,
      {
        name: data.name,
        company: data.company ?? null,
        title: data.title ?? null,
        location: data.location ?? null,
        photoUrl: data.photoUrl ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        linkedinUrl: data.linkedinUrl ?? null,
        twitterUrl: data.twitterUrl ?? null,
        youtubeUrl: data.youtubeUrl ?? null,
        instagramUrl: data.instagramUrl ?? null,
        facebookUrl: data.facebookUrl ?? null,
        websiteUrl: data.websiteUrl ?? null,
        source: data.source,
        sourceProvider: data.sourceProvider ?? null,
        nameWasDerived: data.nameWasDerived ?? false,
        priority: data.priority ?? 'medium',
        tags: data.tags ?? [],
        customAttributes: JSON.stringify(data.customAttributes ?? {}),
        about: data.about ?? null,
        referredBy: data.referredBy ?? null,
      }
    );

    const record = result.records[0];
    const prospect = mapProspectFromNeo4j(record.get('l').properties);
    const prospectCreatedEvent = {
      name: 'prospect.created',
      refs: { prospectId: prospect.id },
      payload: {
        source: prospect.source,
        name: prospect.name,
        company: prospect.company ?? null,
      },
    } as const;
    if (currentExecutionContext()?.eventOrigin === 'external_connector') {
      await recordProductEventFromContext(prospectCreatedEvent);
    } else {
      emitProductEventFromContext(prospectCreatedEvent);
    }
    return prospect;
  } finally {
    await session.close();
  }
}

/**
 * Retry-safe create used after a provider identity has reserved a deterministic
 * prospect ID. Existing prospects are returned unchanged; capture never overwrites a
 * prospect merely because the same source page was processed again.
 */
export async function createProspectWithIdIfMissing(
  id: string,
  data: CreateProspectInput,
): Promise<{ prospect: Prospect; created: boolean }> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MERGE (l:Contact:Prospect {id: $id})
      ON CREATE SET
        l.name = $name,
        l.company = $company,
        l.title = $title,
        l.location = $location,
        l.photoUrl = $photoUrl,
        l.email = $email,
        l.phone = $phone,
        l.linkedinUrl = $linkedinUrl,
        l.twitterUrl = $twitterUrl,
        l.youtubeUrl = $youtubeUrl,
        l.instagramUrl = $instagramUrl,
        l.facebookUrl = $facebookUrl,
        l.websiteUrl = $websiteUrl,
        l.status = 'new',
        l.source = $source,
        l.sourceProvider = $sourceProvider,
        l.nameWasDerived = $nameWasDerived,
        l.priority = $priority,
        l.tags = $tags,
        l.customAttributes = $customAttributes,
        l.revision = 1,
        l.about = $about,
        l.referredBy = $referredBy,
        l.createdAt = localdatetime(),
        l.updatedAt = localdatetime(),
        l.lastContactedAt = null,
        l.__captureCreated = true
      WITH l, coalesce(l.__captureCreated, false) AS created
      REMOVE l.__captureCreated
      RETURN l, created
      `,
      {
        id,
        name: data.name,
        company: data.company ?? null,
        title: data.title ?? null,
        location: data.location ?? null,
        photoUrl: data.photoUrl ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        linkedinUrl: data.linkedinUrl ?? null,
        twitterUrl: data.twitterUrl ?? null,
        youtubeUrl: data.youtubeUrl ?? null,
        instagramUrl: data.instagramUrl ?? null,
        facebookUrl: data.facebookUrl ?? null,
        websiteUrl: data.websiteUrl ?? null,
        source: data.source,
        sourceProvider: data.sourceProvider ?? null,
        nameWasDerived: data.nameWasDerived ?? false,
        priority: data.priority ?? 'medium',
        tags: data.tags ?? [],
        customAttributes: JSON.stringify(data.customAttributes ?? {}),
        about: data.about ?? null,
        referredBy: data.referredBy ?? null,
      },
    );

    const record = result.records[0];
    if (!record) throw new Error('Prospect capture projection could not be created.');
    const prospect = mapProspectFromNeo4j(record.get('l').properties);
    const created = Boolean(record.get('created'));
    if (created) {
      const prospectCreatedEvent = {
        name: 'prospect.created',
        refs: { prospectId: prospect.id },
        payload: {
          source: prospect.source,
          name: prospect.name,
          company: prospect.company ?? null,
        },
      } as const;
      if (currentExecutionContext()?.eventOrigin === 'external_connector') {
        await recordProductEventFromContext(prospectCreatedEvent);
      } else {
        emitProductEventFromContext(prospectCreatedEvent);
      }
    }
    return { prospect, created };
  } finally {
    await session.close();
  }
}

export async function getProspects(filters?: ProspectFilters): Promise<Prospect[]> {
  const session = await getSession();

  try {
    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters?.status) {
      whereClauses.push('l.status = $status');
      params.status = filters.status;
    }

    if (filters?.source) {
      whereClauses.push('l.source = $source');
      params.source = filters.source;
    }

    if (filters?.priority) {
      whereClauses.push('l.priority = $priority');
      params.priority = filters.priority;
    }

    if (filters?.search) {
      whereClauses.push(
        '(toLower(l.name) CONTAINS toLower($search) OR toLower(l.company) CONTAINS toLower($search) OR toLower(l.email) CONTAINS toLower($search))'
      );
      params.search = filters.search;
    }

    const whereClause =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const result = await session.run(
      `
      MATCH (l:Prospect)
      ${whereClause}
      RETURN l
      ORDER BY l.createdAt DESC
      `,
      params
    );

    return result.records.map((record) => {
      const prospect = record.get('l').properties;
      return mapProspectFromNeo4j(prospect);
    });
  } finally {
    await session.close();
  }
}

export async function getProspectsPage(
  filters: ProspectFilters | undefined,
  input: { page: number; pageSize: number },
): Promise<{ prospects: Prospect[]; total: number; page: number; pageSize: number }> {
  const session = await getSession();
  const page = Math.max(1, Math.floor(input.page));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize)));
  try {
    const whereClauses: string[] = [];
    const params: Record<string, unknown> = {
      skip: (page - 1) * pageSize,
      end: page * pageSize,
      limit: pageSize,
    };
    if (filters?.status) {
      whereClauses.push("l.status = $status");
      params.status = filters.status;
    }
    if (filters?.source) {
      whereClauses.push("l.source = $source");
      params.source = filters.source;
    }
    if (filters?.priority) {
      whereClauses.push("l.priority = $priority");
      params.priority = filters.priority;
    }
    if (filters?.search) {
      whereClauses.push(
        "(toLower(l.name) CONTAINS toLower($search) OR toLower(l.company) CONTAINS toLower($search) OR toLower(l.email) CONTAINS toLower($search))",
      );
      params.search = filters.search;
    }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const result = await session.run(
      `
      MATCH (l:Prospect)
      ${where}
      WITH l ORDER BY l.createdAt DESC
      WITH collect(l) AS matching
      RETURN size(matching) AS total, matching[$skip..$end] AS prospects
      `,
      params,
    );
    const record = result.records[0];
    const prospects = (record?.get("prospects") ?? []) as Array<{ properties: Record<string, unknown> }>;
    const rawTotal = record?.get("total");
    return {
      prospects: prospects.map((prospect) => mapProspectFromNeo4j(prospect.properties ?? prospect as never)),
      total: typeof rawTotal?.toNumber === "function" ? rawTotal.toNumber() : Number(rawTotal ?? 0),
      page,
      pageSize,
    };
  } finally {
    await session.close();
  }
}

export async function getProspectById(id: string): Promise<Prospect | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $id})
      RETURN l
      `,
      { id }
    );

    if (result.records.length === 0) {
      return null;
    }

    const prospect = result.records[0].get('l').properties;
    return mapProspectFromNeo4j(prospect);
  } finally {
    await session.close();
  }
}

export async function getProspectByLinkedinUrl(
  linkedinUrl: string,
  source?: Prospect['source'],
): Promise<Prospect | null> {
  const session = await getSession();

  try {
    // Normalize URL for comparison (remove trailing slash, query params)
    const normalizedUrl = linkedinUrl.split('?')[0].split('#')[0].replace(/\/$/, '');

    const result = await session.run(
      `
      MATCH (l:Prospect)
      WHERE l.linkedinUrl IS NOT NULL
        AND ($source IS NULL OR l.source = $source)
        AND replace(replace(split(l.linkedinUrl, '?')[0], '/', ''), '#', '') = replace(replace($url, '/', ''), '#', '')
      RETURN l
      LIMIT 1
      `,
      { url: normalizedUrl, source: source ?? null }
    );

    if (result.records.length === 0) {
      return null;
    }

    const prospect = result.records[0].get('l').properties;
    return mapProspectFromNeo4j(prospect);
  } finally {
    await session.close();
  }
}

export async function getProspectByNameAndCompany(name: string, company: string | null): Promise<Prospect | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect)
      WHERE toLower(l.name) = toLower($name)
        AND (
          ($company IS NULL AND l.company IS NULL)
          OR toLower(l.company) = toLower($company)
        )
      RETURN l
      LIMIT 1
      `,
      { name, company: company ?? null }
    );

    if (result.records.length === 0) {
      return null;
    }

    const prospect = result.records[0].get('l').properties;
    return mapProspectFromNeo4j(prospect);
  } finally {
    await session.close();
  }
}

export async function updateProspect(
  id: string,
  data: UpdateProspectInput
): Promise<Prospect | null> {
  const session = await getSession();

  try {
    // Build SET clause dynamically based on provided fields
    const setClauses: string[] = ['l.updatedAt = localdatetime()'];
    const params: Record<string, unknown> = {
      id,
      recordStatusActivity: false,
      nextStatus: null,
      statusActivityMetadata: null,
    };

    if (data.name !== undefined) {
      setClauses.push('l.name = $name');
      params.name = data.name;
    }
    if (data.company !== undefined) {
      setClauses.push('l.company = $company');
      params.company = data.company;
    }
    if (data.title !== undefined) {
      setClauses.push('l.title = $title');
      params.title = data.title;
    }
    if (data.location !== undefined) {
      setClauses.push('l.location = $location');
      params.location = data.location;
    }
    if (data.email !== undefined) {
      setClauses.push('l.email = $email');
      params.email = data.email;
    }
    if (data.phone !== undefined) {
      setClauses.push('l.phone = $phone');
      params.phone = data.phone;
    }
    if (data.linkedinUrl !== undefined) {
      setClauses.push('l.linkedinUrl = $linkedinUrl');
      params.linkedinUrl = data.linkedinUrl;
    }
    if (data.twitterUrl !== undefined) {
      setClauses.push('l.twitterUrl = $twitterUrl');
      params.twitterUrl = data.twitterUrl;
    }
    if (data.youtubeUrl !== undefined) {
      setClauses.push('l.youtubeUrl = $youtubeUrl');
      params.youtubeUrl = data.youtubeUrl;
    }
    if (data.instagramUrl !== undefined) {
      setClauses.push('l.instagramUrl = $instagramUrl');
      params.instagramUrl = data.instagramUrl;
    }
    if (data.facebookUrl !== undefined) {
      setClauses.push('l.facebookUrl = $facebookUrl');
      params.facebookUrl = data.facebookUrl;
    }
    if (data.websiteUrl !== undefined) {
      setClauses.push('l.websiteUrl = $websiteUrl');
      params.websiteUrl = data.websiteUrl;
    }
    if (data.status !== undefined) {
      setClauses.push('l.status = $status');
      params.status = data.status;
      params.recordStatusActivity = true;
      params.nextStatus = data.status;
      params.statusActivityMetadata = JSON.stringify({ newStatus: data.status });
    }
    if (data.source !== undefined) {
      setClauses.push('l.source = $source');
      params.source = data.source;
    }
    if (data.sourceProvider !== undefined) {
      setClauses.push('l.sourceProvider = $sourceProvider');
      params.sourceProvider = data.sourceProvider;
    }
    if (data.nameWasDerived !== undefined) {
      setClauses.push('l.nameWasDerived = $nameWasDerived');
      params.nameWasDerived = data.nameWasDerived;
    }
    if (data.priority !== undefined) {
      setClauses.push('l.priority = $priority');
      params.priority = data.priority;
    }
    if (data.tags !== undefined) {
      setClauses.push('l.tags = $tags');
      params.tags = data.tags;
    }
    if (data.customAttributes !== undefined) {
      setClauses.push('l.customAttributes = $customAttributes');
      params.customAttributes = JSON.stringify(data.customAttributes);
    }
    if (data.about !== undefined) {
      setClauses.push('l.about = $about');
      params.about = data.about;
    }
    if (data.referredBy !== undefined) {
      setClauses.push('l.referredBy = $referredBy');
      params.referredBy = data.referredBy;
    }
    if (data.lastContactedAt !== undefined) {
      setClauses.push('l.lastContactedAt = localdatetime($lastContactedAt)');
      params.lastContactedAt = data.lastContactedAt;
    }

    const result = await session.run(
      `
      MATCH (l:Prospect {id: $id})
      WITH l, l.status AS previousStatus
      SET ${setClauses.join(', ')}
      FOREACH (_ IN CASE WHEN $recordStatusActivity AND previousStatus <> $nextStatus THEN [1] ELSE [] END |
        CREATE (a:ProspectActivity {
          id: randomUUID(),
          prospectId: l.id,
          type: 'status_change',
          title: 'Status changed to ' + $nextStatus,
          notes: 'Moved from ' + previousStatus + ' to ' + $nextStatus,
          metadata: $statusActivityMetadata,
          createdAt: localdatetime(),
          updatedAt: localdatetime()
        })
        CREATE (l)-[:HAS_ACTIVITY]->(a)
      )
      RETURN l
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    const prospect = result.records[0].get('l').properties;
    return mapProspectFromNeo4j(prospect);
  } finally {
    await session.close();
  }
}

export async function deleteProspect(id: string): Promise<boolean> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $id})
      REMOVE l:Prospect
      RETURN count(l) as removed
      `,
      { id }
    );

    const removed = result.records[0]?.get('removed')?.toNumber() ?? 0;
    return removed > 0;
  } finally {
    await session.close();
  }
}

// ============= COUNTS =============

export async function getProspectCounts(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byPriority: Record<string, number>;
}> {
  const session = await getSession();

  try {
    const result = await session.run(`
      MATCH (l:Prospect)
      RETURN
        count(l) as total,
        l.status as status,
        l.source as source,
        l.priority as priority
    `);

    const byStatus: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    let total = 0;

    for (const record of result.records) {
      const count = record.get('total').toNumber();
      total += count;
      const status = record.get('status');
      const source = record.get('source');
      const priority = record.get('priority');

      byStatus[status] = (byStatus[status] || 0) + count;
      bySource[source] = (bySource[source] || 0) + count;
      byPriority[priority] = (byPriority[priority] || 0) + count;
    }

    return { total, byStatus, bySource, byPriority };
  } finally {
    await session.close();
  }
}

// ============= HELPERS =============

function mapProspectFromNeo4j(prospect: Record<string, unknown>): Prospect {
  const customAttributes = typeof prospect.customAttributes === "string"
    ? (() => {
      try {
        const value = JSON.parse(prospect.customAttributes);
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch {
        return {};
      }
    })()
    : (prospect.customAttributes as Prospect["customAttributes"]) ?? {};
  return {
    id: prospect.id as string,
    name: prospect.name as string,
    company: prospect.company as string | undefined,
    title: prospect.title as string | undefined,
    location: prospect.location as string | undefined,
    photoUrl: prospect.photoUrl as string | undefined,
    email: prospect.email as string | undefined,
    phone: prospect.phone as string | undefined,
    linkedinUrl: prospect.linkedinUrl as string | undefined,
    twitterUrl: prospect.twitterUrl as string | undefined,
    youtubeUrl: prospect.youtubeUrl as string | undefined,
    instagramUrl: prospect.instagramUrl as string | undefined,
    facebookUrl: prospect.facebookUrl as string | undefined,
    websiteUrl: prospect.websiteUrl as string | undefined,
    status: prospect.status as Prospect['status'],
    source: prospect.source as Prospect['source'],
    sourceProvider: prospect.sourceProvider as string | undefined,
    nameWasDerived: Boolean(prospect.nameWasDerived),
    priority: prospect.priority as Prospect['priority'],
    tags: (prospect.tags as string[]) ?? [],
    customAttributes,
    revision: typeof (prospect.revision as { toNumber?: () => number } | undefined)?.toNumber === "function"
      ? (prospect.revision as { toNumber: () => number }).toNumber()
      : Number(prospect.revision ?? 0),
    about: prospect.about as string | undefined,
    // notes are fetched separately as ProspectNote[] via relationship
    referredBy: prospect.referredBy as string | undefined,
    createdAt: prospect.createdAt?.toString() ?? new Date().toISOString(),
    updatedAt: prospect.updatedAt?.toString() ?? new Date().toISOString(),
    lastContactedAt: prospect.lastContactedAt?.toString(),
  };
}

// ============= OUTREACH MESSAGES CRUD =============

export async function createOutreachMessage(
  data: CreateOutreachInput
): Promise<OutreachMessage> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})
      CREATE (m:OutreachMessage {
        id: randomUUID(),
        prospectId: $prospectId,
        medium: $medium,
        subject: $subject,
        content: $content,
        targetContent: $targetContent,
        landingPageUrl: $landingPageUrl,
        landingPageSlug: $landingPageSlug,
        reportId: $reportId,
        linkedContentId: $linkedContentId,
        linkedContentUrl: $linkedContentUrl,
        status: $status,
        createdAt: localdatetime(),
        updatedAt: localdatetime(),
        sentAt: null
      })
      CREATE (l)-[:HAS_OUTREACH]->(m)
      RETURN m
      `,
      {
        prospectId: data.prospectId,
        medium: data.medium,
        subject: data.subject ?? null,
        content: data.content,
        targetContent: data.targetContent ?? null,
        landingPageUrl: data.landingPageUrl ?? null,
        landingPageSlug: data.landingPageSlug ?? null,
        reportId: data.reportId ?? null,
        linkedContentId: data.linkedContentId ?? null,
        linkedContentUrl: data.linkedContentUrl ?? null,
        status: data.status ?? 'draft',
      }
    );

    const record = result.records[0];
    const message = record.get('m').properties;

    return mapOutreachFromNeo4j(message);
  } finally {
    await session.close();
  }
}

export async function getProspectOutreach(
  prospectId: string
): Promise<OutreachMessage[]> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_OUTREACH]->(m:OutreachMessage)
      RETURN m
      ORDER BY m.createdAt DESC
      `,
      { prospectId }
    );

    return result.records.map((record) => {
      const message = record.get('m').properties;
      return mapOutreachFromNeo4j(message);
    });
  } finally {
    await session.close();
  }
}

export async function getOutreachMessages(input?: {
  status?: OutreachMessage["status"];
  limit?: number;
}): Promise<OutreachMessageWithProspect[]> {
  const session = await getSession();
  const limit = Math.min(500, Math.max(1, input?.limit ?? 200));

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect)-[:HAS_OUTREACH]->(m:OutreachMessage)
      WHERE $status IS NULL OR m.status = $status
      RETURN l, m
      ORDER BY coalesce(m.updatedAt, m.createdAt) DESC
      LIMIT $limit
      `,
      {
        status: input?.status ?? null,
        limit,
      },
    );

    return result.records.map((record) => {
      const prospect = mapProspectFromNeo4j(record.get("l").properties);
      return {
        message: mapOutreachFromNeo4j(record.get("m").properties),
        prospect: {
          id: prospect.id,
          name: prospect.name,
          company: prospect.company,
          title: prospect.title,
          email: prospect.email,
        },
      };
    });
  } finally {
    await session.close();
  }
}

export async function getOutreachMessageCounts(): Promise<{
  total: number;
  byStatus: Record<string, number>;
}> {
  const session = await getSession();
  try {
    const result = await session.run(
      `
      MATCH (:Prospect)-[:HAS_OUTREACH]->(m:OutreachMessage)
      RETURN m.status AS status, count(m) AS count
      `,
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const record of result.records) {
      const rawCount = record.get("count");
      const count = typeof rawCount?.toNumber === "function"
        ? rawCount.toNumber()
        : Number(rawCount ?? 0);
      const status = String(record.get("status") ?? "draft");
      byStatus[status] = count;
      total += count;
    }
    return { total, byStatus };
  } finally {
    await session.close();
  }
}

export async function getOutreachById(
  messageId: string
): Promise<OutreachMessage | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (m:OutreachMessage {id: $messageId})
      RETURN m
      `,
      { messageId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const message = result.records[0].get('m').properties;
    return mapOutreachFromNeo4j(message);
  } finally {
    await session.close();
  }
}

export async function updateOutreachMessage(
  messageId: string,
  data: UpdateOutreachInput
): Promise<OutreachMessage | null> {
  const session = await getSession();

  try {
    const setClauses: string[] = ['m.updatedAt = localdatetime()'];
    const params: Record<string, unknown> = {
      messageId,
      recordSentActivity: false,
      sentActivityMetadata: null,
    };

    if (data.subject !== undefined) {
      setClauses.push('m.subject = $subject');
      params.subject = data.subject;
    }
    if (data.content !== undefined) {
      setClauses.push('m.content = $content');
      params.content = data.content;
    }
    if (data.targetContent !== undefined) {
      setClauses.push('m.targetContent = $targetContent');
      params.targetContent = data.targetContent;
    }
    if (data.status !== undefined) {
      setClauses.push('m.status = $status');
      params.status = data.status;
      // If marking as sent, set sentAt timestamp
      if (data.status === 'sent') {
        setClauses.push('m.sentAt = localdatetime()');
        params.recordSentActivity = true;
        params.sentActivityMetadata = JSON.stringify({ outreachMessageId: messageId });
      }
    }

    const result = await session.run(
      `
      MATCH (l:Prospect)-[:HAS_OUTREACH]->(m:OutreachMessage {id: $messageId})
      WITH l, m, m.status AS previousStatus
      SET ${setClauses.join(', ')}
      FOREACH (_ IN CASE WHEN $recordSentActivity AND previousStatus <> 'sent' THEN [1] ELSE [] END |
        CREATE (a:ProspectActivity {
          id: randomUUID(),
          prospectId: l.id,
          type: 'outreach_sent',
          title: CASE WHEN m.subject IS NOT NULL AND m.subject <> '' THEN 'Sent: ' + m.subject ELSE 'Sent ' + m.medium END,
          notes: m.content,
          metadata: $sentActivityMetadata,
          createdAt: localdatetime(),
          updatedAt: localdatetime()
        })
        CREATE (l)-[:HAS_ACTIVITY]->(a)
      )
      RETURN m
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    const message = result.records[0].get('m').properties;
    const mapped = mapOutreachFromNeo4j(message);
    if (data.status === 'sent') {
      // One emitter for outreach.sent: both the PATCH route and the MCP
      // outreach.message.update tool flip status through this function.
      // Organization resolves from the graph boundary already established for
      // getSession(). Re-flipping to 'sent' re-emits (each flip is a fresh
      // send intent); enqueueEventRuns dedupes per event id, not per message.
      emitProductEventFromContext({
        name: 'outreach.sent',
        refs: { prospectId: mapped.prospectId },
        payload: { messageId: mapped.id, medium: mapped.medium },
      });
    }
    return mapped;
  } finally {
    await session.close();
  }
}

export async function deleteOutreachMessage(messageId: string): Promise<boolean> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (m:OutreachMessage {id: $messageId})
      DETACH DELETE m
      RETURN count(m) as deleted
      `,
      { messageId }
    );

    const deleted = result.records[0]?.get('deleted')?.toNumber() ?? 0;
    return deleted > 0;
  } finally {
    await session.close();
  }
}

function mapOutreachFromNeo4j(message: Record<string, unknown>): OutreachMessage {
  return {
    id: message.id as string,
    prospectId: message.prospectId as string,
    medium: message.medium as OutreachMessage['medium'],
    subject: message.subject as string | undefined,
    content: message.content as string,
    targetContent: message.targetContent as string | undefined,
    landingPageUrl: message.landingPageUrl as string | undefined,
    landingPageSlug: message.landingPageSlug as string | undefined,
    reportId: message.reportId as string | undefined,
    linkedContentId: message.linkedContentId as string | undefined,
    linkedContentUrl: message.linkedContentUrl as string | undefined,
    status: message.status as OutreachMessage['status'],
    createdAt: message.createdAt?.toString() ?? new Date().toISOString(),
    updatedAt: message.updatedAt?.toString() ?? new Date().toISOString(),
    sentAt: message.sentAt?.toString(),
  };
}

// ============= PROSPECT RESEARCH =============

export async function getProspectResearch(
  prospectId: string
): Promise<ProspectResearch | null> {
  const session = await getSession();

  try {
    // Get prospect research with related insights and competitors
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_RESEARCH]->(r:ProspectResearch)
      OPTIONAL MATCH (r)-[:HAS_INSIGHT]->(i:CompanyInsight)
      OPTIONAL MATCH (r)-[:HAS_COMPETITOR]->(c:Competitor)
      RETURN r,
             collect(DISTINCT i) as insights,
             collect(DISTINCT c) as competitors
      `,
      { prospectId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    const research = record.get('r')?.properties;

    if (!research) {
      return null;
    }

    const insightNodes = record.get('insights') as Array<{ properties: Record<string, unknown> }>;
    const competitorNodes = record.get('competitors') as Array<{ properties: Record<string, unknown> }>;

    const companyInsights: CompanyInsight[] = insightNodes
      .filter((n) => n && n.properties)
      .map((n) => ({
        id: n.properties.id as string,
        category: n.properties.category as CompanyInsight['category'],
        content: n.properties.content as string,
        sourceUrl: n.properties.sourceUrl as string | undefined,
        createdAt: n.properties.createdAt?.toString() ?? new Date().toISOString(),
      }));

    const competitors: CompetitorInfo[] = competitorNodes
      .filter((n) => n && n.properties)
      .map((n) => ({
        name: n.properties.name as string,
        relevance: n.properties.relevance as string,
        aiFocus: n.properties.aiFocus as string | undefined,
        recentNews: n.properties.recentNews as string | undefined,
      }));

    // Handle talkingPoints which may be stored as a list or string
    let talkingPoints: string[] = [];
    if (research.talkingPoints) {
      if (Array.isArray(research.talkingPoints)) {
        talkingPoints = research.talkingPoints as string[];
      } else if (typeof research.talkingPoints === 'string') {
        talkingPoints = [research.talkingPoints];
      }
    }

    return {
      prospectId: research.prospectId as string,
      industry: research.industry as string,
      companySummary: research.companySummary as string,
      talkingPoints,
      outreachAngle: research.outreachAngle as string,
      companyInsights,
      competitors,
      updatedAt: research.updatedAt?.toString() ?? new Date().toISOString(),
    };
  } finally {
    await session.close();
  }
}

// ============= PROSPECT NOTES CRUD =============

export async function createProspectNote(
  prospectId: string,
  content: string
): Promise<ProspectNote> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})
      CREATE (n:ProspectNote {
        id: randomUUID(),
        content: $content,
        createdAt: localdatetime(),
        updatedAt: localdatetime()
      })
      CREATE (l)-[:HAS_NOTE]->(n)
      RETURN n
      `,
      { prospectId, content }
    );

    const record = result.records[0];
    const note = record.get('n').properties;

    return mapNoteFromNeo4j(note);
  } finally {
    await session.close();
  }
}

export async function getProspectNotes(prospectId: string): Promise<ProspectNote[]> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_NOTE]->(n:ProspectNote)
      RETURN n
      ORDER BY n.createdAt DESC
      `,
      { prospectId }
    );

    return result.records.map((record) => {
      const note = record.get('n').properties;
      return mapNoteFromNeo4j(note);
    });
  } finally {
    await session.close();
  }
}

export async function deleteProspectNote(noteId: string): Promise<boolean> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (n:ProspectNote {id: $noteId})
      DETACH DELETE n
      RETURN count(n) as deleted
      `,
      { noteId }
    );

    const deleted = result.records[0]?.get('deleted')?.toNumber() ?? 0;
    return deleted > 0;
  } finally {
    await session.close();
  }
}

function mapNoteFromNeo4j(note: Record<string, unknown>): ProspectNote {
  return {
    id: note.id as string,
    content: note.content as string,
    createdAt: note.createdAt?.toString() ?? new Date().toISOString(),
    updatedAt: note.updatedAt?.toString(),
  };
}

// ============= PROSPECT ACTIVITIES CRUD =============

export async function createProspectActivity(
  prospectId: string,
  data: CreateActivityInput
): Promise<ProspectActivity> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})
      CREATE (a:ProspectActivity {
        id: randomUUID(),
        prospectId: $prospectId,
        type: $type,
        title: $title,
        notes: $notes,
        metadata: $metadata,
        createdAt: localdatetime(),
        updatedAt: localdatetime()
      })
      CREATE (l)-[:HAS_ACTIVITY]->(a)
      RETURN a
      `,
      {
        prospectId,
        type: data.type,
        title: data.title,
        notes: data.notes ?? null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
      }
    );

    const record = result.records[0];
    const activity = record.get('a').properties;

    if (data.type === 'reply_received') {
      // One emitter for prospect.replied (spec §7): every path that records a reply
      // — the activities POST route today, an inbox integration later — writes
      // it through this function.
      emitProductEventFromContext({ name: 'prospect.replied', refs: { prospectId } });
    }

    return mapActivityFromNeo4j(activity);
  } finally {
    await session.close();
  }
}

export async function getProspectActivities(prospectId: string): Promise<ProspectActivity[]> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_ACTIVITY]->(a:ProspectActivity)
      RETURN a
      ORDER BY a.createdAt DESC
      `,
      { prospectId }
    );

    return result.records.map((record) => {
      const activity = record.get('a').properties;
      return mapActivityFromNeo4j(activity);
    });
  } finally {
    await session.close();
  }
}

export async function getActivityById(activityId: string): Promise<ProspectActivity | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (a:ProspectActivity {id: $activityId})
      RETURN a
      `,
      { activityId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const activity = result.records[0].get('a').properties;
    return mapActivityFromNeo4j(activity);
  } finally {
    await session.close();
  }
}

export async function updateProspectActivity(
  activityId: string,
  data: UpdateActivityInput
): Promise<ProspectActivity | null> {
  const session = await getSession();

  try {
    const setClauses: string[] = ['a.updatedAt = localdatetime()'];
    const params: Record<string, unknown> = { activityId };

    if (data.title !== undefined) {
      setClauses.push('a.title = $title');
      params.title = data.title;
    }
    if (data.notes !== undefined) {
      setClauses.push('a.notes = $notes');
      params.notes = data.notes;
    }
    if (data.metadata !== undefined) {
      setClauses.push('a.metadata = $metadata');
      params.metadata = JSON.stringify(data.metadata);
    }

    const result = await session.run(
      `
      MATCH (a:ProspectActivity {id: $activityId})
      SET ${setClauses.join(', ')}
      RETURN a
      `,
      params
    );

    if (result.records.length === 0) {
      return null;
    }

    const activity = result.records[0].get('a').properties;
    return mapActivityFromNeo4j(activity);
  } finally {
    await session.close();
  }
}

export async function deleteProspectActivity(activityId: string): Promise<boolean> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (a:ProspectActivity {id: $activityId})
      DETACH DELETE a
      RETURN count(a) as deleted
      `,
      { activityId }
    );

    const deleted = result.records[0]?.get('deleted')?.toNumber() ?? 0;
    return deleted > 0;
  } finally {
    await session.close();
  }
}

function mapActivityFromNeo4j(activity: Record<string, unknown>): ProspectActivity {
  let metadata: ProspectActivity['metadata'] | undefined;
  if (activity.metadata) {
    try {
      metadata = typeof activity.metadata === 'string'
        ? JSON.parse(activity.metadata)
        : activity.metadata;
    } catch {
      metadata = undefined;
    }
  }

  return {
    id: activity.id as string,
    prospectId: activity.prospectId as string,
    type: activity.type as ProspectActivityType,
    title: activity.title as string,
    notes: activity.notes as string | undefined,
    metadata,
    createdAt: activity.createdAt?.toString() ?? new Date().toISOString(),
    updatedAt: activity.updatedAt?.toString(),
  };
}

// ============= PROSPECT QUALIFICATION =============

/**
 * Create a qualification result for a prospect
 */
export async function createLegacyQualification(
  prospectId: string,
  data: CreateQualificationInput
): Promise<LegacyQualification> {
  const session = await getSession();

  try {
    // First, delete any existing qualification for this prospect
    await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_QUALIFICATION]->(q:LegacyQualification)
      DETACH DELETE q
      `,
      { prospectId }
    );

    // Create new qualification
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})
      CREATE (q:LegacyQualification {
        id: randomUUID(),
        prospectId: $prospectId,
        matchedPersonaId: $matchedPersonaId,
        matchedPersonaName: $matchedPersonaName,
        score: $score,
        notes: $notes,
        qualifiedAt: localdatetime()
      })
      CREATE (l)-[:HAS_QUALIFICATION]->(q)
      RETURN q
      `,
      {
        prospectId,
        matchedPersonaId: data.matchedPersonaId,
        matchedPersonaName: data.matchedPersonaName,
        score: data.score,
        notes: data.notes,
      }
    );

    const record = result.records[0];
    const qualification = record.get('q').properties;

    return mapQualificationFromNeo4j(qualification);
  } finally {
    await session.close();
  }
}

/**
 * Get the latest qualification for a prospect
 */
export async function getLegacyQualification(
  prospectId: string
): Promise<LegacyQualification | null> {
  const session = await getSession();

  try {
    const result = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_QUALIFICATION]->(q:LegacyQualification)
      RETURN q
      ORDER BY q.qualifiedAt DESC
      LIMIT 1
      `,
      { prospectId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const qualification = result.records[0].get('q').properties;
    return mapQualificationFromNeo4j(qualification);
  } finally {
    await session.close();
  }
}

/**
 * Update prospect priority based on qualification score
 * Score thresholds: 80+ = high, 50-79 = medium, <50 = low
 */
export async function updateProspectPriorityByScore(
  prospectId: string,
  score: number
): Promise<Prospect | null> {
  let priority: ProspectPriority;
  if (score >= 80) {
    priority = 'high';
  } else if (score >= 50) {
    priority = 'medium';
  } else {
    priority = 'low';
  }

  return updateProspect(prospectId, { priority });
}

function mapQualificationFromNeo4j(q: Record<string, unknown>): LegacyQualification {
  return {
    id: q.id as string,
    prospectId: q.prospectId as string,
    matchedPersonaId: q.matchedPersonaId as string,
    matchedPersonaName: q.matchedPersonaName as string,
    score: typeof q.score === 'object' && q.score !== null
      ? (q.score as { low: number }).low
      : (q.score as number),
    notes: q.notes as string,
    qualifiedAt: q.qualifiedAt?.toString() ?? new Date().toISOString(),
  };
}

// ============= STORE PROSPECT RESEARCH (from Vercel AI SDK) =============

export interface StoreProspectResearchInput {
  industry: string;
  companySummary: string;
  companyInsights: Array<{
    category: 'overview' | 'products' | 'culture' | 'recent_news' | 'ai_initiatives';
    content: string;
    sourceUrl?: string;
  }>;
  competitors: Array<{
    name: string;
    relevance: string;
    aiFocus?: string;
  }>;
  talkingPoints: string[];
  outreachAngle: string;
}

/**
 * Store prospect research results from Vercel AI SDK streaming.
 * Creates or updates ProspectResearch node with child CompanyInsight and Competitor nodes.
 */
export async function storeProspectResearch(
  prospectId: string,
  research: StoreProspectResearchInput
): Promise<ProspectResearch> {
  const session = await getSession();

  try {
    // First, delete existing research data for this prospect
    await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})-[:HAS_RESEARCH]->(r:ProspectResearch)
      OPTIONAL MATCH (r)-[:HAS_INSIGHT]->(i:CompanyInsight)
      OPTIONAL MATCH (r)-[:HAS_COMPETITOR]->(c:Competitor)
      DETACH DELETE i, c, r
      `,
      { prospectId }
    );

    // Create the main ProspectResearch node
    const researchResult = await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})
      CREATE (r:ProspectResearch {
        prospectId: $prospectId,
        industry: $industry,
        companySummary: $companySummary,
        talkingPoints: $talkingPoints,
        outreachAngle: $outreachAngle,
        createdAt: localdatetime(),
        updatedAt: localdatetime()
      })
      CREATE (l)-[:HAS_RESEARCH]->(r)
      SET l.status = 'researched', l.updatedAt = localdatetime()
      RETURN r
      `,
      {
        prospectId,
        industry: research.industry,
        companySummary: research.companySummary,
        talkingPoints: research.talkingPoints,
        outreachAngle: research.outreachAngle,
      }
    );

    if (researchResult.records.length === 0) {
      throw new Error(`Prospect not found: ${prospectId}`);
    }

    // Create CompanyInsight nodes using UNWIND for batch insert
    if (research.companyInsights.length > 0) {
      await session.run(
        `
        MATCH (l:Prospect {id: $prospectId})-[:HAS_RESEARCH]->(r:ProspectResearch)
        UNWIND $insights AS insight
        CREATE (i:CompanyInsight {
          id: randomUUID(),
          category: insight.category,
          content: insight.content,
          sourceUrl: insight.sourceUrl,
          createdAt: localdatetime()
        })
        CREATE (r)-[:HAS_INSIGHT]->(i)
        `,
        {
          prospectId,
          insights: research.companyInsights.map((insight) => ({
            category: insight.category,
            content: insight.content,
            sourceUrl: insight.sourceUrl ?? null,
          })),
        }
      );
    }

    // Create Competitor nodes using UNWIND for batch insert
    if (research.competitors.length > 0) {
      await session.run(
        `
        MATCH (l:Prospect {id: $prospectId})-[:HAS_RESEARCH]->(r:ProspectResearch)
        UNWIND $competitors AS competitor
        MERGE (c:Competitor {name: competitor.name})
        SET c.relevance = competitor.relevance,
            c.aiFocus = competitor.aiFocus,
            c.updatedAt = localdatetime()
        MERGE (r)-[:HAS_COMPETITOR]->(c)
        `,
        {
          prospectId,
          competitors: research.competitors.map((competitor) => ({
            name: competitor.name,
            relevance: competitor.relevance,
            aiFocus: competitor.aiFocus ?? null,
          })),
        }
      );
    }

    // Log the activity
    await session.run(
      `
      MATCH (l:Prospect {id: $prospectId})
      CREATE (a:ProspectActivity {
        id: randomUUID(),
        prospectId: $prospectId,
        type: 'research_completed',
        title: 'Research completed',
        description: $description,
        createdAt: localdatetime()
      })
      CREATE (l)-[:HAS_ACTIVITY]->(a)
      `,
      {
        prospectId,
        description: `AI research completed. Industry: ${research.industry}. Found ${research.companyInsights.length} insights and ${research.competitors.length} competitors.`,
      }
    );

    // Fetch and return the complete research
    const fullResearch = await getProspectResearch(prospectId);
    if (!fullResearch) {
      throw new Error('Failed to retrieve stored research');
    }

    return fullResearch;
  } finally {
    await session.close();
  }
}
