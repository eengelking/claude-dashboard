const LOOPBACK = /^(localhost|\[?::1\]?|127(\.\d{1,3}){3})$/i;

/**
 * A caution for the Respond from Podium row when this console is reached over plain HTTP at an address that is not
 * loopback: the sign-in's name, token and cookie then cross the network unencrypted (#306). Empty when it does not apply.
 * It reads how this browser reached the server, so a TLS proxy in front silences it without any setting.
 */
export function plainHttpCaution(loc: { protocol: string; hostname: string } = window.location): string {
  if (loc.protocol !== "http:" || LOOPBACK.test(loc.hostname)) return "";
  return "This console is reached over plain HTTP, so the sign-in's name, token and cookie are not encrypted in transit. Put a TLS proxy in front of Podium.";
}
