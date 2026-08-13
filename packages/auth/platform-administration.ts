import {
  account,
  member,
  organization,
  organization_entitlement as organizationEntitlement,
  organization_subscription as organizationSubscription,
  session,
  user,
} from '@content-automation/database'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { provisionCommercialOrganization } from '@content-automation/platform/commercial'
import { authDatabase } from './database'
import { roleDefinitions, type ProductId, type RoleName } from './permissions'
import { auth } from './server'

export type PlatformUserSummary = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  role: string
  membershipId: string
  createdAt: string
}

export type CustomerWorkspaceSummary = {
  id: string
  name: string
  slug: string
  createdAt: string
  products: string[]
  subscription: {
    planId: string
    status: string
    seatCount: number
    periodEnd: string
  } | null
  users: PlatformUserSummary[]
}

type PlatformUserInput = {
  name: string
  email: string
  temporaryPassword: string
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase()
}

function assertPassword(value: string): void {
  if (value.length < 12 || value.length > 128) {
    throw new Error('Temporary passwords must contain 12–128 characters.')
  }
}

async function hashedPassword(password: string): Promise<string> {
  assertPassword(password)
  const context = await auth.$context
  return context.password.hash(password)
}

async function findUserByEmail(email: string) {
  const [existing] = await authDatabase
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.email, normalizedEmail(email)))
    .limit(1)
  return existing ?? null
}

export async function listCustomerWorkspaces(): Promise<CustomerWorkspaceSummary[]> {
  const workspaces = await authDatabase
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .orderBy(asc(organization.name))

  if (workspaces.length === 0) return []
  const organizationIds = workspaces.map((workspace) => workspace.id)
  const [memberships, entitlements, subscriptions] = await Promise.all([
    authDatabase
      .select({
        organizationId: member.organizationId,
        membershipId: member.id,
        role: member.role,
        membershipCreatedAt: member.createdAt,
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(inArray(member.organizationId, organizationIds))
      .orderBy(asc(user.name)),
    authDatabase
      .select({
        organizationId: organizationEntitlement.organization_id,
        product: organizationEntitlement.product,
      })
      .from(organizationEntitlement)
      .where(
        and(
          inArray(organizationEntitlement.organization_id, organizationIds),
          eq(organizationEntitlement.enabled, true),
        ),
      ),
    authDatabase
      .select({
        organizationId: organizationSubscription.organization_id,
        planId: organizationSubscription.plan_id,
        status: organizationSubscription.status,
        seatCount: organizationSubscription.seat_count,
        periodEnd: organizationSubscription.period_end,
      })
      .from(organizationSubscription)
      .where(inArray(organizationSubscription.organization_id, organizationIds)),
  ])

  return workspaces.map((workspace) => {
    const subscription = subscriptions.find((entry) => entry.organizationId === workspace.id)
    return {
      ...workspace,
      products: entitlements
        .filter((entry) => entry.organizationId === workspace.id)
        .map((entry) => entry.product),
      subscription: subscription
        ? {
            planId: subscription.planId,
            status: subscription.status,
            seatCount: subscription.seatCount,
            periodEnd: subscription.periodEnd,
          }
        : null,
      users: memberships
        .filter((entry) => entry.organizationId === workspace.id)
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          email: entry.email,
          emailVerified: entry.emailVerified,
          role: entry.role,
          membershipId: entry.membershipId,
          createdAt: entry.membershipCreatedAt,
        })),
    }
  })
}

async function createPlatformUser(input: PlatformUserInput) {
  const email = normalizedEmail(input.email)
  const existing = await findUserByEmail(email)
  if (existing) return { ...existing, created: false }

  const password = await hashedPassword(input.temporaryPassword)
  const now = new Date().toISOString()
  const userId = crypto.randomUUID()
  try {
    await authDatabase.transaction(async (tx) => {
      await tx.insert(user).values({
        id: userId,
        name: input.name.trim(),
        email,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      })
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: 'credential',
        userId,
        password,
        createdAt: now,
        updatedAt: now,
      })
    })
  } catch (error) {
    // Another administrator may have created the same identity between the
    // lookup and insert. Reuse that native identity instead of duplicating it.
    const racedUser = await findUserByEmail(email)
    if (racedUser) return { ...racedUser, created: false }
    throw error
  }
  return { id: userId, name: input.name.trim(), email, created: true }
}

