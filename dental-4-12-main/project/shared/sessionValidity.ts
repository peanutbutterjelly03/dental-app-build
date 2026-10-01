// SEC-12: the one rule for "has this token been revoked?".
//
// A User carries `sessions_valid_from`, stamped by logout, change-password and
// both reset paths. A token issued BEFORE that instant is dead. JWTs record
// their issue time (`iat`) in whole SECONDS, so the cutoff is floored to the
// second too — otherwise a token minted in the same second as the stamp (the
// fresh session changePassword hands back) would compare as older than it.
//
// Fails CLOSED: a token with no `iat` cannot be shown to postdate a cutoff, so
// once a cutoff exists it is treated as revoked. jsonwebtoken always sets
// `iat`, so this only ever bites a token that was not minted by this server.

export function isRevoked(iatSeconds: number | undefined, validFrom: Date | null | undefined): boolean {
  if (!validFrom) return false;
  if (typeof iatSeconds !== 'number') return true;
  return iatSeconds < Math.floor(validFrom.getTime() / 1000);
}
