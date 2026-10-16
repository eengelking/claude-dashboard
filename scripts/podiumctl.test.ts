import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bootUnitStale, containerRunArgs, launchdPlist, maskConfig, OWN_KEYS, parseArgs, parseEnvFile, PASSTHROUGH, resolveConfig, serializeEnv, serverEnv, systemdUnit,
// @ts-expect-error bin/podiumctl has no extension, so tsc cannot find it; vitest loads it as ESM
} from "../bin/podiumctl";

const BIN = path.join(__dirname, "..", "bin", "podiumctl");
function ctl(home: string, ...args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, PODIUMCTL_HOME: home } });
}

describe("podiumctl parsing", () => {
  it("splits command, args and flags", () => {
    expect(parseArgs(["logs", "-f", "--tail", "5", "--mode=standalone"])).toEqual({
      cmd: "logs", args: [], flags: { follow: true, tail: "5", mode: "standalone" },
    });
    expect(parseArgs(["config", "set", "A=b"]).args).toEqual(["set", "A=b"]);
    expect(() => parseArgs(["start", "--port"])).toThrow(/needs a value/);
  });

  it("round-trips the env file and keeps '=' inside values", () => {
    const obj = { PODIUM_TOKEN: "abc=def", PODIUMCTL_PORT: "4400" };
    expect(parseEnvFile(serializeEnv(obj))).toEqual(obj);
  });
});

describe("podiumctl config", () => {
  it("applies defaults, then file values, then flags", () => {
    expect(resolveConfig({}, {}, true)).toMatchObject({ mode: "container", port: 4317, bind: "127.0.0.1" });
    expect(resolveConfig({}, {}, false).mode).toBe("standalone");
    expect(resolveConfig({ PODIUMCTL_PORT: "5000" }, {}).port).toBe(5000);
    expect(resolveConfig({ PODIUMCTL_PORT: "5000" }, { port: "6000" }).port).toBe(6000);
  });

  it("rejects bad mode and port", () => {
    expect(() => resolveConfig({}, { mode: "docker" })).toThrow(/mode/);
    expect(() => resolveConfig({}, { port: "99999" })).toThrow(/port/);
  });

  it("keeps an empty token (auth off) distinct from no token", () => {
    expect(resolveConfig({ PODIUM_TOKEN: "" }).token).toBe("");
    expect(resolveConfig({}).token).toBeUndefined();
  });
});

describe("podiumctl config set and unset with several arguments (#156)", () => {
  const read = (home: string) => parseEnvFile(fs.readFileSync(path.join(home, "config.env"), "utf8")) as Record<string, string>;
  function withHome(body: (home: string) => void) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "podiumctl-"));
    try { body(home); } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }

  it("sets one pair", () => withHome((home) => {
    expect(ctl(home, "config", "set", "PODIUMCTL_PORT=4410").status).toBe(0);
    expect(read(home)).toEqual({ PODIUMCTL_PORT: "4410" });
  }));

  it("sets each pair when given two", () => withHome((home) => {
    const r = ctl(home, "config", "set", "PODIUM_LOG_FORMAT=json", "PODIUM_LOG_SHIP_URL=http://host:9428");
    expect(r.status).toBe(0);
    expect(read(home)).toEqual({ PODIUM_LOG_FORMAT: "json", PODIUM_LOG_SHIP_URL: "http://host:9428" });
  }));

  it("keeps '=' and spaces inside a quoted value", () => withHome((home) => {
    expect(ctl(home, "config", "set", "PODIUM_LOG_SHIP_HEADERS=Authorization=Basic a b==").status).toBe(0);
    expect(read(home)).toEqual({ PODIUM_LOG_SHIP_HEADERS: "Authorization=Basic a b==" });
  }));

  it("fails on an argument with no '=' and leaves the file unchanged", () => withHome((home) => {
    expect(ctl(home, "config", "set", "PODIUMCTL_PORT=4410").status).toBe(0);
    const before = fs.readFileSync(path.join(home, "config.env"), "utf8");
    const r = ctl(home, "config", "set", "PODIUM_LOG_FORMAT=json", "PODIUM_LOG_SHIP_URL");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage/);
    expect(fs.readFileSync(path.join(home, "config.env"), "utf8")).toBe(before);
  }));

  it("fails on one unknown key among several and leaves the file unchanged", () => withHome((home) => {
    const r = ctl(home, "config", "set", "PODIUM_LOG_FORMAT=json", "NOPE=1");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/unknown key "NOPE"/);
    expect(fs.existsSync(path.join(home, "config.env"))).toBe(false);
  }));

  it("fails with a usage message when no pair is given", () => withHome((home) => {
    const r = ctl(home, "config", "set");
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage/);
  }));

  it("unsets several keys", () => withHome((home) => {
    expect(ctl(home, "config", "set", "PODIUM_LOG_FORMAT=json", "PODIUMCTL_PORT=4410").status).toBe(0);
    expect(ctl(home, "config", "unset", "PODIUM_LOG_FORMAT", "PODIUMCTL_PORT").status).toBe(0);
    expect(read(home)).toEqual({});
  }));
});

