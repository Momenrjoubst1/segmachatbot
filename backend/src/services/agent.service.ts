import { spawn, ChildProcess, exec } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import {
  countDistributedAgents,
  getDistributedAgent,
  releaseDistributedAgent,
  reserveDistributedAgent,
  syncDistributedAgent,
  type DistributedAgentStatus,
} from './agent-runtime.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type AgentEntry =
  | {
      state: 'running';
      proc: ChildProcess;
      lifetimeTimer: NodeJS.Timeout;
      lastHeartbeatAt: number;
      status: string;
      roomName: string;
      identity?: string;
      startedAt: number;
      command: string;
      recentStdout: string[];
      recentStderr: string[];
    }
  | { state: 'stopping'; proc: ChildProcess };

// FIX #2: Reduced from 35s to 30s — tolerates up to 2 missed heartbeats (10s interval)
// before terminating the zombie agent. Prevents resource waste from hung processes.
const HEARTBEAT_TIMEOUT_MS = 30_000;
const STARTUP_GRACE_MS = 90_000;
const INSTANCE_ID = process.env.INSTANCE_ID || randomUUID();
const INTERNAL_AGENT_SECRET = process.env.AGENT_INTERNAL_SECRET || '';
if (!INTERNAL_AGENT_SECRET && process.env.NODE_ENV === 'production') {
  logger.warn('[agent.service] AGENT_INTERNAL_SECRET environment variable is not set.');
}
const AGENT_LIFETIME_MS = 7_200_000; // 2 hours - Extended for longer sessions
const GRACEFUL_SHUTDOWN_MS = 15_000; // 15 seconds - allows Python processes to clean up properly on Windows

const runningAgents = new Map<string, AgentEntry>();
const agentSpawnMutex = new Map<string, Promise<'SPAWNED' | 'ALREADY_RUNNING' | 'CAPACITY_EXCEEDED' | 'ERROR'>>();

// PID file directory for cross-session orphan detection
const PID_DIR = path.join(process.cwd(), '.agent_pids');
try { fs.mkdirSync(PID_DIR, { recursive: true }); } catch { /* ignore */ }

function writePidFile(agentKey: string, pid: number) {
  try { fs.writeFileSync(path.join(PID_DIR, `${agentKey}.pid`), String(pid), 'utf-8'); } catch { /* ignore */ }
}

function removePidFile(agentKey: string) {
  try { fs.unlinkSync(path.join(PID_DIR, `${agentKey}.pid`)); } catch { /* ignore */ }
}

function cleanupOrphanedAgents() {
  try {
    const files = fs.readdirSync(PID_DIR);
    for (const file of files) {
      if (!file.endsWith('.pid')) continue;
      const pidPath = path.join(PID_DIR, file);
      try {
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
        if (!Number.isNaN(pid)) {
          if (process.platform === 'win32') {
            exec(`taskkill /PID ${pid} /T /F`, () => {});
          } else {
            try { process.kill(pid, 'SIGKILL'); } catch { /* ignore if already dead */ }
          }
          logger.info(`[STARTUP CLEANUP] Killed orphaned agent process PID=${pid}`);
        }
      } catch { /* ignore unreadable PID files */ }
      try { fs.unlinkSync(pidPath); } catch { /* ignore */ }
    }
  } catch { /* ignore if PID_DIR doesn't exist */ }
}

// Run once on module load to clean up zombies from previous crashes
cleanupOrphanedAgents();

function isRunningEntry(entry: AgentEntry): entry is AgentEntry & { state: 'running' } {
  return entry.state === 'running';
}

function shouldKillZombie(entry: AgentEntry & { state: 'running' }, now: number): boolean {
  const inStartupGrace = entry.status === 'starting' && (now - entry.startedAt) < STARTUP_GRACE_MS;
  if (inStartupGrace) return false;
  return now - entry.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS;
}

setInterval(() => {
  const now = Date.now();
  for (const [agentKey, entry] of runningAgents.entries()) {
    if (!isRunningEntry(entry) || !shouldKillZombie(entry, now)) continue;
    const gapMs = now - entry.lastHeartbeatAt;
    logger.debug(`[obs] agent_zombie_killed agentKey=${agentKey} heartbeatGapMs=${gapMs}`);
    logger.error(`[HEALTH CHECK] Agent ${agentKey} is unresponsive (no heartbeat for ${Math.round(gapMs / 1000)}s). Terminating.`);
    void stopAgentByKey(agentKey);
  }
}, 10_000);

function getAgentKey(roomName: string, identity?: string): string {
  return identity ? `${roomName}_${identity}` : roomName;
}

