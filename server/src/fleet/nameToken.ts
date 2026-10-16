// The name-and-token check shared by the console's sign-in to respond and Admin's unlock (#206, #215): a person's token
// only with that person's name, the admin secret only with the name Admin (SPEC 7.7).
import { ADMIN_OWNER, nameKey, type PeopleStore, type PersonRow } from './people.js';
import { parsePersonToken, safeEqualStr, tokenMatches } from './tokens.js';

/** Who a name and token belong to: a person (not revoked), or the admin secret (`person` null). Null when they match nobody. */
export function checkNameToken(people: PeopleStore | null, secret: string | null, name: string, token: string): { person: PersonRow | null } | null {
  const parsed = parsePersonToken(token);
  if (parsed && people) {
    const p = people.findByKeyId(parsed.keyId);
    return p && p.revokedAt === null && tokenMatches(token, p.tokenHash) && nameKey(p.name) === nameKey(name) ? { person: p } : null;
  }
  return secret !== null && nameKey(name) === nameKey(ADMIN_OWNER) && safeEqualStr(secret, token) ? { person: null } : null;
}