describe("podiumctl with a retired ANTHROPIC_ADMIN_API_KEY left in the config", () => {
  function homeWithOldKey() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "podiumctl-"));
    fs.writeFileSync(path.join(home, "config.env"), "PODIUMCTL_PORT=4400\nANTHROPIC_ADMIN_API_KEY=sk-ant-admin-old\n");
    return home;
  }

  it("is ignored by the server settings", () => {
    const cfg = resolveConfig({ PODIUMCTL_PORT: "4400", ANTHROPIC_ADMIN_API_KEY: "sk-ant-admin-old" });
    expect(cfg.port).toBe(4400);
    expect(serverEnv(cfg, true)).not.toHaveProperty("ANTHROPIC_ADMIN_API_KEY");
  });

  it("still shows the config and lets the old key be unset", () => {
    const home = homeWithOldKey();
    try {
      expect(ctl(home, "config").status).toBe(0);
      const r = ctl(home, "config", "unset", "ANTHROPIC_ADMIN_API_KEY");
      expect(r.status).toBe(0);
      expect(fs.readFileSync(path.join(home, "config.env"), "utf8")).not.toContain("ANTHROPIC_ADMIN_API_KEY");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses to set the retired key again, and says why", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "podiumctl-"));
    try {
      const r = ctl(home, "config", "set", "ANTHROPIC_ADMIN_API_KEY=x");
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/no longer used/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("podiumctl command construction", () => {
  const cfg = resolveConfig({ PODIUM_TOKEN: "s3cret", STALE_AFTER_MS: "9000" }, { port: "4400" });

  it("never puts the token on the podman command line", () => {
    const env = serverEnv(cfg, true);
    const args = containerRunArgs(cfg, Object.keys(env));
    expect(args.join(" ")).not.toContain("s3cret");
    expect(args).toContain("PODIUM_TOKEN");
    expect(args).toContain("127.0.0.1:4400:4317");
    expect(env).toMatchObject({ HOST: "0.0.0.0", PORT: "4317", PODIUM_DB: "/data/podium.sqlite", STALE_AFTER_MS: "9000" });
  });

  it("gives a containerised server the host's timezone so its day starts at the host's midnight (#139)", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(serverEnv(cfg, true).TZ).toBe(zone);
    expect(containerRunArgs(cfg, Object.keys(serverEnv(cfg, true)))).toContain("TZ");
    // A TZ set in the config wins, and a standalone server already runs in the host's zone.
    expect(serverEnv(resolveConfig({ TZ: "Europe/Berlin" }), true).TZ).toBe("Europe/Berlin");
    expect(serverEnv(cfg, false)).not.toHaveProperty("TZ");
  });

  it("tells a containerised server the host's home, by name only, and leaves standalone alone", () => {
    const env = serverEnv(cfg, true);
    expect(env.PODIUM_HOST_HOME).toBe(os.homedir());
    expect(containerRunArgs(cfg, Object.keys(env))).toContain("PODIUM_HOST_HOME");
    expect(containerRunArgs(cfg, Object.keys(env)).join(" ")).not.toContain(os.homedir());
    expect(serverEnv(cfg, false)).not.toHaveProperty("PODIUM_HOST_HOME");
  });

  it("passes an empty token through so auth stays off", () => {
    expect(serverEnv(resolveConfig({ PODIUM_TOKEN: "" }), false).PODIUM_TOKEN).toBe("");
    expect("PODIUM_TOKEN" in serverEnv(resolveConfig({}), false)).toBe(false);
  });

  it("gives a standalone server the host port and bind", () => {
    expect(serverEnv(cfg, false)).toMatchObject({ HOST: "127.0.0.1", PORT: "4400", PODIUM_TOKEN: "s3cret" });
  });

  it("renders a launchd plist and systemd units", () => {
    const args = ["/usr/bin/node", "/x/podiumctl", "run", "--mode", "standalone"];
    const plist = launchdPlist({ label: "dev.podium.server", args, keepAliveOnFailure: true, logPath: "/l", env: { PATH: "/a&b" } });
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("SuccessfulExit");
    expect(plist).toContain("/a&amp;b");
    expect(launchdPlist({ label: "x", args, keepAliveOnFailure: false, logPath: "/l", env: {} })).not.toContain("KeepAlive");
    const sa = systemdUnit({ args, stopArgs: [], standalone: true, env: { PATH: "/bin" } });
    expect(sa).toContain("Restart=on-failure");
    const co = systemdUnit({ args: ["/n", "/s p", "start"], stopArgs: ["/n", "/s p", "stop"], standalone: false, env: {} });
    expect(co).toContain('ExecStart=/n "/s p" start');
    expect(co).toContain('ExecStop=/n "/s p" stop');
  });
});

describe("podiumctl logging settings (#140)", () => {
  const LOG_KEYS = ["PODIUM_LOG_LEVEL", "PODIUM_LOG_FORMAT", "PODIUM_LOG_SHIP_URL", "PODIUM_LOG_SHIP_HEADERS", "PODIUM_LOG_SHIP_BUFFER"];
  const file = {
    PODIUM_LOG_LEVEL: "debug",
    PODIUM_LOG_FORMAT: "json",
    PODIUM_LOG_SHIP_URL: "http://logs.lan:9428",
    PODIUM_LOG_SHIP_HEADERS: "Authorization=Bearer hdr-s3cret;AccountID=4",
    PODIUM_LOG_SHIP_BUFFER: "500",
  };

  it("are config keys passed through to the server, in both modes", () => {
    expect(PASSTHROUGH).toEqual(expect.arrayContaining(LOG_KEYS));
    const cfg = resolveConfig(file);
    expect(serverEnv(cfg, true)).toMatchObject(file);
    expect(serverEnv(cfg, false)).toMatchObject(file);
  });

  it("never puts a header value on the podman command line", () => {
    const cfg = resolveConfig(file);
    const args = containerRunArgs(cfg, Object.keys(serverEnv(cfg, true)));
    expect(args).toContain("PODIUM_LOG_SHIP_HEADERS");
    expect(args.join(" ")).not.toContain("hdr-s3cret");
  });

  it("can be set, keep = and ; inside a value, and hide header values and URL passwords in `config`", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "podiumctl-"));
    try {
      expect(ctl(home, "config", "set", "PODIUM_LOG_SHIP_HEADERS=Authorization=Basic dXNlcjpwYXNz==;AccountID=4").status).toBe(0);
      expect(ctl(home, "config", "set", "PODIUM_LOG_SHIP_URL=https://vl:pa55word@logs.lan/vl").status).toBe(0);
      expect((parseEnvFile(fs.readFileSync(path.join(home, "config.env"), "utf8")) as Record<string, string>).PODIUM_LOG_SHIP_HEADERS).toBe("Authorization=Basic dXNlcjpwYXNz==;AccountID=4");
      const shown = ctl(home, "config").stdout;
      expect(shown).not.toContain("dXNlcjpwYXNz");
      expect(shown).not.toContain("pa55word");
      expect(shown).toContain("Authorization=(hidden)");
      expect(shown).toContain("AccountID=(hidden)");
      expect(shown).toContain("logs.lan/vl");
      const all = ctl(home, "config", "--show-token").stdout;
      expect(all).toContain("dXNlcjpwYXNz==");
      expect(all).toContain("pa55word");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("maskConfig hides a header pair with no '=', a URL's user name and its query values, and leaves a plain URL alone", () => {
    const shown = maskConfig({ PODIUM_LOG_SHIP_HEADERS: "Bearer abc123;AccountID=4", PODIUM_LOG_SHIP_URL: "https://vluser:pw@logs.lan/vl?apikey=XKEY123" }) as Record<string, string>;
    expect(shown.PODIUM_LOG_SHIP_HEADERS).not.toContain("abc123");
    expect(shown.PODIUM_LOG_SHIP_HEADERS).toContain("AccountID=(hidden)");
    expect(shown.PODIUM_LOG_SHIP_URL).not.toMatch(/vluser|pw@|XKEY123/);
    expect(shown.PODIUM_LOG_SHIP_URL).toContain("logs.lan/vl");
    expect(shown.PODIUM_LOG_SHIP_URL).toContain("apikey=");
    const plain = maskConfig({ PODIUM_LOG_SHIP_URL: "http://logs.lan:9428" }) as Record<string, string>;
    expect(plain.PODIUM_LOG_SHIP_URL).toBe("http://logs.lan:9428");
  });

  it("are listed in --help", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "podiumctl-"));
    try {
      const help = ctl(home, "--help").stdout;
      for (const k of LOG_KEYS) expect(help).toContain(k);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("podiumctl start (standalone) with the port taken", () => {
  // Async spawn: the stand-in server lives in this process, so a blocking spawnSync would starve it.
  function ctlAsync(home: string, ...args: string[]) {
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      // An empty PATH hides podman, so a real "podium" container on the host cannot trip the other-mode guard.
      const p = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, PODIUMCTL_HOME: home, PATH: home } });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  }

  it("fails naming the port and leaves no pid file", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "podiumctl-"));
    const other = http.createServer((_req, res) => res.end("{}"));
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    const port = (other.address() as { port: number }).port;
    try {
      const r = await ctlAsync(home, "start", "--mode", "standalone", "--port", String(port));
      expect(r.status).not.toBe(0);
      expect(r.stdout).not.toContain("Podium is up");
      expect(r.stderr).toContain(String(port));
      expect(r.stderr).toContain("already in use");
      expect(fs.existsSync(path.join(home, "podium.pid"))).toBe(false);
    } finally {
      await new Promise((r) => other.close(r));
      fs.rmSync(home, { recursive: true });
    }
  });
});