/**
 * Resolve the Python executable. Prefer venv bundled with the repo if present,
 * otherwise fall back to `python` (Windows) / `python3` (Unix) on PATH.
 */
function resolvePythonBinary(projectRoot: string): string {
  const candidates = process.platform === 'win32'
    ? [
        path.join(projectRoot, '..', '.venv', 'Scripts', 'python.exe'),
        path.join(projectRoot, '.venv', 'Scripts', 'python.exe'),
        'python',
      ]
    : [
        path.join(projectRoot, '..', '.venv', 'bin', 'python'),
        path.join(projectRoot, '.venv', 'bin', 'python'),
        'python3',
        'python',
      ];

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1];
}

/**
 * Spawn the text agent script as a child process.
 */
async function syncAgentRuntime(
  agentKey: string,
  status: DistributedAgentStatus,
  pid: number | null,
  roomName: string,
  startedAt: number,
  identity?: string,
) {
  await syncDistributedAgent({
    agentKey,
    roomName,
    identity: identity ?? null,
    instanceId: INSTANCE_ID,
    pid,
    status,
    startedAt,
    updatedAt: Date.now(),
  });
}

function getInternalApiBaseUrl() {
  const port = process.env.PORT || '3004';
  return process.env.BACKEND_INTERNAL_API_BASE_URL || `http://127.0.0.1:${port}/api/agent/internal`;
}

