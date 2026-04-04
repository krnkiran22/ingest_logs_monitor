import { Client } from "ssh2";
import { getEnv } from "@/lib/env";
import { getMachineByName, type LogSource, type MachineCatalogEntry } from "@/lib/fleet";
import { parseJsonResponse } from "@/lib/http";
import { sanitizeLogOutput, summarizeStatusPayload } from "@/lib/log-sanitize";

function getPassword(machine: MachineCatalogEntry) {
  if (machine.kind === "mini") {
    return getEnv("BUILD_AI_INGEST_MINI_PASSWORD");
  }

  return getEnv("BUILD_AI_INGEST_SERVER_PASSWORD");
}

function getHost(machine: MachineCatalogEntry) {
  const preference = getEnv("INGEST_REMOTE_NETWORK") || "primary";
  if (preference === "secondary" && machine.secondaryHost) {
    return machine.secondaryHost;
  }
  return machine.primaryHost;
}

function buildCommand(source: LogSource, lines: number) {
  const safeLines = Math.max(20, Math.min(lines, 400));

  switch (source) {
    case "agent.err":
      return `tail -n ${safeLines} ~/ingest-agent/logs/agent.err 2>&1`;
    case "agent.log":
      return `tail -n ${safeLines} ~/ingest-agent/logs/agent.log 2>&1`;
    case "agent_tail.err":
      return `tail -n ${safeLines} ~/ingest-agent/logs/agent_tail.err 2>&1`;
    case "nic.log":
      return `tail -n ${safeLines} ~/ingest-agent/logs/nic.log 2>&1`;
    case "nic.err":
      return `tail -n ${safeLines} ~/ingest-agent/logs/nic.err 2>&1`;
    case "transfers.csv":
      return `tail -n ${safeLines} ~/ingest-agent/logs/transfers.csv 2>&1`;
    case "upload-daemon":
      return `journalctl -u upload-daemon -n ${safeLines} --no-pager -o short-iso 2>&1`;
    case "aggregator":
      return `journalctl -u aggregator -n ${safeLines} --no-pager -o short-iso 2>&1`;
    case "status":
      throw new Error("status fetch must use the status API path");
  }
}

function getStatusUrl(machine: MachineCatalogEntry, host: string) {
  if (machine.kind === "mini") {
    return `http://${host}:8080/api/status`;
  }

  if (machine.kind === "server") {
    return `http://${host}:8090/api/status`;
  }

  const aggregatorUrl = getEnv("INGEST_AGGREGATOR_URL");
  return `${aggregatorUrl || `http://${host}:8080`}/api/health`;
}

async function fetchStatus(machine: MachineCatalogEntry) {
  const primaryHost = getHost(machine);
  const fallbackHost =
    machine.secondaryHost && machine.secondaryHost !== primaryHost ? machine.secondaryHost : null;

  async function fetchOnce(host: string) {
    const response = await fetch(getStatusUrl(machine, host), {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    return parseJsonResponse<Record<string, unknown>>(
      response,
      `Status API on ${host} returned an empty response.`,
    );
  }

  try {
    return await fetchOnce(primaryHost);
  } catch (error) {
    if (!fallbackHost) {
      throw error;
    }
    return fetchOnce(fallbackHost);
  }
}

async function execRemote(machine: MachineCatalogEntry, command: string) {
  const password = getPassword(machine);
  if (!password) {
    throw new Error(
      `Missing ${machine.kind === "mini" ? "BUILD_AI_INGEST_MINI_PASSWORD" : "BUILD_AI_INGEST_SERVER_PASSWORD"}.`,
    );
  }

  const primaryHost = getHost(machine);
  const fallbackHost =
    machine.secondaryHost && machine.secondaryHost !== primaryHost ? machine.secondaryHost : null;

  async function execOnce(host: string) {
    return new Promise<string>((resolve, reject) => {
      const conn = new Client();
      let settled = false;

      const finish = (error: Error | null, output = "") => {
        if (settled) {
          return;
        }
        settled = true;
        conn.end();
        if (error) {
          reject(error);
          return;
        }
        resolve(output);
      };

      conn
        .on("ready", () => {
          conn.exec(command, (error, stream) => {
            if (error) {
              finish(error);
              return;
            }

            let stdout = "";
            let stderr = "";

            stream.on("data", (chunk: Buffer) => {
              stdout += chunk.toString("utf8");
            });
            stream.stderr.on("data", (chunk: Buffer) => {
              stderr += chunk.toString("utf8");
            });
            stream.on("close", () => {
              finish(null, [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n"));
            });
          });
        })
        .on("error", (error) => finish(error))
        .connect({
          host,
          port: 22,
          username: machine.user,
          password,
          readyTimeout: 10000,
          hostVerifier: () => true,
        });
    });
  }

  try {
    return await execOnce(primaryHost);
  } catch (error) {
    if (!fallbackHost) {
      throw error;
    }
    return execOnce(fallbackHost);
  }
}

export async function readRemoteLog(
  machineName: string,
  source: LogSource,
  lines: number,
) {
  const machine = await getMachineByName(machineName);
  if (!machine) {
    throw new Error(`Unknown machine: ${machineName}`);
  }

  const targetMachine: MachineCatalogEntry = machine;

  if (!targetMachine.availableLogs.includes(source)) {
    throw new Error(`${source} is not available on ${machineName}`);
  }

  async function fetchOne(candidate: LogSource) {
    if (candidate === "status") {
      const payload = await fetchStatus(targetMachine);
      return {
        candidate,
        command: getStatusUrl(targetMachine, getHost(targetMachine)),
        output: summarizeStatusPayload(targetMachine, payload),
      };
    }

    const command = buildCommand(candidate, lines);
    const output = await execRemote(targetMachine, command);
    return { candidate, command, output };
  }

  const primary = await fetchOne(source);

  if (targetMachine.kind !== "mini" || primary.output.trim()) {
    return {
      machine: targetMachine,
      source,
      resolvedSource: primary.candidate,
      command: primary.command,
      output: sanitizeLogOutput(targetMachine, primary.candidate, primary.output),
      fetchedAt: new Date().toISOString(),
      note: primary.output.trim()
        ? "Showing filtered operational lines only."
        : "Selected file is empty.",
    };
  }

  const fallbackOrder: LogSource[] = [
    "agent.err",
    "agent_tail.err",
    "nic.log",
    "transfers.csv",
    "nic.err",
    "agent.log",
  ];
  const fallbacks = fallbackOrder.filter(
    (candidate): candidate is LogSource => candidate !== source,
  );

  for (const candidate of fallbacks) {
    if (!targetMachine.availableLogs.includes(candidate)) {
      continue;
    }

    const attempt = await fetchOne(candidate);
    if (attempt.output.trim()) {
      return {
        machine: targetMachine,
        source,
        resolvedSource: attempt.candidate,
        command: attempt.command,
        output: sanitizeLogOutput(targetMachine, attempt.candidate, attempt.output),
        fetchedAt: new Date().toISOString(),
        note: `Selected file "${source}" is empty. Showing filtered operational lines from "${attempt.candidate}" instead.`,
      };
    }
  }

  return {
    machine: targetMachine,
    source,
    resolvedSource: primary.candidate,
    command: primary.command,
    output: sanitizeLogOutput(targetMachine, primary.candidate, primary.output),
    fetchedAt: new Date().toISOString(),
    note: `Selected file "${source}" is empty and no non-empty fallback log was found.`,
  };
}