describe("podiumctl boot unit staleness (#227)", () => {
  it("is stale when the unit does not point at the running script", () => {
    expect(bootUnitStale("<string>/r/bin/podiumctl.old</string>", "/r/bin/podiumctl")).toBe(true);
    expect(bootUnitStale("ExecStart=/usr/bin/node /r/bin/podiumctl run", "/r/bin/podiumctl")).toBe(false);
  });
});

describe("podiumctl CLI", () => {
  it("prints help and rejects unknown commands", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "podiumctl-"));
    expect(ctl(home, "--help").stdout).toContain("Usage: podiumctl");
    expect(ctl(home, "bogus").status).toBe(2);
    fs.rmSync(home, { recursive: true });
  });

  it("stores config with mode 0600, hides the token, and reports stopped with exit 3", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "podiumctl-"));
    expect(ctl(home, "token").status).toBe(1);
    expect(ctl(home, "token", "--rotate").stdout.trim()).toMatch(/^[0-9a-f]{48}$/);
    const file = path.join(home, "config.env");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const shown = ctl(home, "config").stdout;
    expect(shown).not.toContain(fs.readFileSync(file, "utf8").split("PODIUM_TOKEN=")[1].trim());
    expect(ctl(home, "config", "set", "NOPE=1").status).toBe(1);
    expect(ctl(home, "config", "set", "PODIUMCTL_PORT=4410").status).toBe(0);
    const st = ctl(home, "status", "--mode", "standalone");
    expect(st.status).toBe(3);
    expect(st.stdout).toContain("4410");
    fs.rmSync(home, { recursive: true });
  });
});

describe("podiumctl covers every server setting (#157)", () => {
  // Read by the server but not a user setting: podiumctl sets it itself in the container.
  const SET_BY_PODIUMCTL = ["PODIUM_HOST_HOME", "HOST", "PORT"];
  const serverSrc = path.join(__dirname, "..", "server", "src");
  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sources(full);
      return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [full] : [];
    });
  }
  const readByServer = [...new Set(sources(serverSrc).flatMap((f) => {
    const text = fs.readFileSync(f, "utf8");
    return [...text.matchAll(/envMs\(env, '([A-Z_]+)'|\benv\.([A-Z][A-Z_]+)|process\.env\.([A-Z][A-Z_]+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  }))];

  it("finds the settings the server reads", () => {
    expect(readByServer).toEqual(expect.arrayContaining(["STALE_AFTER_MS", "DETACHED_HIDE_AFTER_MS", "PODIUM_LOG_LEVEL"]));
  });

  it("lets `config set` take every one, or names why it does not", () => {
    const settable = new Set<string>([...PASSTHROUGH, ...OWN_KEYS, ...SET_BY_PODIUMCTL]);
    expect(readByServer.filter((k) => !settable.has(k))).toEqual([]);
  });
});
