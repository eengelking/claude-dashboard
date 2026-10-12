import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  containerRunArgs, launchdPlist, parseArgs, parseEnvFile, resolveConfig, serializeEnv, serverEnv, systemdUnit,
} from "../bin/podiumctl.mjs";

const BIN = path.join(__dirname, "..", "bin", "podiumctl.mjs");
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
    const args = ["/usr/bin/node", "/x/podiumctl.mjs", "run", "--mode", "standalone"];
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