async function spawnTextAgent(roomName: string, identity?: string): Promise<boolean> {
  const agentKey = getAgentKey(roomName, identity);
  if (runningAgents.has(agentKey)) {
    return false;
  }

  let stdoutBuffer = '';
  const recentStdout: string[] = [];
  const recentStderr: string[] = [];

  const pushRecentLine = (bucket: string[], line: string) => {
    const trimmed = line.trimEnd();
    if (!trimmed) return;
    bucket.push(trimmed);
    if (bucket.length > 20) {
      bucket.shift();
    }
  };

  const projectRoot = path.join(__dirname, '../..');
  // NOTE: directory is 'agents' (plural), not 'agent'.
  const agentPath = path.join(projectRoot, 'agents', 'livekit_text_agent.py');

  if (!fs.existsSync(agentPath)) {
    logger.error(`Agent script not found at ${agentPath}`);
    return false;
  }

  const env = { ...process.env };
  if (identity) {
    env.TARGET_IDENTITY = identity;
  }
  env.AGENT_ROOM_NAME = roomName;
  env.BACKEND_INTERNAL_API_BASE_URL = getInternalApiBaseUrl();
  env.AGENT_INTERNAL_SECRET = INTERNAL_AGENT_SECRET;
  env.PYTHONIOENCODING = 'utf-8'; // Prevent Windows UnicodeEncodeError with Arabic text

  const pythonBin = resolvePythonBinary(projectRoot);
  const commandArgs = [agentPath, 'connect', '--room', roomName];
  const commandString = [pythonBin, ...commandArgs].join(' ');

  logger.info(`[agent:${agentKey}] Spawning agent process`, {
    pythonBin,
    agentPath,
    roomName,
    identity: identity ?? null,
    cwd: projectRoot,
    command: commandString,
  });

  // LiveKit Agents CLI expects a subcommand. `connect --room <name>` instructs
  // the worker to join a specific room immediately — matching this service's
  // spawn-per-room model.
  const agentProcess = spawn(
    pythonBin,
    commandArgs,
    {
      cwd: projectRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );

  agentProcess.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.includes('[HEARTBEAT]')) {
        try {
          const jsonStr = line.substring(line.indexOf('[HEARTBEAT]') + 11).trim();
          const hb = JSON.parse(jsonStr);
          const entry = runningAgents.get(agentKey);
          if (entry && entry.state === 'running') {
            entry.lastHeartbeatAt = Date.now();
            entry.status = hb.status || 'idle';
            void syncAgentRuntime(
              agentKey,
              (hb.status || 'idle') as DistributedAgentStatus,
              agentProcess.pid ?? null,
              entry.roomName,
              entry.startedAt,
              entry.identity,
            );
          }
        } catch (e) {
          logger.debug(`[agent:${agentKey}] Failed to parse heartbeat JSON (partial chunk)`, { error: (e as Error)?.message });
        }
      }

      pushRecentLine(recentStdout, line);

      if (line.includes('[SELF-CHECK]')) {
        // FIX #5: Capture and log API key self-check results from the agent
        try {
          const jsonStr = line.substring(line.indexOf('[SELF-CHECK]') + 12).trim();
          const check = JSON.parse(jsonStr);
          if (check.issues?.length) {
            logger.warn(`[agent:${agentKey}] Self-check found ${check.issues.length} issue(s):`, { issues: check.issues });
          }
        } catch {
          logger.info(`[agent:${agentKey}] ${line.trimEnd()}`);
        }
      } else if (line.trim()) {
        logger.info(`[agent:${agentKey}] ${line.trimEnd()}`);
      }
    }
  });
  agentProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    text.split(/\r?\n/).forEach((line) => pushRecentLine(recentStderr, line));
    logger.warn(`[agent:${agentKey}] ${text.trimEnd()}`);
  });

  agentProcess.on('error', (err) => {
    logger.debug(`[obs] agent_spawn_failed agentKey=${agentKey} reason=${err.message}`);
    logger.error(`Failed to spawn agent for ${agentKey}:`, {
      err: err.message,
      command: commandString,
      pythonBin,
      agentPath,
      roomName,
      identity: identity ?? null,
      recentStdout,
      recentStderr,
    });
    const entry = runningAgents.get(agentKey);
    if (entry && 'lifetimeTimer' in entry) {
      clearTimeout(entry.lifetimeTimer);
    }
    stdoutBuffer = '';
    removePidFile(agentKey);
    void releaseDistributedAgent(agentKey);
    runningAgents.delete(agentKey);
  });

  agentProcess.on('exit', (code, signal) => {
    const entry = runningAgents.get(agentKey);
    logger.debug(`[obs] agent_exit agentKey=${agentKey} exitCode=${code} signal=${signal} runtimeMs=${entry && entry.state === 'running' ? Date.now() - entry.startedAt : 0}`);
    logger.info(`Agent for ${agentKey} exited (code=${code}, signal=${signal})`, {
      command: entry && entry.state === 'running' ? entry.command : commandString,
      roomName,
      identity: identity ?? null,
      runtimeMs: entry && entry.state === 'running' ? Date.now() - entry.startedAt : undefined,
      lastKnownStatus: entry && entry.state === 'running' ? entry.status : undefined,
      recentStdout,
      recentStderr,
    });
    if (entry && 'lifetimeTimer' in entry) {
      clearTimeout(entry.lifetimeTimer);
    }
    stdoutBuffer = '';
    removePidFile(agentKey);
    void releaseDistributedAgent(agentKey);
    runningAgents.delete(agentKey);
  });

  const lifetimeTimer = setTimeout(() => {
    logger.info(`Agent lifetime reached for ${agentKey}, stopping.`);
    void stopAgent(roomName, identity);
  }, AGENT_LIFETIME_MS);

  const startedAt = Date.now();
  runningAgents.set(agentKey, {
    state: 'running',
    proc: agentProcess,
    lifetimeTimer,
    lastHeartbeatAt: Date.now(),
    status: 'starting',
    roomName,
    identity,
    startedAt,
    command: commandString,
    recentStdout,
    recentStderr,
  });

  await syncAgentRuntime(agentKey, 'starting', agentProcess.pid ?? null, roomName, startedAt, identity);

  if (agentProcess.pid) {
    writePidFile(agentKey, agentProcess.pid);
  }

  logger.debug(`[obs] agent_spawned agentKey=${agentKey} pid=${agentProcess.pid} room=${roomName}`);
  return true;
}

async function _spawnAgent(roomName: string, identity?: string): Promise<'SPAWNED' | 'ALREADY_RUNNING' | 'CAPACITY_EXCEEDED' | 'ERROR'> {
  const agentKey = getAgentKey(roomName, identity);

  const existingInProcess = runningAgents.get(agentKey);
  if (existingInProcess && existingInProcess.state === 'running') {
    return 'ALREADY_RUNNING';
  }

  const existingDistributed = await getDistributedAgent(roomName, identity);
  if (existingDistributed) {
    return 'ALREADY_RUNNING';
  }

  const pendingSpawn = agentSpawnMutex.get(agentKey);
  if (pendingSpawn) {
    const result = await pendingSpawn;
    return result ? 'SPAWNED' : 'ALREADY_RUNNING';
  }

  const spawnPromise = (async () => {
    const currentMaxAgents = parseInt(process.env.MAX_CONCURRENT_AGENTS || '10', 10);
    const activeAgents = await countDistributedAgents();
    if (activeAgents >= currentMaxAgents) {
      logger.warn(`Agent capacity exceeded. Current: ${activeAgents}, Max: ${currentMaxAgents}`);
      return 'CAPACITY_EXCEEDED';
    }

    const reserved = await reserveDistributedAgent({
      agentKey,
      roomName,
      identity: identity ?? null,
      instanceId: INSTANCE_ID,
      pid: null,
      status: 'starting',
      startedAt: Date.now(),
    });

    if (!reserved) {
      return 'ALREADY_RUNNING';
    }

    const success = await spawnTextAgent(roomName, identity);
    if (!success) {
      await releaseDistributedAgent(agentKey);
    }
    return success ? 'SPAWNED' : 'ERROR';
  })();

  agentSpawnMutex.set(agentKey, spawnPromise);

  try {
    return await spawnPromise;
  } finally {
    agentSpawnMutex.delete(agentKey);
  }
}

