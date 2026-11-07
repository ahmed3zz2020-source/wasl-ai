// ============================================================
// WASL AI — FOUNDATION BUILD 01 — tenant identity mirror
// ------------------------------------------------------------
// ⭐ The database is the source of truth for who exists and with
//   which role. This module mirrors that state into the core's own
//   LocalIdentityRegistry, so the core keeps deciding.
// ⭐ The mirror is rebuilt whenever the membership set or a role
//   changes, which is what makes a role change effective on the very
//   next request (no stale role can survive).
// ⛔ The mirror never grants a role by itself: the role comes from
//   the membership row, and the core still checks the capability.
// ============================================================

import {
  LocalIdentityRegistry,
  createLocalIdentitySources,
  type LocalIdentitySources,
  type TrustedRole,
} from '../../src/core/index.ts';
import { issueIdentityAdminAuthority } from '../../src/core/identity.ts';

export interface MembershipRow {
  readonly membership_id: string;
  readonly user_id: string;
  readonly role: TrustedRole;
  readonly status: string;
  readonly expires_at?: string | null;
}

export interface TenantIdentityMirror {
  readonly tenantId: string;
  readonly registry: LocalIdentityRegistry;
  readonly sources: LocalIdentitySources;
  readonly ownerMembershipId: string;
  readonly signature: string;
}

export function membershipSignature(tenantId: string, rows: readonly MembershipRow[]): string {
  return rows
    .map((row) => `${row.membership_id}:${row.role}:${row.status}`)
    .sort()
    .join('|') + `#${tenantId}`;
}

/**
 * ⭐ Build (or rebuild) the mirror for one tenant.
 * ⭐ The first registered identity must be the owner (core rule), so
 *   the owner is registered first and then issues the authority for
 *   the rest of the tenant members.
 */
export function buildMirror(
  tenantId: string,
  rows: readonly MembershipRow[],
): TenantIdentityMirror | null {
  const owner = rows.find((row) => row.role === 'owner' && row.status === 'active');
  if (!owner) return null;

  const registry = new LocalIdentityRegistry();
  // The authority must be issued by the core (a forged object is refused
  // by the core itself), and it is issued for the owner of this tenant.
  const authority = issueIdentityAdminAuthority({
    identity_id: owner.membership_id,
    tenant_id: tenantId,
    actor_id: owner.user_id,
    role: 'owner',
    status: 'active',
    expires_at: owner.expires_at ?? null,
  });
  registry.register(
    {
      identity_id: owner.membership_id,
      tenant_id: tenantId,
      actor_id: owner.user_id,
      role: 'owner',
      expires_at: owner.expires_at ?? null,
    },
    authority,
  );

  for (const row of rows) {
    if (row.membership_id === owner.membership_id) continue;
    if (row.status !== 'active') continue;
    try {
      registry.register(
        {
          identity_id: row.membership_id,
          tenant_id: tenantId,
          actor_id: row.user_id,
          role: row.role,
          expires_at: row.expires_at ?? null,
        },
        authority,
      );
    } catch {
      // A rejected registration means the row is not usable as an
      // identity (bad shape or expired). It simply stays unknown.
    }
  }

  const sources = createLocalIdentitySources(registry);
  return {
    tenantId,
    registry,
    sources,
    ownerMembershipId: owner.membership_id,
    signature: membershipSignature(tenantId, rows),
  };
}
