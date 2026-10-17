import { describe, expect, it } from "vitest";
import { plainHttpCaution } from "./plainHttpCaution";

const at = (protocol: string, hostname: string) => ({ protocol, hostname });

describe("plainHttpCaution (#306)", () => {
  it("cautions when the console is reached over http: on a name or address that is not loopback", () => {
    for (const hostname of ["192.168.1.5", "podium.lan", "10.0.0.2", "[fe80::1]"]) {
      expect(plainHttpCaution(at("http:", hostname)), hostname).toMatch(/plain HTTP/);
    }
  });

  it("says nothing on loopback or over https:", () => {
    for (const hostname of ["localhost", "127.0.0.1", "127.4.5.6", "[::1]", "::1"]) {
      expect(plainHttpCaution(at("http:", hostname)), hostname).toBe("");
    }
    expect(plainHttpCaution(at("https:", "podium.example"))).toBe("");
  });

  it("names what travels unencrypted and the fix", () => {
    const text = plainHttpCaution(at("http:", "podium.lan"));
    expect(text).toMatch(/name, token and cookie/);
    expect(text).toMatch(/TLS/);
  });
});
