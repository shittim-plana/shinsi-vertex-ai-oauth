import type { UserRoles } from './roles';
import { isPrivileged } from './roles';

export const CHAR_DELETED = 'CHAR_DELETED';
export const CHAR_DELETED_WRITE_BLOCKED = 'CHAR_DELETED_WRITE_BLOCKED';

type CharacterLike = {
  isDeleted?: boolean;
};

/**
 * Read access guard for character visibility.
 * - Blocks non-privileged users when character.isDeleted === true
 * - Treats undefined/null as not-deleted (defensive)
 * - Keeps existing policy for privileged roles
 */
export function assertCharacterReadable(params: {
  requesterUid: string | null;
  roles: UserRoles;
  character: CharacterLike;
}): void {
  const { roles, character } = params;
  const isDel = character?.isDeleted === true;
  if (isDel && !isPrivileged(roles)) {
    throw Object.assign(new Error(CHAR_DELETED), {
      status: 404,
      code: CHAR_DELETED,
    });
  }
}

/**
 * Write access guard for character operations.
 * - Blocks non-privileged users when character.isDeleted === true
 * - allowDeleted=true permits privileged override only (policy unchanged)
 */
export function assertCharacterWritable(params: {
  requesterUid: string | null;
  roles: UserRoles;
  character: CharacterLike;
  allowDeleted?: boolean;
}): void {
  const { roles, character, allowDeleted = false } = params;
  const isDel = character?.isDeleted === true;

  if (isDel) {
    const privileged = isPrivileged(roles);
    if (!privileged || allowDeleted !== true) {
      throw Object.assign(new Error(CHAR_DELETED_WRITE_BLOCKED), {
        status: 403,
        code: CHAR_DELETED_WRITE_BLOCKED,
      });
    }
  }
}