export async function createCustomerWorkspace(input: {
  name: string
  slug: string
  owner: PlatformUserInput
  products: ProductId[]
}) {
  const existingWorkspace = await authDatabase
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, input.slug))
    .limit(1)
  if (existingWorkspace.length > 0) throw new Error('That workspace slug is already in use.')

  const owner = await createPlatformUser(input.owner)
  const now = new Date().toISOString()
  const workspaceId = crypto.randomUUID()
  const membershipId = crypto.randomUUID()
  try {
    await authDatabase.transaction(async (tx) => {
      await tx.insert(organization).values({
        id: workspaceId,
        name: input.name.trim(),
        slug: input.slug,
        createdAt: now,
      })
      await tx.insert(member).values({
        id: membershipId,
        organizationId: workspaceId,
        userId: owner.id,
        role: 'owner',
        createdAt: now,
      })
      if (input.products.length > 0) {
        await tx.insert(organizationEntitlement).values(
          [...new Set(input.products)].map((product) => ({
            organization_id: workspaceId,
            product,
            enabled: true,
          })),
        )
      }
    })
  } catch (error) {
    if (owner.created) await authDatabase.delete(user).where(eq(user.id, owner.id))
    throw error
  }

  try {
    await provisionCommercialOrganization(workspaceId, owner.id)
  } catch (error) {
    // Commercial provisioning uses the same PostgreSQL database through a
    // separate connection, so compensate explicitly if it cannot complete.
    // Organization-linked commerce, membership, and entitlement records
    // cascade from this delete.
    try {
      await authDatabase.transaction(async (tx) => {
        await tx.delete(organization).where(eq(organization.id, workspaceId))
        if (owner.created) await tx.delete(user).where(eq(user.id, owner.id))
      })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Workspace provisioning failed and automatic cleanup was incomplete.',
      )
    }
    throw error
  }
  return {
    workspaceId,
    ownerUserId: owner.id,
    ownerMembershipId: membershipId,
    ownerCreated: owner.created,
  }
}

export async function updateCustomerWorkspace(input: {
  organizationId: string
  name: string
  slug: string
  products: ProductId[]
}) {
  const products = [...new Set(input.products)]
  await authDatabase.transaction(async (tx) => {
    const updated = await tx
      .update(organization)
      .set({ name: input.name.trim(), slug: input.slug })
      .where(eq(organization.id, input.organizationId))
      .returning({ id: organization.id })
    if (updated.length === 0) throw new Error('Customer workspace not found.')
    await tx
      .delete(organizationEntitlement)
      .where(eq(organizationEntitlement.organization_id, input.organizationId))
    if (products.length > 0) {
      await tx.insert(organizationEntitlement).values(
        products.map((product) => ({
          organization_id: input.organizationId,
          product,
          enabled: true,
        })),
      )
    }
  })
  return { workspaceId: input.organizationId }
}

export async function deleteCustomerWorkspace(organizationId: string) {
  await authDatabase.transaction(async (tx) => {
    const memberships = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, organizationId))
    const deleted = await tx
      .delete(organization)
      .where(eq(organization.id, organizationId))
      .returning({ id: organization.id })
    if (deleted.length === 0) throw new Error('Customer workspace not found.')
    for (const membership of memberships) {
      const remaining = await tx
        .select({ id: member.id })
        .from(member)
        .where(eq(member.userId, membership.userId))
        .limit(1)
      if (remaining.length === 0) await tx.delete(user).where(eq(user.id, membership.userId))
    }
  })
  return { workspaceId: organizationId }
}