function terminateAgentProcess(proc: ChildProcess, signal: 'SIGTERM' | 'SIGKILL', agentKey: string) {
  if (process.platform === 'win32' && proc.pid) {
    // Windows: Use taskkill to cleanly kill the process tree
    // Always use /F (force) because Python/LiveKit subprocesses resist graceful termination
    exec(`taskkill /PID ${proc.pid} /T /F`, (err) => {
      // Ignore errors if process is already dead
      if (err && !err.message.includes('not found')) {
        logger.warn(`taskkill failed for ${agentKey}:`, { err: err.message });
      }
    });
  } else {
    // POSIX: Standard signal
    try {
      proc.kill(signal);
    } catch (err) {
      logger.warn(`${signal} failed for ${agentKey}:`, { err: (err as Error).message });
    }
  }
}

async function stopAgentByKey(agentKey: string): Promise<boolean> {
  const entry = runningAgents.get(agentKey);

  if (!entry) {
    return false;
  }

  if (entry.state === 'stopping') {
    return true; // Already stopping
  }

  // Clear lifetime timer — we're stopping now.
  clearTimeout(entry.lifetimeTimer);

  const proc = entry.proc;
  runningAgents.set(agentKey, { state: 'stopping', proc });
  if ('roomName' in entry) {
    await syncAgentRuntime(agentKey, 'stopping', proc.pid ?? null, entry.roomName, entry.startedAt, entry.identity);
  }

  terminateAgentProcess(proc, 'SIGTERM', agentKey);

  setTimeout(() => {
    if (runningAgents.get(agentKey)?.state === 'stopping') {
      terminateAgentProcess(proc, 'SIGKILL', agentKey);
    }
  }, GRACEFUL_SHUTDOWN_MS);

  logger.info(`Stopping agent for: ${agentKey}`);
  return true;
}

async function stopAgent(roomName: string, identity?: string): Promise<boolean> {
  return stopAgentByKey(getAgentKey(roomName, identity));
}

async function _getAgentStatus(roomName?: string, identity?: string) {
  const currentMaxAgents = parseInt(process.env.MAX_CONCURRENT_AGENTS || '10', 10);
  const totalAgents = await countDistributedAgents();
  if (roomName) {
    const key = getAgentKey(roomName, identity);
    const entry = runningAgents.get(key);
    if (entry?.state === 'running') {
      return {
        active: true,
        status: entry.status,
        totalAgents,
        maxAgents: currentMaxAgents,
      };
    }

    const distributed = await getDistributedAgent(roomName, identity);
    return {
      active: Boolean(distributed),
      status: distributed?.status || 'offline',
      totalAgents,
      maxAgents: currentMaxAgents,
    };
  }
  return { active: false, status: 'offline', totalAgents, maxAgents: currentMaxAgents };
}

export async function cleanupAllAgentsOnShutdown(): Promise<void> {
  const activeKeys = Array.from(runningAgents.keys());
  if (activeKeys.length === 0) return;

  logger.info(`[SHUTDOWN] Terminating ${activeKeys.length} active agents...`);
  const stopPromises = activeKeys.map(async (key) => {
    try {
      const entry = runningAgents.get(key);
      if (entry && entry.state === 'running') {
        const proc = entry.proc;
        clearTimeout(entry.lifetimeTimer);
        // Sync stop status to Redis & DB
        await syncAgentRuntime(key, 'stopping', proc.pid ?? null, entry.roomName, entry.startedAt, entry.identity);
        // Release from Redis
        await releaseDistributedAgent(key);
        // Kill the process
        terminateAgentProcess(proc, 'SIGKILL', key);
        removePidFile(key);
      }
    } catch (err) {
      logger.warn(`Failed to stop agent ${key} on shutdown:`, err instanceof Error ? err : new Error(String(err)));
    }
  });

  await Promise.all(stopPromises);
  runningAgents.clear();
}