export async function addPlatformUserToWorkspace(input: {
  organizationId: string
  role: RoleName
  user: PlatformUserInput
}) {
  if (!roleDefinitions.some((role) => role.id === input.role)) {
    throw new Error('Unknown platform role.')
  }
  const [workspace] = await authDatabase
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, input.organizationId))
    .limit(1)
  if (!workspace) throw new Error('Customer workspace not found.')

  const platformUser = await createPlatformUser(input.user)
  const existingMembership = await authDatabase
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, input.organizationId),
        eq(member.userId, platformUser.id),
      ),
    )
    .limit(1)
  if (existingMembership.length > 0) {
    throw new Error('That platform user already belongs to this workspace.')
  }

  const membershipId = crypto.randomUUID()
  try {
    await authDatabase.insert(member).values({
      id: membershipId,
      organizationId: input.organizationId,
      userId: platformUser.id,
      role: input.role,
      createdAt: new Date().toISOString(),
    })
  } catch (error) {
    if (platformUser.created) await authDatabase.delete(user).where(eq(user.id, platformUser.id))
    throw error
  }
  return { membershipId, userId: platformUser.id, userCreated: platformUser.created }
}

export async function resetPlatformUserPassword(userId: string, temporaryPassword: string) {
  const password = await hashedPassword(temporaryPassword)
  const updated = await authDatabase.transaction(async (tx) => {
    const credentials = await tx
      .update(account)
      .set({ password, updatedAt: sql`now()` })
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
      .returning({ id: account.id })
    if (credentials.length > 0) await tx.delete(session).where(eq(session.userId, userId))
    return credentials
  })
  if (updated.length === 0) throw new Error('No credential account exists for that platform user.')
  return { userId }
}

export async function updatePlatformUser(input: {
  organizationId: string
  membershipId: string
  userId: string
  name: string
  email: string
  role: RoleName
  temporaryPassword?: string
}) {
  if (!roleDefinitions.some((role) => role.id === input.role)) {
    throw new Error('Unknown platform role.')
  }
  const [membership] = await authDatabase
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, input.membershipId),
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
      ),
    )
    .limit(1)
  if (!membership) throw new Error('Platform user membership not found.')
  if (membership.role === 'owner' && input.role !== 'owner') {
    const owners = await authDatabase
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, input.organizationId), eq(member.role, 'owner')))
      .limit(2)
    if (owners.length === 1) throw new Error('A workspace must retain at least one owner.')
  }

  const password = input.temporaryPassword
    ? await hashedPassword(input.temporaryPassword)
    : null
  await authDatabase.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        name: input.name.trim(),
        email: normalizedEmail(input.email),
        updatedAt: sql`now()`,
      })
      .where(eq(user.id, input.userId))
    await tx.update(member).set({ role: input.role }).where(eq(member.id, input.membershipId))
    if (password) {
      const credentials = await tx
        .update(account)
        .set({ password, updatedAt: sql`now()` })
        .where(and(eq(account.userId, input.userId), eq(account.providerId, 'credential')))
        .returning({ id: account.id })
      if (credentials.length === 0) {
        throw new Error('No credential account exists for that platform user.')
      }
      await tx.delete(session).where(eq(session.userId, input.userId))
    }
  })
  return { membershipId: input.membershipId, userId: input.userId }
}

export async function removePlatformUserFromWorkspace(input: {
  organizationId: string
  membershipId: string
  userId: string
}) {
  const [membership] = await authDatabase
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.id, input.membershipId),
        eq(member.organizationId, input.organizationId),
        eq(member.userId, input.userId),
      ),
    )
    .limit(1)
  if (!membership) throw new Error('Platform user membership not found.')
  if (membership.role === 'owner') {
    const owners = await authDatabase
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, input.organizationId), eq(member.role, 'owner')))
      .limit(2)
    if (owners.length === 1) throw new Error('A workspace must retain at least one owner.')
  }

  await authDatabase.transaction(async (tx) => {
    await tx.delete(member).where(eq(member.id, input.membershipId))
    const remaining = await tx
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, input.userId))
      .limit(1)
    if (remaining.length === 0) await tx.delete(user).where(eq(user.id, input.userId))
  })
  return { membershipId: input.membershipId, userId: input.userId }
}
