// Generated from claude-mem/scripts/build-cloud-work-view.mjs.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// src/shared/hook-io.ts
function bypassWrite(chunk) {
  const writer = pinnedBypassWrite ?? process.stderr.write.bind(process.stderr);
  return writer(chunk);
}
function emitDiagnostic(line) {
  bypassWrite(line);
}
var pinnedBypassWrite, pendingModelContext;
var init_hook_io = __esm({
  "src/shared/hook-io.ts"() {
    "use strict";
    pinnedBypassWrite = null;
    pendingModelContext = Promise.resolve();
  }
});

// src/shared/atomic-json.ts
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from "fs";
import { randomBytes } from "crypto";
import { basename, dirname, join, resolve } from "path";
function stripUtf8Bom(raw) {
  return raw.replace(/^\uFEFF/, "");
}
function parseJsonWithBom(raw) {
  return JSON.parse(stripUtf8Bom(raw));
}
function readJsonFileWithBom(filepath) {
  return parseJsonWithBom(readFileSync(filepath, "utf-8"));
}
function ensureDirectoryExists(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}
function physicalPathOf(filePath) {
  try {
    return realpathSync(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    const parent = dirname(filePath);
    if (parent === filePath) return filePath;
    return join(physicalPathOf(parent), basename(filePath));
  }
}
function resolveSymlinkWriteTarget(filePath) {
  let resolved = filePath;
  const followed = /* @__PURE__ */ new Set();
  try {
    while (lstatSync(resolved).isSymbolicLink()) {
      const absolute = resolve(resolved);
      if (followed.has(absolute)) {
        throw Object.assign(new Error(`Symlink loop at ${resolved}`), { code: "ELOOP" });
      }
      followed.add(absolute);
      try {
        return realpathSync(resolved);
      } catch (realpathErr) {
        if (realpathErr.code !== "ENOENT") throw realpathErr;
        const realpathError = realpathErr instanceof Error ? realpathErr : new Error(String(realpathErr));
        emitDiagnostic(`claude-mem: realpathSync failed for ${resolved}, resolving symlink manually: ${realpathError.message}
`);
        const linkTarget = readlinkSync(resolved);
        resolved = resolve(physicalPathOf(dirname(resolve(resolved))), linkTarget);
      }
    }
  } catch (err) {
    const code = err.code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
  return resolved;
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function renameWithWindowsRetry(from, to, rename = renameSync, onWindows = IS_WINDOWS_PLATFORM) {
  if (!onWindows) return rename(from, to);
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = err.code ?? "";
      if (attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length || !WINDOWS_RENAME_RETRY_CODES.has(code)) {
        throw err;
      }
      sleepSync(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}
function writeBufferAtomic(filepath, payload, options = {}) {
  const resolved = resolveSymlinkWriteTarget(filepath);
  ensureDirectoryExists(dirname(resolved));
  const dir = dirname(resolved);
  const base = basename(resolved);
  const tmpPath = join(dir, `.${base}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let mode = options.mode;
  if (mode === void 0) {
    try {
      mode = statSync(resolved).mode & 511;
    } catch {
    }
  }
  let fd;
  try {
    fd = mode !== void 0 ? openSync(tmpPath, "wx", mode) : openSync(tmpPath, "wx");
    if (mode !== void 0 && !IS_WINDOWS_PLATFORM) fchmodSync(fd, mode);
    let written = 0;
    while (written < payload.length) {
      const n = writeSync(fd, payload, written, payload.length - written);
      if (n === 0) {
        throw new Error(`writeSync stalled at ${written}/${payload.length} bytes`);
      }
      written += n;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = void 0;
    renameWithWindowsRetry(tmpPath, resolved);
    if (!IS_WINDOWS_PLATFORM) {
      let dirFd;
      try {
        dirFd = openSync(dir, "r");
        fsyncSync(dirFd);
      } catch (dirSyncErr) {
        const dirSyncError = dirSyncErr instanceof Error ? dirSyncErr : new Error(String(dirSyncErr));
        emitDiagnostic(`claude-mem: directory fsync failed for ${dir}: ${dirSyncError.message}
`);
      } finally {
        if (dirFd !== void 0) {
          try {
            closeSync(dirFd);
          } catch {
          }
        }
      }
    }
  } catch (err) {
    if (fd !== void 0) {
      try {
        closeSync(fd);
      } catch {
      }
    }
    try {
      unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function writeJsonFileAtomic(filepath, data, options = {}) {
  writeBufferAtomic(filepath, Buffer.from(JSON.stringify(data, null, 2) + "\n", "utf-8"), options);
}
var IS_WINDOWS_PLATFORM, WINDOWS_RENAME_RETRY_CODES, WINDOWS_RENAME_RETRY_DELAYS_MS;
var init_atomic_json = __esm({
  "src/shared/atomic-json.ts"() {
    "use strict";
    init_hook_io();
    IS_WINDOWS_PLATFORM = process.platform === "win32";
    WINDOWS_RENAME_RETRY_CODES = /* @__PURE__ */ new Set(["EPERM", "EBUSY", "EACCES"]);
    WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320];
  }
});

// src/shared/expand-home.ts
import { homedir } from "os";
import { join as join2 } from "path";
function expandHome(filePath, platform = process.platform, home = homedir()) {
  if (typeof filePath !== "string" || filePath.length === 0) return filePath;
  if (filePath === "~") return home;
  if (filePath.startsWith("~/") || platform === "win32" && filePath.startsWith("~\\")) {
    return join2(home, filePath.slice(2));
  }
  return filePath;
}
var init_expand_home = __esm({
  "src/shared/expand-home.ts"() {
    "use strict";
  }
});

// src/shared/settings-document-shape.ts
function classifySettingsDocument(document) {
  const env = document.env;
  return isSettingsRecord(env) && Object.keys(env).some((key) => key.startsWith("CLAUDE_MEM_")) ? "nested" : "flat";
}
function settingsTarget(document) {
  return classifySettingsDocument(document) === "nested" ? document.env : document;
}
var isSettingsRecord;
var init_settings_document_shape = __esm({
  "src/shared/settings-document-shape.ts"() {
    "use strict";
    isSettingsRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  }
});

// src/shared/settings-document.ts
function withoutStaleRootCopies(document) {
  if (classifySettingsDocument(document) !== "nested") return document;
  return Object.fromEntries(Object.entries(document).filter(([key]) => !key.startsWith("CLAUDE_MEM_")));
}
var init_settings_document = __esm({
  "src/shared/settings-document.ts"() {
    "use strict";
    init_atomic_json();
    init_settings_document_shape();
  }
});

// src/shared/data-dir.ts
import { existsSync as existsSync2 } from "fs";
import { homedir as homedir2 } from "os";
import { join as join3 } from "path";
function resolveDataDir() {
  if (process.env.CLAUDE_MEM_DATA_DIR) {
    return expandHome(process.env.CLAUDE_MEM_DATA_DIR);
  }
  const defaultDataDir2 = join3(homedir2(), ".claude-mem");
  const settingsPath = join3(defaultDataDir2, "settings.json");
  try {
    if (existsSync2(settingsPath)) {
      const raw = readJsonFileWithBom(settingsPath);
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return defaultDataDir2;
      const settings = settingsTarget(raw);
      if (typeof settings.CLAUDE_MEM_DATA_DIR === "string" && settings.CLAUDE_MEM_DATA_DIR) {
        return expandHome(settings.CLAUDE_MEM_DATA_DIR);
      }
    }
  } catch {
  }
  return defaultDataDir2;
}
var init_data_dir = __esm({
  "src/shared/data-dir.ts"() {
    "use strict";
    init_atomic_json();
    init_expand_home();
    init_settings_document();
  }
});

// src/shared/paths.ts
import { join as join4, dirname as dirname2, basename as basename2 } from "path";
import { homedir as homedir3 } from "os";
import { fileURLToPath } from "url";
function getDirname() {
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }
  return dirname2(fileURLToPath(import.meta.url));
}
var _dirname, DATA_DIR, DEFAULT_CLAUDE_CONFIG_DIR, CLAUDE_CONFIG_DIR, MARKETPLACE_ROOT, LOGS_DIR, USER_SETTINGS_PATH, DB_FILENAME, DB_PATH, OBSERVER_SESSIONS_DIR, OBSERVER_SESSIONS_PROJECT, paths;
var init_paths = __esm({
  "src/shared/paths.ts"() {
    "use strict";
    init_data_dir();
    init_expand_home();
    init_expand_home();
    init_data_dir();
    _dirname = getDirname();
    DATA_DIR = resolveDataDir();
    DEFAULT_CLAUDE_CONFIG_DIR = join4(homedir3(), ".claude");
    CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || DEFAULT_CLAUDE_CONFIG_DIR;
    MARKETPLACE_ROOT = join4(CLAUDE_CONFIG_DIR, "plugins", "marketplaces", "thedotmack");
    LOGS_DIR = join4(DATA_DIR, "logs");
    USER_SETTINGS_PATH = join4(DATA_DIR, "settings.json");
    DB_FILENAME = "claude-mem.db";
    DB_PATH = join4(DATA_DIR, DB_FILENAME);
    OBSERVER_SESSIONS_DIR = join4(DATA_DIR, "observer-sessions");
    OBSERVER_SESSIONS_PROJECT = basename2(OBSERVER_SESSIONS_DIR);
    paths = {
      dataDir: () => DATA_DIR,
      workerPid: () => join4(DATA_DIR, "worker.pid"),
      workerHeartbeat: () => join4(DATA_DIR, "worker-heartbeat.json"),
      // Phase 1b: identifier renamed to `server*`; the on-disk file basenames
      // remain `.server-beta.*` so existing installations keep finding their
      // pid/port/runtime state. Plan §1d will migrate the basenames.
      serverPid: () => join4(DATA_DIR, ".server-beta.pid"),
      serverPort: () => join4(DATA_DIR, ".server-beta.port"),
      serverRuntime: () => join4(DATA_DIR, ".server-beta.runtime.json"),
      settings: () => join4(DATA_DIR, "settings.json"),
      database: () => join4(DATA_DIR, DB_FILENAME),
      // Automatic snapshot target (BackupManager). Nested under backups/auto so
      // the manager's retention sweep never touches the legacy one-off backups
      // that live directly in backups/.
      backups: () => join4(DATA_DIR, "backups", "auto"),
      // A restore staged by `npx claude-mem restore`, applied by the next worker
      // boot before it opens the database, and the outcome of the last one.
      pendingRestore: () => join4(DATA_DIR, "backups", "restore-pending.json"),
      lastRestore: () => join4(DATA_DIR, "backups", "last-restore.json"),
      chroma: () => join4(DATA_DIR, "chroma"),
      combinedCerts: () => join4(DATA_DIR, "combined_certs.pem"),
      transcriptsConfig: () => join4(DATA_DIR, "transcript-watch.json"),
      transcriptsState: () => join4(DATA_DIR, "transcript-watch-state.json"),
      corpora: () => join4(DATA_DIR, "corpora"),
      supervisorRegistry: () => join4(DATA_DIR, "supervisor.json"),
      envFile: () => join4(DATA_DIR, ".env"),
      logsDir: () => LOGS_DIR
    };
  }
});

// src/utils/logger.ts
import { closeSync as closeSync2, existsSync as existsSync3, fstatSync, mkdirSync as mkdirSync2, openSync as openSync2, statSync as statSync2, writeSync as writeSync2 } from "fs";
import { dirname as dirname3, join as join5 } from "path";
function escapeLineBreaks(value) {
  return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}
function escapeStackText(stack) {
  return "  " + stack.replace(/\r/g, "\\r").replace(/\n(?![ \t]+at )/g, "\\n");
}
var LogLevel, errorSink, Logger, logger;
var init_logger = __esm({
  "src/utils/logger.ts"() {
    "use strict";
    init_paths();
    init_hook_io();
    init_atomic_json();
    init_settings_document();
    LogLevel = /* @__PURE__ */ ((LogLevel2) => {
      LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
      LogLevel2[LogLevel2["INFO"] = 1] = "INFO";
      LogLevel2[LogLevel2["WARN"] = 2] = "WARN";
      LogLevel2[LogLevel2["ERROR"] = 3] = "ERROR";
      LogLevel2[LogLevel2["SILENT"] = 4] = "SILENT";
      return LogLevel2;
    })(LogLevel || {});
    errorSink = null;
    Logger = class {
      level = null;
      useColor;
      logFilePath = null;
      logFileInitialized = false;
      logFileDate = null;
      logFd = null;
      constructor() {
        this.useColor = process.stdout.isTTY ?? false;
      }
      ensureLogFileInitialized() {
        const date2 = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        if (this.logFileInitialized && this.logFileDate === date2) return;
        const firstAttemptToday = this.logFileDate !== date2;
        this.closeLogFd();
        this.logFileInitialized = false;
        this.logFileDate = date2;
        try {
          const logsDir = paths.logsDir();
          if (!existsSync3(logsDir)) {
            mkdirSync2(logsDir, { recursive: true });
          }
          this.logFilePath = join5(logsDir, `claude-mem-${date2}.log`);
          this.logFileInitialized = true;
        } catch (error) {
          if (firstAttemptToday) {
            console.error("[LOGGER] Failed to initialize log file:", error instanceof Error ? error.message : String(error));
          }
          this.logFilePath = null;
        }
      }
      closeLogFd() {
        if (this.logFd === null) return;
        try {
          closeSync2(this.logFd);
        } catch {
        }
        this.logFd = null;
      }
      /**
       * Appends through one file descriptor kept open for the whole day.
       * On-access antivirus can scan a file each time it is opened: Microsoft
       * Defender on macOS runs as an Endpoint Security client, and ES can hold an
       * open (AUTH_OPEN) but has no auth event for write or stat. Re-opening the
       * day log per line (appendFileSync) was measured at up to 2 s per open
       * under load; this runs on the worker's event loop, and in that state
       * /api/health went silent and the worker was reclaimed as wedged. Opening
       * once a day avoids the per-line open. The stat of the path detects an
       * external rename, delete or replace, and the next line re-opens the file.
       */
      appendLine(path, text5) {
        if (this.logFd !== null) {
          let current = false;
          try {
            const open = fstatSync(this.logFd);
            const onDisk = statSync2(path);
            current = open.ino === onDisk.ino && open.dev === onDisk.dev;
          } catch {
          }
          if (!current) this.closeLogFd();
        }
        if (this.logFd === null) {
          mkdirSync2(dirname3(path), { recursive: true });
          this.logFd = openSync2(path, "a");
        }
        try {
          let bytes2 = Buffer.from(text5, "utf8");
          while (bytes2.length > 0) {
            const written = writeSync2(this.logFd, bytes2);
            if (written <= 0) throw new Error("log write accepted 0 bytes");
            bytes2 = bytes2.subarray(written);
          }
        } catch (error) {
          this.closeLogFd();
          throw error;
        }
      }
      getLevel() {
        if (this.level === null) {
          try {
            const settingsPath = paths.settings();
            if (existsSync3(settingsPath)) {
              const settings = settingsTarget(readJsonFileWithBom(settingsPath));
              const envLevel = (settings.CLAUDE_MEM_LOG_LEVEL || "INFO").toString().toUpperCase();
              this.level = LogLevel[envLevel] ?? 1 /* INFO */;
            } else {
              this.level = 1 /* INFO */;
            }
          } catch (error) {
            console.error("[LOGGER] Failed to load log level from settings:", error instanceof Error ? error.message : String(error));
            this.level = 1 /* INFO */;
          }
        }
        return this.level;
      }
      /**
       * Serialize a value to JSON without ever overflowing the stack.
       *
       * `JSON.stringify` recurses through the whole object graph, so a deeply
       * nested or self-referential payload throws `RangeError: Maximum call stack
       * size exceeded` — and logging must never crash its caller. This walks the
       * value to a fixed depth (cheap, bounded stack), replacing anything deeper,
       * any cycle, or any BigInt with a marker, then stringifies the pruned,
       * guaranteed-finite result.
       */
      safeStringify(data, indent, maxDepth = 6) {
        const seen = /* @__PURE__ */ new WeakSet();
        const prune = (rawValue, depth) => {
          if (typeof rawValue === "bigint") return `${rawValue}n`;
          if (rawValue === null || typeof rawValue !== "object") return rawValue;
          const toJSON = rawValue.toJSON;
          const value = typeof toJSON === "function" ? toJSON.call(rawValue) : rawValue;
          if (typeof value === "bigint") return `${value}n`;
          if (value === null || typeof value !== "object") return value;
          if (seen.has(value)) return "[Circular]";
          if (depth >= maxDepth) return Array.isArray(value) ? "[Array]" : "[Object]";
          seen.add(value);
          try {
            if (Array.isArray(value)) {
              return value.map((item) => prune(item, depth + 1));
            }
            const out = {};
            for (const key of Object.keys(value)) {
              try {
                out[key] = prune(value[key], depth + 1);
              } catch {
                out[key] = "[unreadable]";
              }
            }
            return out;
          } finally {
            seen.delete(value);
          }
        };
        try {
          return JSON.stringify(prune(data, 0), null, indent) ?? String(data);
        } catch {
          return Array.isArray(data) ? `[${data.length} items]` : "[unserializable]";
        }
      }
      formatData(data) {
        if (data === null || data === void 0) return "";
        if (typeof data === "string") return data;
        if (typeof data === "number") return data.toString();
        if (typeof data === "boolean") return data.toString();
        if (typeof data === "object") {
          if (data instanceof Error) {
            return this.getLevel() === 0 /* DEBUG */ ? `${data.message}
${data.stack}` : data.message;
          }
          if (Array.isArray(data)) {
            return `[${data.length} items]`;
          }
          const keys = Object.keys(data);
          if (keys.length === 0) return "{}";
          if (keys.length <= 3) {
            return this.safeStringify(data);
          }
          return `{${keys.length} keys: ${keys.slice(0, 3).join(", ")}...}`;
        }
        return String(data);
      }
      formatTool(toolName, toolInput) {
        if (!toolInput) return toolName;
        let input = toolInput;
        if (typeof toolInput === "string") {
          try {
            input = JSON.parse(toolInput);
          } catch {
            input = toolInput;
          }
        }
        if (input === null) return toolName;
        if (toolName === "Bash" && input.command) {
          return `${toolName}(${input.command})`;
        }
        if (input.file_path) {
          return `${toolName}(${input.file_path})`;
        }
        if (input.notebook_path) {
          return `${toolName}(${input.notebook_path})`;
        }
        if (toolName === "Glob" && input.pattern) {
          return `${toolName}(${input.pattern})`;
        }
        if (toolName === "Grep" && input.pattern) {
          return `${toolName}(${input.pattern})`;
        }
        if (input.url) {
          return `${toolName}(${input.url})`;
        }
        if (input.query) {
          return `${toolName}(${input.query})`;
        }
        if (toolName === "Task") {
          if (input.subagent_type) {
            return `${toolName}(${input.subagent_type})`;
          }
          if (input.description) {
            return `${toolName}(${input.description})`;
          }
        }
        if (toolName === "Skill" && input.skill) {
          return `${toolName}(${input.skill})`;
        }
        if (toolName === "LSP" && input.operation) {
          return `${toolName}(${input.operation})`;
        }
        return toolName;
      }
      formatTimestamp(date2) {
        const year = date2.getFullYear();
        const month = String(date2.getMonth() + 1).padStart(2, "0");
        const day = String(date2.getDate()).padStart(2, "0");
        const hours = String(date2.getHours()).padStart(2, "0");
        const minutes = String(date2.getMinutes()).padStart(2, "0");
        const seconds = String(date2.getSeconds()).padStart(2, "0");
        const ms = String(date2.getMilliseconds()).padStart(3, "0");
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
      }
      log(level, component, message, context, data) {
        if (level < this.getLevel()) return;
        this.ensureLogFileInitialized();
        const timestamp = this.formatTimestamp(/* @__PURE__ */ new Date());
        const levelStr = LogLevel[level].padEnd(5);
        const componentStr = component.padEnd(6);
        let correlationStr = "";
        if (context?.correlationId) {
          correlationStr = `[${escapeLineBreaks(String(context.correlationId))}] `;
        } else if (context?.sessionId) {
          correlationStr = `[session-${escapeLineBreaks(String(context.sessionId))}] `;
        }
        let dataStr = "";
        if (data !== void 0 && data !== null) {
          if (data instanceof Error) {
            dataStr = ` ${escapeLineBreaks(data.message)}`;
            if (this.getLevel() === 0 /* DEBUG */ && data.stack) {
              dataStr += `
${escapeStackText(data.stack)}`;
            }
          } else if (this.getLevel() === 0 /* DEBUG */ && typeof data === "object") {
            dataStr = "\n" + this.safeStringify(data, 2);
          } else {
            dataStr = " " + escapeLineBreaks(this.formatData(data));
          }
        }
        let contextStr = "";
        if (context) {
          const { sessionId, memorySessionId, correlationId, ...rest } = context;
          if (Object.keys(rest).length > 0) {
            const pairs = Object.entries(rest).map(([k, v]) => {
              if (typeof v !== "object" || v === null || v instanceof Error || v instanceof Date) {
                return `${escapeLineBreaks(k)}=${escapeLineBreaks(String(v))}`;
              }
              return `${escapeLineBreaks(k)}=${escapeLineBreaks(Array.isArray(v) ? this.safeStringify(v) : this.formatData(v))}`;
            });
            contextStr = ` {${pairs.join(", ")}}`;
          }
        }
        const logLine = `[${timestamp}] [${levelStr}] [${componentStr}] ${correlationStr}${escapeLineBreaks(message)}${contextStr}${dataStr}`;
        if (this.logFilePath) {
          try {
            this.appendLine(this.logFilePath, logLine + "\n");
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            emitDiagnostic(`[LOGGER] Failed to write to log file: ${err.message}
${err.stack ?? ""}
`);
          }
        } else {
          emitDiagnostic(logLine + "\n");
        }
      }
      debug(component, message, context, data) {
        this.log(0 /* DEBUG */, component, message, context, data);
      }
      info(component, message, context, data) {
        this.log(1 /* INFO */, component, message, context, data);
      }
      warn(component, message, context, data) {
        this.log(2 /* WARN */, component, message, context, data);
      }
      /**
       * Installs (or clears, with null) the optional error sink. Called once by
       * worker/telemetry init to bridge logged errors into captureException without
       * the logger importing telemetry (no import cycle). Never throws.
       */
      setErrorSink(sink) {
        errorSink = sink;
      }
      error(component, message, context, data) {
        this.log(3 /* ERROR */, component, message, context, data);
        this.routeErrorToSink(message, context, data);
      }
      /**
       * Routes a logged Error through the optional error sink (captureException).
       * Only fires when `data` is an actual Error so we never ship arbitrary log
       * payloads as exceptions. Swallow-all: the sink failing (or being absent)
       * must never break logging. `failure()` delegates to `error()`, so it is
       * covered too — but it passes the same `data` object, so we de-dupe by only
       * routing from the single `error()` entry point.
       */
      routeErrorToSink(message, context, data) {
        try {
          if (!errorSink || !(data instanceof Error)) return;
          errorSink(data);
        } catch {
        }
      }
      dataIn(component, message, context, data) {
        this.info(component, `→ ${message}`, context, data);
      }
      dataOut(component, message, context, data) {
        this.info(component, `← ${message}`, context, data);
      }
      success(component, message, context, data) {
        this.info(component, `✓ ${message}`, context, data);
      }
      failure(component, message, context, data) {
        this.error(component, `✗ ${message}`, context, data);
      }
    };
    logger = new Logger();
  }
});

// src/shared/hook-constants.ts
function hookProcessOverheadMs(platform = process.platform) {
  return platform === "win32" ? 8e3 : 5e3;
}
function defaultSessionInitRequestTimeoutMs(platform = process.platform) {
  return HOOK_TIMEOUTS.SESSION_INIT_HOOK_CAP - hookProcessOverheadMs(platform);
}
function getTimeout(baseTimeout) {
  return process.platform === "win32" ? Math.round(baseTimeout * HOOK_TIMEOUTS.WINDOWS_MULTIPLIER) : baseTimeout;
}
var SESSION_INIT_HOOK_CAP_MS, HOOK_TIMEOUTS;
var init_hook_constants = __esm({
  "src/shared/hook-constants.ts"() {
    "use strict";
    SESSION_INIT_HOOK_CAP_MS = 15e3;
    HOOK_TIMEOUTS = {
      HEALTH_CHECK: 3e3,
      // Worker health check (3s — healthy worker responds in <100ms)
      API_REQUEST: 3e4,
      // Hook API calls should outlive health probes but stay below hook caps
      SESSION_INIT_HOOK_CAP: SESSION_INIT_HOOK_CAP_MS,
      SESSION_INIT_REQUEST: 1e4,
      // POSIX default for the whole session-init round-trip (plan-17 step 3): the cap minus the hook's own overhead; never Windows-scaled up
      SESSION_INIT_REQUEST_MAX: SESSION_INIT_HOOK_CAP_MS - 1e3,
      // Upper bound for CLAUDE_MEM_SESSION_INIT_TIMEOUT_MS: process-exit margin below the cap
      HOOK_READINESS_WAIT: 1e4,
      // Per-hook wait for an already-starting worker to finish DB/search init
      POST_SPAWN_WAIT: 15e3,
      // Wait for daemon to start after spawn (starts in <1s on Linux, 6-8s on macOS with Chroma)
      READINESS_WAIT: 3e4,
      // Wait for DB + search init after spawn (typically <5s)
      PORT_IN_USE_WAIT: 3e3,
      // Wait when port occupied but health failing
      POWERSHELL_COMMAND: 1e4,
      // PowerShell process enumeration (10s - typically completes in <1s)
      WINDOWS_MULTIPLIER: 1.5
    };
  }
});

// src/shared/api-agent-limits.ts
var DEFAULT_API_AGENT_LIMITS;
var init_api_agent_limits = __esm({
  "src/shared/api-agent-limits.ts"() {
    "use strict";
    DEFAULT_API_AGENT_LIMITS = { timeoutMs: 6e5, maxOutputTokens: 16e3 };
  }
});

// src/shared/openrouter-base-url.ts
function isOpenRouterApiUrl(apiUrl) {
  try {
    return new URL(apiUrl).hostname.toLowerCase() === "openrouter.ai";
  } catch {
    return false;
  }
}
var init_openrouter_base_url = __esm({
  "src/shared/openrouter-base-url.ts"() {
    "use strict";
    init_logger();
  }
});

// src/shared/install-port.ts
import { createHash } from "crypto";
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join6, resolve as resolve2, win32 } from "path";
function defaultDataDir() {
  return process.env.CLAUDE_MEM_DATA_DIR || join6(homedir4(), ".claude-mem");
}
function readSettings(dataDir) {
  const settingsPath = join6(expandHome(dataDir), "settings.json");
  if (!existsSync4(settingsPath)) return null;
  try {
    const document = JSON.parse(readFileSync3(settingsPath, "utf8").replace(/^\uFEFF/, ""));
    const nested = document.env;
    return nested && typeof nested === "object" && !Array.isArray(nested) && Object.keys(nested).some((key) => key.startsWith("CLAUDE_MEM_")) ? nested : document;
  } catch {
    return null;
  }
}
function hasLegacyWindowsWorkerPort(dataDir) {
  return readSettings(dataDir)?.CLAUDE_MEM_WORKER_PORT === LEGACY_WINDOWS_WORKER_PORT;
}
function hasLegacyWindowsServerPort(dataDir) {
  const settings = readSettings(dataDir);
  return ["CLAUDE_MEM_SERVER_URL", "CLAUDE_MEM_SERVER_BETA_URL"].some((key) => {
    const value = settings?.[key];
    if (typeof value !== "string") return false;
    try {
      return new URL(value).port === String(LEGACY_WINDOWS_SERVER_PORT);
    } catch {
      return false;
    }
  });
}
function getInstallPortOffset(dataDir = defaultDataDir(), options = {}) {
  const platform = options.platform ?? process.platform;
  const uid = options.uid === void 0 ? typeof process.getuid === "function" ? process.getuid() : null : options.uid;
  if (uid !== null) return (uid % 100 + 100) % 100;
  if (platform === "win32" && hasLegacyWindowsWorkerPort(dataDir)) return LEGACY_WINDOWS_PORT_OFFSET;
  const expandedDataDir = expandHome(dataDir, platform);
  let normalizedDataDir = platform === "win32" ? win32.resolve(expandedDataDir) : resolve2(expandedDataDir);
  if (platform === "win32") normalizedDataDir = normalizedDataDir.toLowerCase();
  return createHash("sha256").update(normalizedDataDir, "utf8").digest().readUInt32BE(0) % 100;
}
function getDefaultWorkerPort(dataDir, options) {
  return WORKER_PORT_BASE + getInstallPortOffset(dataDir, options);
}
function getDefaultServerPort(dataDir = defaultDataDir(), options = {}) {
  const platform = options.platform ?? process.platform;
  const uid = options.uid === void 0 ? typeof process.getuid === "function" ? process.getuid() : null : options.uid;
  if (platform === "win32" && uid === null && hasLegacyWindowsServerPort(dataDir)) {
    return LEGACY_WINDOWS_SERVER_PORT;
  }
  return SERVER_PORT_BASE + getInstallPortOffset(dataDir, options);
}
var WORKER_PORT_BASE, SERVER_PORT_BASE, LEGACY_WINDOWS_WORKER_PORT, LEGACY_WINDOWS_PORT_OFFSET, LEGACY_WINDOWS_SERVER_PORT;
var init_install_port = __esm({
  "src/shared/install-port.ts"() {
    "use strict";
    init_expand_home();
    WORKER_PORT_BASE = 37700;
    SERVER_PORT_BASE = 37877;
    LEGACY_WINDOWS_WORKER_PORT = "37777";
    LEGACY_WINDOWS_PORT_OFFSET = 77;
    LEGACY_WINDOWS_SERVER_PORT = 37954;
  }
});

// src/shared/SettingsDefaultsManager.ts
import { readFileSync as readFileSync4, existsSync as existsSync5, writeFileSync } from "fs";
import { basename as basename3, dirname as dirname4, join as join7 } from "path";
import { homedir as homedir5, hostname } from "os";
import { parseEnv } from "util";
function coercePersistedSettingValue(value) {
  return typeof value === "boolean" ? String(value) : value;
}
function envFileSetsAnthropicBaseUrl(settingsPath) {
  const envFile = process.env.CLAUDE_MEM_ENV_FILE ?? join7(dirname4(settingsPath), ".env");
  try {
    if (!existsSync5(envFile)) return false;
    const parsed = parseEnv(stripUtf8Bom(readFileSync4(envFile, "utf-8")));
    return Boolean(parsed.ANTHROPIC_BASE_URL);
  } catch {
    return true;
  }
}
function hasPinnedShippedHaiku(flatSettings, settingsPath) {
  const model = flatSettings.CLAUDE_MEM_MODEL;
  if (typeof model !== "string" || !PINNED_SHIPPED_HAIKU_MODELS.has(model.trim())) {
    return false;
  }
  const authMethod = typeof flatSettings.CLAUDE_MEM_CLAUDE_AUTH_METHOD === "string" ? flatSettings.CLAUDE_MEM_CLAUDE_AUTH_METHOD.trim() : "";
  return authMethod !== "gateway" && !envFileSetsAnthropicBaseUrl(settingsPath);
}
function hasRetiredOpenRouterDefault(flatSettings) {
  const model = flatSettings.CLAUDE_MEM_OPENROUTER_MODEL;
  if (typeof model !== "string" || !RETIRED_OPENROUTER_DEFAULT_MODELS.has(model.trim())) {
    return false;
  }
  const baseUrl = typeof flatSettings.CLAUDE_MEM_OPENROUTER_BASE_URL === "string" ? flatSettings.CLAUDE_MEM_OPENROUTER_BASE_URL.trim() : "";
  return baseUrl === "" || isOpenRouterApiUrl(baseUrl);
}
function raisedDefaultMarkerPath(settingsPath, raised) {
  return join7(dirname4(settingsPath), `.${basename3(settingsPath)}.${raised.markerTag}`);
}
function markRaisedDefaultDone(settingsPath, raised) {
  try {
    writeFileSync(raisedDefaultMarkerPath(settingsPath, raised), (/* @__PURE__ */ new Date()).toISOString(), {
      encoding: "utf-8",
      mode: 384
    });
  } catch {
  }
}
function migratedCloudSyncHubUrl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  try {
    const hostname2 = new URL(trimmed).hostname;
    if (hostname2 === LEGACY_CLOUD_SYNC_HUB_HOST || hostname2 === DIRECT_SUPABASE_CLOUD_SYNC_HUB_HOST) {
      return CANONICAL_CLOUD_SYNC_HUB_URL;
    }
  } catch {
    return null;
  }
  return null;
}
var LEGACY_TELEGRAM_TRIGGER_TYPES, LEGACY_CLOUD_SYNC_HUB_HOST, DIRECT_SUPABASE_CLOUD_SYNC_HUB_HOST, CANONICAL_CLOUD_SYNC_HUB_URL, RETIRED_OPENROUTER_DEFAULT_MODELS, PINNED_SHIPPED_HAIKU_MODELS, DEFAULT_LLM_TIMEOUT_MS, CHANGED_SHIPPED_DEFAULTS, raisedDefaultFailuresReported, SettingsDefaultsManager;
var init_SettingsDefaultsManager = __esm({
  "src/shared/SettingsDefaultsManager.ts"() {
    "use strict";
    init_hook_constants();
    init_api_agent_limits();
    init_atomic_json();
    init_openrouter_base_url();
    init_settings_document();
    init_expand_home();
    init_install_port();
    LEGACY_TELEGRAM_TRIGGER_TYPES = "security_alert";
    LEGACY_CLOUD_SYNC_HUB_HOST = "sync-hub.black-pond-afbb.workers.dev";
    DIRECT_SUPABASE_CLOUD_SYNC_HUB_HOST = "ziczmqtpmaxbornfghye.supabase.co";
    CANONICAL_CLOUD_SYNC_HUB_URL = "https://sync.cmem.ai";
    RETIRED_OPENROUTER_DEFAULT_MODELS = /* @__PURE__ */ new Set([
      "xiaomi/mimo-v2-flash:free"
    ]);
    PINNED_SHIPPED_HAIKU_MODELS = /* @__PURE__ */ new Set([
      "claude-haiku-4-5-20251001",
      "claude-haiku-4-5"
    ]);
    DEFAULT_LLM_TIMEOUT_MS = 18e4;
    CHANGED_SHIPPED_DEFAULTS = [
      // Seeded from #4125 (13.25.2) until #4278.
      { key: "CLAUDE_MEM_LLM_TIMEOUT_MS", legacy: "30000", markerTag: "llm-timeout-migrated-v1", unit: "ms", applyOnlyWhenSaved: false },
      // Seeded from #4136 until the field pass got the same deadline.
      { key: "CLAUDE_MEM_FIELD_OPTIMIZE_TIMEOUT_MS", legacy: "30000", markerTag: "field-optimize-timeout-migrated-v1", unit: "ms", applyOnlyWhenSaved: false },
      // Seeded 'false' from #4341 (image capture, off) until capture became on by
      // default. No viewer switch existed before then, so a saved 'false' is almost
      // always the seeded value. A 'false' typed by hand reads the same and moves
      // too; typing it changed nothing while 'false' was the default. After this
      // one move, a 'false' saved by the "Keep images" switch or by hand stays.
      { key: "CLAUDE_MEM_MEDIA_CAPTURE_ENABLED", legacy: "false", markerTag: "media-capture-default-on-v1", unit: "", applyOnlyWhenSaved: true },
      // Seeded '400000' from #3800 until the default came down to 100000 (#5023):
      // an observer turn measured about 100K tokens at 400000 and about 26K at
      // 100000. Any other saved value is a deliberate choice and stays. A budget
      // too long only costs tokens, so a failed rewrite may use the new default in
      // memory, like the deadlines.
      { key: "CLAUDE_MEM_OBSERVER_MAX_CONVERSATION_CHARS", legacy: "400000", markerTag: "observer-max-conversation-chars-v1", unit: " chars", applyOnlyWhenSaved: false }
    ];
    raisedDefaultFailuresReported = /* @__PURE__ */ new Set();
    SettingsDefaultsManager = class {
      static DEFAULTS = {
        CLAUDE_MEM_SKILLS_DISABLED: "",
        CLAUDE_MEM_MEMORY_SEARCH_HOOK_ENABLED: "true",
        CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "true",
        // Explicit JSON [{path, project, platformSource?}]. Empty means no files imported.
        CLAUDE_MEM_MEMORY_WATCH_ROOTS: "",
        // Never a dated id: `haiku` is Claude Code's alias for the newest Haiku, so the
        // note-taker moves to each new (cheaper) release on its own. See CLAUDE.md, Model policy.
        CLAUDE_MEM_MODEL: "haiku",
        CLAUDE_MEM_CONTEXT_OBSERVATIONS: "50",
        CLAUDE_MEM_SESSION_START_INCLUDE_ALL_SOURCES: "false",
        CLAUDE_MEM_CONTEXT_PROJECTS: "current",
        // 'current' = this checkout only; 'all' = SessionStart context spans every project
        CLAUDE_MEM_WORKER_PORT: String(getDefaultWorkerPort()),
        CLAUDE_MEM_WORKER_HOST: "127.0.0.1",
        CLAUDE_MEM_WORKER_URL: "",
        CLAUDE_MEM_WORKER_INGEST_TOKEN: "",
        CLAUDE_MEM_WORKER_INGEST_MAX_BYTES: "5242880",
        CLAUDE_MEM_HOOK_SPOOL_TRANSPORT: "auto",
        CLAUDE_MEM_ALLOWED_ORIGINS: "",
        // Comma-separated browser origins allowed to call the worker
        // cross-origin besides http://localhost:* / http://127.0.0.1:*.
        // Their host names also pass the DNS-rebinding Host check.
        CLAUDE_MEM_PUBLIC_URL: "",
        // Browser-reachable base for the live-view URL when the
        // worker runs behind a port-forward (e.g.
        // https://37700.host.<user>.<domain>). Empty => localhost.
        CLAUDE_MEM_API_TIMEOUT_MS: String(getTimeout(HOOK_TIMEOUTS.API_REQUEST)),
        CLAUDE_MEM_SESSION_INIT_TIMEOUT_MS: String(defaultSessionInitRequestTimeoutMs()),
        // 10s; 7s on Windows, whose hook start-up the budget never sees
        CLAUDE_MEM_HOOK_HANDOFF_TIMEOUT_MS: "250",
        // Worker idle exit (opt-in; minimum 60): after this many seconds with no
        // session activity, no queued work, no open or recent requests and no AI
        // interaction, the worker shuts itself down through the graceful stop
        // sequence (shutdown_reason 'idle'). The next hook that reads memory
        // starts it again. Never armed with CLAUDE_MEM_WORKER_AUTOSTART=false or
        // while transcript watches run.
        CLAUDE_MEM_IDLE_EXIT_SEC: "0",
        CLAUDE_MEM_SKIP_TOOLS: "ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion",
        CLAUDE_MEM_SKIP_BASH_PATTERNS: "",
        // Regex matched against a shell command (Bash; PowerShell; Codex exec_command); when it matches, the observation is skipped. Empty = capture every command. Use alternation for several patterns, e.g. ^(ls|cat|pwd)\b
        CLAUDE_MEM_SKIP_SUBAGENT_OBSERVATIONS: "false",
        // #2736 — default off preserves current behavior; set 'true' to skip every subagent observation (recommended for heavy Dynamic Workflows users)
        CLAUDE_MEM_SKIP_AGENT_TYPES: "",
        // #2736 — default empty preserves current behavior; recommended value 'workflow-subagent' to drop Dynamic Workflows fan-out noise
        CLAUDE_MEM_CAPTURE_ADVISOR_CALLS: "false",
        // #3165 — opt-in: the Stop hook scans the transcript's tail for advisor calls and stores the advice locally (worker runtime only)
        CLAUDE_MEM_DELIVERABLES_ENABLED: "true",
        // 'false' = the Stop hook neither copies deliverables into the bucket nor records them; files already in the bucket stay
        // Deliberate divergence from the installer prompt: the interactive
        // provider prompt defaults to 'cmem' (the hosted observer), but headless
        // installs land here — no delivered key exists headlessly, so the settings
        // default stays 'claude'.
        CLAUDE_MEM_PROVIDER: "claude",
        CLAUDE_MEM_PROVIDER_BY_SOURCE: "",
        CLAUDE_MEM_OBSERVER_ENABLED: "true",
        // 'false' disables new observation and session-summary capture calls
        // Image capture is on: the viewer's "Keep images" switch turns it off.
        // No total local cap, by the owner's call (2026-11-05): each image is
        // bounded (MEDIA_LIMITS in media-contract.ts: 3 MiB canonical, 256 KiB
        // model copy), an event keeps at most 4, and the local database and
        // transcripts have no total cap either. Images stay until their event is
        // deleted. Installs seeded with 'false' move once (CHANGED_SHIPPED_DEFAULTS).
        CLAUDE_MEM_MEDIA_CAPTURE_ENABLED: "true",
        // Stays off: sending images to the observer model is separate and paid.
        CLAUDE_MEM_MEDIA_INFERENCE_ENABLED: "false",
        CLAUDE_MEM_CODEX_MODEL: "",
        // Empty uses the Codex default model.
        CLAUDE_MEM_CODEX_PATH: "codex",
        CLAUDE_MEM_CODEX_REASONING_EFFORT: "low",
        CLAUDE_MEM_CODEX_MAX_CONCURRENT_AGENTS: "2",
        CLAUDE_MEM_CODEX_OBSERVATION_BATCH_SIZE: "8",
        CLAUDE_MEM_CODEX_OBSERVATION_BATCH_MAX_CHARS: "32000",
        CLAUDE_MEM_CLAUDE_OBSERVATION_BATCH_SIZE: "1",
        // Queued same-context events per Claude observer prompt (1-32). 1 = one event per prompt.
        CLAUDE_MEM_CLAUDE_AUTH_METHOD: "subscription",
        // Default to logged-in Claude SDK auth (not API key)
        CLAUDE_MEM_GEMINI_API_KEY: "",
        // Empty by default, can be set via UI or env
        CLAUDE_MEM_GEMINI_API_KEYS: "",
        // Optional extra keys (newline/comma separated). Rotates on rate_limit/quota_exhausted/auth_invalid — see src/shared/api-key-pool.ts.
        CLAUDE_MEM_GEMINI_MODEL: "gemini-flash-latest",
        // Google-maintained alias → current GA Flash model (stays valid for new API keys)
        CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED: "true",
        // Rate limiting ON by default for free tier users
        CLAUDE_MEM_OPENROUTER_API_KEY: "",
        // Empty by default, can be set via UI or env
        CLAUDE_MEM_OPENROUTER_API_KEYS: "",
        // Optional extra keys (newline/comma separated). Rotates on rate_limit/quota_exhausted/auth_invalid — see src/shared/api-key-pool.ts.
        // Default OpenRouter model (free tier). The same id is hard-coded in
        // src/ui/viewer/constants/settings.ts (DEFAULT_SETTINGS) and three times in
        // openclaw/install.sh (settings defaults, openrouter override, completion
        // summary); tests/shared/settings-defaults-manager.test.ts keeps them equal.
        // Changing it strands installs that were seeded with the old id: add that
        // id to RETIRED_OPENROUTER_DEFAULT_MODELS.
        CLAUDE_MEM_OPENROUTER_MODEL: "cohere/north-mini-code:free",
        CLAUDE_MEM_OPENROUTER_BASE_URL: "",
        // #2382/#2590/#2622/#2393 — optional OpenAI-compatible base URL (e.g. https://api.deepseek.com, http://localhost:1234/v1). Empty = default OpenRouter endpoint.
        CLAUDE_MEM_OPENROUTER_TEMPERATURE: "",
        CLAUDE_MEM_OPENROUTER_SITE_URL: "",
        // Optional: for OpenRouter analytics
        CLAUDE_MEM_OPENROUTER_APP_NAME: "claude-mem",
        // App name for OpenRouter analytics
        // JSON object of provider-specific request fields, e.g. {"reasoning":{"enabled":false}}.
        // Settings file or env only (never the HTTP settings API); never sent to the cmem gateway.
        CLAUDE_MEM_OPENROUTER_EXTRA_BODY: "",
        CLAUDE_MEM_OPENROUTER_REASONING_EFFORT: "",
        // none | minimal | low | medium | high. Empty disables reasoning on openrouter.ai and the cmem gateway. A set effort is openrouter.ai only.
        CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
        // Named endpoint preset for the openai-compatible provider (nvidia-nim, deepseek, groq, together, vllm, ollama, lmstudio). Empty = 'custom', configure the base URL by hand.
        CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
        // Key for the openai-compatible provider. Never shares the OpenRouter key or its attribution headers.
        CLAUDE_MEM_OPENAI_COMPAT_API_KEYS: "",
        // Optional extra keys (newline/comma separated) for the openai-compatible provider.
        CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
        // OpenAI-compatible base URL, e.g. https://integrate.api.nvidia.com/v1. Overrides the preset's base URL when set.
        CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
        // Model id passed verbatim. Empty = the preset's default model.
        CLAUDE_MEM_OPENAI_COMPAT_REASONING_EFFORT: "",
        CLAUDE_MEM_OPENAI_COMPAT_REASONING: "",
        // off | on. Empty = off: every openai-compatible request sends reasoning:{enabled:false}. "on" leaves reasoning to the endpoint.
        CLAUDE_MEM_OPENAI_COMPAT_OBSERVATION_BATCH_SIZE: "1",
        // Queued same-context events per observer prompt (1-32); opt-in.
        CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
        // 'claude' (the Anthropic plan; '' means this too) | 'codex' (the local Codex CLI's ChatGPT login) | 'gemini' | 'openrouter' | 'openai-compatible' | 'off': where observer work goes while the selected provider cannot serve (spent allowance, rate limit or over capacity past its retries, outage, repeated unusable replies). Claude is used only when a Claude login or key exists; Codex only when a ChatGPT login exists. Values: QUOTA_FALLBACK_OPTIONS in src/ui/provider-options.ts
        CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "",
        // Claude model for a Claude fallback run; '' = CLAUDE_MEM_MODEL and tier routing. Ignored for other fallbacks (only ClaudeProvider reads modelOverride)
        CLAUDE_MEM_QUOTA_FALLBACK_AUTH_METHOD: "",
        // '' (off) | 'subscription' | 'api-key': the Claude credential to run on while the primary one is held for quota. 'subscription': the Claude Code login, for a spent ANTHROPIC_API_KEY. 'api-key': ANTHROPIC_FALLBACK_API_KEY from .env, for a login that is spent or paused by the quota guard. Tried before CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER
        CLAUDE_MEM_QUOTA_THRESHOLD_FIVE_HOUR: "0.95",
        // Quota guard (#4230): subscription observer stops at this utilization of the window. A provider rejection always stops it
        CLAUDE_MEM_QUOTA_THRESHOLD_SEVEN_DAY: "0.93",
        CLAUDE_MEM_QUOTA_THRESHOLD_SEVEN_DAY_OPUS: "0.93",
        CLAUDE_MEM_QUOTA_THRESHOLD_SEVEN_DAY_SONNET: "0.92",
        CLAUDE_MEM_QUOTA_THRESHOLD_OVERAGE: "0.95",
        CLAUDE_MEM_DATA_DIR: join7(homedir5(), ".claude-mem"),
        CLAUDE_MEM_LOG_LEVEL: "INFO",
        CLAUDE_MEM_PYTHON_VERSION: "3.13",
        CLAUDE_CODE_PATH: "",
        // Empty means auto-detect via 'which claude'
        CLAUDE_MEM_CLAUDE_CONFIG_DIR: "",
        // #2753 — override CLAUDE_CONFIG_DIR for the keychain lookup + SDK subprocess only; empty = fall through to process.env.CLAUDE_CONFIG_DIR/default
        CLAUDE_MEM_OBSERVER_CLAUDE_CONFIG_DIR: "",
        // #4689 — transcript-only CLAUDE_CONFIG_DIR for the SDK subprocess (out of ~/.claude/projects); credentials stay on the default profile; only honored when CLAUDE_MEM_CLAUDE_CONFIG_DIR is empty
        CLAUDE_MEM_MODE: "code",
        // Default mode profile
        CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS: "false",
        CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS: "false",
        CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES: "",
        // Comma-separated observation types to inject. Empty = every type in the active mode
        CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS: "",
        // Comma-separated observation concepts to inject. Empty = every concept in the active mode
        CLAUDE_MEM_CONTEXT_FULL_COUNT: "0",
        CLAUDE_MEM_CONTEXT_FULL_FIELD: "narrative",
        CLAUDE_MEM_CONTEXT_SESSION_COUNT: "10",
        CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY: "true",
        CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE: "false",
        CLAUDE_MEM_CONTEXT_MAIN_AGENT_ONLY: "true",
        CLAUDE_MEM_REINFORCE_ALPHA: "0",
        // ACT-R reinforcement weight for SessionStart ranking. 0 = off (the N most recent observations, unchanged); >0 lets re-confirmed older observations climb into the window
        CLAUDE_MEM_CONTEXT_SHOW_TERMINAL_OUTPUT: "true",
        CLAUDE_MEM_WELCOME_HINT_ENABLED: "true",
        CLAUDE_MEM_WORK_STATE_ENABLED: "true",
        // 'false' = no work-state section at SessionStart and no work_state_* MCP tools, for hosts that track work their own way
        CLAUDE_MEM_AUTO_CLEAR_ENABLED: "false",
        // Claude Code mod (src/mods/auto-clear, in plugin/hooks/hooks-module.js): at CLAUDE_MEM_AUTO_CLEAR_PERCENT of the context window, Claude saves its work state, then /clear runs and a continuation prompt built from that save is sent ("continue" when the save left its blanks out). Off unless set to 'true'. Needs work state on
        CLAUDE_MEM_AUTO_CLEAR_PERCENT: "40",
        // Context window use (1-95) that starts the auto-clear. 40: the maintainer's choice (raised from 33 on 2026-11-17); src/mods/auto-clear/settings.ts keeps the same value
        CLAUDE_MEM_FILE_READ_GATE_ENABLED: "true",
        // 'false' = never block a full-file Read; the file's observation timeline is still added as context
        CLAUDE_MEM_LINE_ANCHORS_ENABLED: "false",
        // #4943, opt-in: the worker records line anchors in observation metadata and the file-context timeline shows where that code is now (@L123) or "(code changed since)". Only 'true' turns it on
        CLAUDE_MEM_FOLDER_CLAUDEMD_ENABLED: "false",
        CLAUDE_MEM_FOLDER_USE_LOCAL_MD: "false",
        // When true, writes to CLAUDE.local.md instead of CLAUDE.md
        CLAUDE_MEM_TRANSCRIPTS_ENABLED: "true",
        CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH: join7(homedir5(), ".claude-mem", "transcript-watch.json"),
        CLAUDE_MEM_CODEX_TRANSCRIPT_INGESTION: "false",
        // Codex subagent rollouts through the transcript watch: each one's tool
        // calls are new observer spend (the gateway allowance, or the user's own
        // plan), so capture is opt-in (Wave 3 gate R4-5).
        CLAUDE_MEM_CODEX_SUBAGENT_INGESTION: "false",
        CLAUDE_MEM_MAX_CONCURRENT_AGENTS: "2",
        // Max concurrent Claude SDK agent subprocesses
        // Retire an observer conversation past this size and start a fresh generation (#3800).
        // 100000, not the first default of 400000: #5023 measured about 100K tokens per
        // observer turn at 400000 and about 26K at 100000. Installs seeded with '400000'
        // move once (CHANGED_SHIPPED_DEFAULTS).
        CLAUDE_MEM_OBSERVER_MAX_CONVERSATION_CHARS: "100000",
        CLAUDE_MEM_OBSERVER_THINKING: "disabled",
        // Observer thinking param: 'disabled' (shipped) | 'adaptive' | 'enabled[:budget]' | 'omit' — an always-thinking gateway upstream rejects 'disabled' with 400/1210 (#4732)
        CLAUDE_MEM_OBSERVER_CONTEXT_WINDOW: "",
        // Observer model context window in tokens; '' = resolve it (OpenRouter catalogue, Gemini/Claude maps). Lowers the budget above to half the window (#3625)
        CLAUDE_MEM_OBSERVER_MAX_OUTPUT_TOKENS: "4096",
        // max_tokens / max_completion_tokens / Gemini maxOutputTokens on every HTTP observer request (#3868)
        CLAUDE_MEM_OBSERVE_BARE_PROMPTS: "false",
        // 'true' restores one observer call per user prompt; 'false' carries the prompt on the next tool event's call
        CLAUDE_MEM_HOOK_FAIL_LOUD_THRESHOLD: "3",
        // After N consecutive worker-unreachable hook invocations, show the worker-outage notice once per session (never blocks; plan-17)
        CLAUDE_MEM_REDACT_ENABLED: "false",
        // Opt-in auto-redaction of common secret patterns (see docs/public/usage/auto-redaction.mdx)
        CLAUDE_MEM_REDACT_DISABLED_BUILTINS: "",
        // CSV of built-in pattern names to disable, e.g. 'jwt,slack_token'
        CLAUDE_MEM_REDACT_CUSTOM_PATTERNS: "[]",
        // JSON array of { name, regex } objects
        CLAUDE_MEM_REDACT_LOG_MATCHES: "false",
        // Log pattern,count per invocation (no payload)
        CLAUDE_MEM_REDACT_GENERIC_ENABLED: "false",
        // #4745 — opt-in: also redact un-prefixed credentials (password=, *_TOKEN=, *_SECRET=, *_API_KEY=, Authorization: Bearer, Authorization: Basic)
        CLAUDE_MEM_EXCLUDED_PROJECTS: "",
        // Comma-separated glob patterns for excluded project paths
        CLAUDE_MEM_PROJECT_ENVIRONMENTS: "[]",
        // JSON array of {"name","patterns","inherit"?}: directories matching an environment's globs share one project named after it; an explicit inherit list replaces the derived read keys ([] reads only the environment)
        CLAUDE_MEM_FOLDER_MD_EXCLUDE: "[]",
        // JSON array of folder paths to exclude from CLAUDE.md generation
        CLAUDE_MEM_FOLDER_MD_SKELETON_DENYLIST: "[]",
        // #2400 — JSON array of glob patterns; when a folder matches AND its generated CLAUDE.md would be empty/skeleton, skip injection (avoids polluting non-content dirs with empty skeletons). Default [] preserves existing behavior.
        CLAUDE_MEM_SEMANTIC_INJECT: "false",
        // Inject relevant past observations on every UserPromptSubmit (experimental, disabled by default)
        CLAUDE_MEM_SEMANTIC_INJECT_LIMIT: "5",
        // Top-N most relevant observations to inject per prompt
        CLAUDE_MEM_SEMANTIC_INJECT_FORMAT: "narrative",
        // 'narrative' = title + full narrative per match; 'index' = id + title + subtitle, expanded via get_observations
        CLAUDE_MEM_TIER_ROUTING_ENABLED: "true",
        // Route observations to models by complexity
        CLAUDE_MEM_TIER_SIMPLE_MODEL: "haiku",
        // Portable tier alias — works across Direct API, Bedrock, Vertex, Azure (see #1463)
        CLAUDE_MEM_TIER_SUMMARY_MODEL: "",
        // Empty = use default model for summaries
        CLAUDE_MEM_TIER_FAST_MODEL: "haiku",
        // #2289 — $TIER:fast resolves here (portable alias)
        CLAUDE_MEM_TIER_SMART_MODEL: "sonnet",
        // #2289 — $TIER:smart resolves here (portable alias)
        CLAUDE_MEM_CHROMA_ENABLED: "true",
        // Set to 'false' to disable Chroma and use SQLite-only search
        CLAUDE_MEM_CHROMA_MODE: "local",
        // 'local' uses persistent chroma-mcp via uvx, 'remote' connects to existing server
        CLAUDE_MEM_CHROMA_HOST: "127.0.0.1",
        CLAUDE_MEM_CHROMA_PORT: "8000",
        CLAUDE_MEM_CHROMA_SSL: "false",
        CLAUDE_MEM_CHROMA_API_KEY: "",
        CLAUDE_MEM_CHROMA_TENANT: "default_tenant",
        CLAUDE_MEM_CHROMA_DATABASE: "default_database",
        CLAUDE_MEM_CHROMA_PREWARM_TIMEOUT_MS: "120000",
        CLAUDE_MEM_CHROMA_MUTATION_TIMEOUT_MS: "600000",
        // Chroma embedding/index writes can exceed the MCP SDK's 60s default
        CLAUDE_MEM_CHROMA_MAX_PENDING_MUTATIONS: "5000",
        // Bound burst imports without changing normal live indexing
        CLAUDE_MEM_CHROMA_BACKFILL_PAUSE_RATIO: "1",
        // Bulk backfill sleeps (row write time x ratio) after each row: 1 = at most ~50% duty, 0 = off, max 10. Live sync is never paced
        CLAUDE_MEM_CHROMA_PROCESS_NICE: "10",
        // chroma-mcp starts as `nice -n N uvx ...` where `nice` exists (not Windows). 0 = off, max 19
        CLAUDE_MEM_CHROMA_MAX_THREADS: "0",
        // Opt-in cap on chroma-mcp's embedding threads and Linux CPU affinity (`taskset`). 0 = off: 39f110260 removed an always-on cap that slowed backfill. 2 suits machines where chroma-mcp pins cores (#6365)
        // Embedding function used when creating the Chroma collection. 'default' is
        // the local all-MiniLM-L6-v2 (English-tuned). The pinned chroma-mcp also
        // accepts 'openai', 'cohere', 'jina', 'voyageai' and 'roboflow'; those are
        // API-backed, need the vendor's API key in the environment, and send your
        // memory text to that vendor. Any other value is rejected. Applies to new
        // collections only — changing it requires re-indexing.
        CLAUDE_MEM_CHROMA_EMBEDDING_FUNCTION: "default",
        // The server's search by meaning (pgvector): it embeds every observation
        // in process, existing rows in the background at startup. 'true'
        // turns it on and 'false' off. 'auto' turns it on for a new database and
        // leaves a database from before it keyword-only, so an upgrade adds no
        // embedding work until that deployment sets 'true'.
        CLAUDE_MEM_SERVER_VECTOR_SEARCH: "auto",
        // A server start that finds stored observations without vectors from the
        // current model (search by meaning just turned on, or the model changed)
        // embeds them in the background, which can take hours on a large store.
        // That start caps the embedder at this many CPU threads until the next
        // restart: empty is half the machine's threads, 0 is every thread. This
        // applies to the hosted server only: local Chroma uses
        // CLAUDE_MEM_CHROMA_MAX_THREADS, CLAUDE_MEM_CHROMA_PROCESS_NICE, and
        // CLAUDE_MEM_CHROMA_BACKFILL_PAUSE_RATIO.
        CLAUDE_MEM_EMBEDDING_BACKFILL_THREADS: "",
        // Embedding model the server's search by meaning uses: a key of
        // EMBEDDING_MODELS in src/services/vector/models.ts, which lists them and
        // their vector widths. 'all-MiniLM-L6-v2' is Chroma's default
        // (English-tuned). Any other value is rejected. Changing it re-embeds
        // every observation, and search by meaning covers only rows already
        // re-embedded until that finishes.
        CLAUDE_MEM_EMBEDDING_MODEL: "all-MiniLM-L6-v2",
        CLAUDE_MEM_CHROMA_UVX_PATH: "",
        // Empty = search uv's install folders, then PATH (#4195)
        CLAUDE_MEM_SEARCH_RECENCY_DAYS: "90",
        // Date-less semantic search only ranks matches from the last N days (#4770). 0 = no window (every match eligible); an explicit dateStart/dateEnd always wins. Restart the worker after changing it
        // Worker-native cloud sync: credentials come from cmem.ai → Connect.
        CLAUDE_MEM_CLOUD_SYNC_TOKEN: "",
        CLAUDE_MEM_CLOUD_SYNC_USER_ID: "",
        CLAUDE_MEM_CLOUD_SYNC_HUB_URL: "",
        // sync-hub base URL (e.g. https://sync.cmem.ai). Empty = sync OFF
        CLAUDE_MEM_CLOUD_SYNC_DEVICE_ID: "",
        // Minted at first CloudSync start, then persisted back here
        CLAUDE_MEM_CLOUD_SYNC_DEVICE_NAME: hostname(),
        // Human-readable label for the cmem.ai Devices panel
        CLAUDE_MEM_CLOUD_SYNC_WS: "true",
        // Live updates (Supabase Realtime `advance` broadcasts). 'false' disables live updates — sync stays fully correct, just poll-latency (prime directive #2)
        CLAUDE_MEM_CLOUD_SYNC_KEEP_PULLING: "false",
        // 'true' keeps pulling with no sessions running instead of suspending after an hour (the cloud viewer replica, which runs no hooks)
        CLAUDE_MEM_CLOUD_SYNC_CONTENT_BATCH_SIZE: "40",
        // Drain page size; 200-op content pushes timed out under hub projection_busy
        CLAUDE_MEM_CLOUD_SYNC_REQUEST_TIMEOUT_MS: "90000",
        // Content-push AbortSignal; matches hub PROJECTION_LEASE_MS (90s)
        CLAUDE_MEM_TEAMBRAIN_URL: "",
        // TeamBrain base URL (e.g. https://cmem.ai). Empty = TeamBrain OFF
        CLAUDE_MEM_TEAMBRAIN_TEAM_ID: "",
        // The team this install joined (teambrain share/leave default to it)
        CLAUDE_MEM_LLM_TIMEOUT_MS: String(DEFAULT_LLM_TIMEOUT_MS),
        // Per-attempt deadline for non-streamed observer requests (retry.ts); streamed OpenRouter/OpenAI-compatible requests use a 90s idle timeout + 300s cap (streamed-chat-completion.ts)
        CLAUDE_MEM_FIELD_OPTIMIZE_TIMEOUT_MS: String(DEFAULT_LLM_TIMEOUT_MS),
        // Oversized-field condensation deadline (field-optimizer.ts); a request to the same backend, so the same deadline
        CLAUDE_MEM_LLM_STREAM_IDLE_TIMEOUT_MS: "90000",
        // Streamed request idle window (streamed-chat-completion.ts): silence that ends a stream. Self-hosted backends queue behind a load balancer, and the queue wait reads as idle (#4737) — raise it there. Literal because shared cannot import from the worker; a drift test pins it to the shipped constant
        CLAUDE_MEM_WORKER_HEARTBEAT_STALE_MS: "120000",
        // A silent worker whose liveness heartbeat is younger than this is slow, not dead (10000-3600000).
        CLAUDE_MEM_LOCAL_API_TOKEN: "",
        // Local API token. Empty = off. See the declaration above.
        CLAUDE_MEM_LOCAL_API_TOKEN_REMOTE_HOST: "",
        // The one remote worker that may receive it. Empty = loopback only.
        // claude-mem sign-in funnel state: all empty until the installer's
        // browser-login step writes them.
        CLAUDE_MEM_PRO_TRIAL_EMAIL: "",
        // Email the sign-in link was sent to (don't-re-nag marker)
        CLAUDE_MEM_PRO_TRIAL_AT: "",
        // ISO timestamp of the last sign-in link send
        CLAUDE_MEM_PRO_TRIAL_STATE: "",
        // 'link_sent' (started, credentials never picked up) | 'active' (done)
        CLAUDE_MEM_PRO_TRIAL_ENDS_AT: "",
        // ISO date the free trial ends (from poll trial.ends_at); '' when absent
        // Installer email opt-in: empty until someone shares an email.
        CLAUDE_MEM_ONLINE_SIGNUP_EMAIL: "",
        CLAUDE_MEM_ONLINE_SIGNUP_NOTE: "",
        CLAUDE_MEM_ONLINE_SIGNUP_AT: "",
        CLAUDE_MEM_ONLINE_SIGNUP_SENT: "",
        // 'true' once the waitlist accepted it, 'false' to retry next install
        CLAUDE_MEM_PRO_PLAN: "",
        // 'trial' | 'pro' | 'none' — plan reported by the poll on ready
        CLAUDE_MEM_PRO_FALLBACK_AT: "",
        // ISO timestamp when the cmem gateway terminally rejected the delivered key and memory fell back to the Anthropic plan; '' = no fallback. Event-driven only (never set from trial dates); cleared by a successful gateway response or fresh installer key material.
        CLAUDE_MEM_PRO_FALLBACK_MESSAGE: "",
        // The gateway's message for that rejection ('' = plan-neutral notice copy)
        CLAUDE_MEM_PRO_FALLBACK_ACTION: "",
        // The gateway's "what to do" for that rejection
        CLAUDE_MEM_PRO_FALLBACK_URL: "",
        // The gateway's link for that rejection ('' = the cmem.ai/pro renewal link)
        CLAUDE_MEM_PRO_MEMORY_KEY: "",
        // One-shot browser-pairing memory key, staged until provider selection (settings.json is chmod 0600 by the installer)
        CLAUDE_MEM_PRO_MEMORY_BASE_URL: "",
        // Backend-supplied endpoint paired with CLAUDE_MEM_PRO_MEMORY_KEY
        CLAUDE_MEM_PRO_MEMORY_MODEL: "",
        // Backend-supplied model paired with CLAUDE_MEM_PRO_MEMORY_KEY
        CLAUDE_MEM_WORK_VIEW_AUTO_REFRESH: "true",
        // 'false' = My Work never runs owner-goals / request-progress on its own (refresh.json in ~/.claude-mem/work-view)
        CLAUDE_MEM_WORK_VIEW_REFRESH_INTERVAL_MIN: "10",
        // Minutes between My Work's scheduled checks (each is a read-only database look; an agent runs only when something is due). 1440 = once a day. Read when the worker starts.
        CLAUDE_MEM_WORK_VIEW_SHARED_STATE: "",
        // Off until explicitly configured. A pinned 'false' remains an opt-out.
        CLAUDE_MEM_WORK_VIEW_COPY_PROVIDER: "",
        // '' uses OpenRouter only when it is the primary provider; openrouter/openai-compatible explicitly select that provider; off disables generated My Work copy
        CLAUDE_MEM_WORK_VIEW_COPY_MODEL: "",
        // Optional model override for generated My Work copy; empty uses the selected provider's configured model
        CLAUDE_MEM_WORK_VIEW_AGENT: "",
        // Which agent runs the My Work refresh: '' follows CLAUDE_MEM_PROVIDER and stays on one agent; claude-code/codex/gemini/opencode pick one; off runs none; all falls through every logged-in agent (#5189)
        CLAUDE_MEM_WORK_VIEW_CLAUDE_MODEL: "",
        // #5164 — model for every My Work refresh step on Claude Code (an alias like 'haiku'); empty keeps haiku/sonnet per step
        CLAUDE_MEM_WORK_VIEW_CODEX_MODEL: "",
        // #5164 — same for Codex; empty keeps the per-step table
        CLAUDE_MEM_WORK_VIEW_GEMINI_MODEL: "",
        // #5164 — same for Gemini; empty keeps flash-lite/flash per step
        CLAUDE_MEM_WORK_VIEW_OPENCODE_MODEL: "",
        // #5535 — model for every My Work refresh step on OpenCode ('provider/model'); empty uses OpenCode's configured default
        CLAUDE_MEM_WORK_VIEW_API_MODEL: "",
        // Model for every My Work refresh step on the selected API provider; empty keeps the provider's configured model
        CLAUDE_MEM_WORK_VIEW_API_TIMEOUT_MS: String(DEFAULT_API_AGENT_LIMITS.timeoutMs),
        CLAUDE_MEM_WORK_VIEW_MAX_OUTPUT_TOKENS: String(DEFAULT_API_AGENT_LIMITS.maxOutputTokens),
        CLAUDE_MEM_CORPUS_AGENT: "",
        // Which agent answers knowledge-corpus prime/query/reprime: '' uses the Claude Agent SDK (the Claude subscription); 'api' answers over chat completions on the selected openrouter/openai-compatible provider and spends that provider's credit
        CLAUDE_MEM_API_AGENT_EXTRA_BODY: "",
        // JSON object merged into every api agent request (My Work refresh, corpus), e.g. {"chat_template_kwargs":{"enable_thinking":false}} for vLLM (#6223). Parsed like CLAUDE_MEM_OPENROUTER_EXTRA_BODY; never sets reasoning or response_format. File/env only
        CLAUDE_MEM_WORK_VIEW_TEXT_LANGUAGE: "",
        // Language for My Work's generated text (titles, reviews, story), such as 'Turkish'. No extra model call; empty uses the language the grouping step finds in the owner's asks, decided once per run (#5660)
        // Automatic local DB snapshots (BackupManager). Off by default; opt-in.
        CLAUDE_MEM_BACKUP_ENABLED: "false",
        CLAUDE_MEM_BACKUP_INTERVAL_HOURS: "24",
        // Snapshot cadence in hours
        CLAUDE_MEM_BACKUP_RETAIN_COUNT: "7",
        // Keep the N most-recent snapshots
        CLAUDE_MEM_TELEGRAM_ENABLED: "true",
        CLAUDE_MEM_TELEGRAM_BOT_TOKEN: "",
        CLAUDE_MEM_TELEGRAM_CHAT_ID: "",
        CLAUDE_MEM_TELEGRAM_WRAPUPS_ENABLED: "true",
        // Session-end wrap-ups require an explicit project route before sending.
        CLAUDE_MEM_TELEGRAM_OBSERVATION_ALERTS_ENABLED: "false",
        // Existing per-observation Telegram alerts are opt-in.
        CLAUDE_MEM_TELEGRAM_WRAPUP_ROUTES: "{}",
        // JSON project-to-Telegram-route map; entries may carry bot-token overrides.
        CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES: "security_alert,sensitive",
        CLAUDE_MEM_TELEGRAM_TRIGGER_CONCEPTS: "",
        CLAUDE_MEM_GROK_BOT_AWARENESS_ENABLED: "false",
        // Opt-in agent IDs. Empty list = no writes.
        CLAUDE_MEM_GROK_BOT_AWARENESS_AGENT_IDS: "",
        CLAUDE_MEM_GROK_BOT_AWARENESS_TRIGGER_TYPES: "decision,bugfix,security_alert,sensitive",
        CLAUDE_MEM_GROK_BOT_AWARENESS_TRIGGER_CONCEPTS: "",
        // Optional brainbeat webhook: awareness-trigger matches are POSTed here
        // (off while empty). File/env only; both are masked on GET /api/settings.
        CLAUDE_MEM_GROK_BOT_WEBHOOK_URL: "",
        CLAUDE_MEM_GROK_BOT_WEBHOOK_SECRET: "",
        // Optional Notion export: each new observation is upserted into a Notion
        // database. Off by default; a no-op until the token and database id are set.
        // The token is file/env only and masked on GET /api/settings.
        CLAUDE_MEM_NOTION_ENABLED: "false",
        CLAUDE_MEM_NOTION_TOKEN: "",
        CLAUDE_MEM_NOTION_DATABASE_ID: "",
        CLAUDE_MEM_NOTION_AUTO_CREATE_PROPERTIES: "true",
        // Live Grok Bot Memory INDEX. Worker writes zz-claude-mem-inject.md as
        // observations land. Default on; no-op when no Grok Bot seats exist.
        CLAUDE_MEM_GROK_BOT_INJECT_ENABLED: "true",
        CLAUDE_MEM_GROK_BOT_INJECT_AGENT_IDS: "*",
        CLAUDE_MEM_GROK_BOT_INJECT_TIER: "episode",
        CLAUDE_MEM_GROK_BOT_INJECT_WINDOW: "80",
        CLAUDE_MEM_GROK_BOT_INJECT_FALLBACK: "house",
        CLAUDE_MEM_GROK_BOT_INJECT_PLATFORM_SOURCE: "",
        CLAUDE_MEM_GROK_BOT_INJECT_PROJECTS_BY_AGENT: "",
        CLAUDE_MEM_GROK_BOT_INJECT_MAX_LINE_CHARS: "160",
        CLAUDE_MEM_GROK_BOT_INJECT_DEBOUNCE_MS: "1500",
        CLAUDE_MEM_GROK_BOT_INJECT_STANDING_LINE: "",
        CLAUDE_MEM_CCS_ALIGN_ENABLED: "true",
        CLAUDE_MEM_CCS_ALIGN_VIEWER_IDS: "ccs-align",
        // Copy of the Grok needle list (D6). Same episodic needles, seat-owned cache.
        CLAUDE_MEM_CCS_ALIGN_TRIGGER_TYPES: "decision,bugfix,security_alert,sensitive",
        // Phase 2 rules-shadow patch stays a Prioritizer flag, not a silent /do (D8).
        CLAUDE_MEM_CCS_ALIGN_PATCH_SHADOWS: "false",
        CLAUDE_MEM_QUEUE_ENGINE: "sqlite",
        CLAUDE_MEM_REDIS_URL: "",
        CLAUDE_MEM_REDIS_HOST: "127.0.0.1",
        CLAUDE_MEM_REDIS_PORT: "6379",
        CLAUDE_MEM_REDIS_MODE: "external",
        CLAUDE_MEM_QUEUE_REDIS_PREFIX: `claude_mem_${process.env.CLAUDE_MEM_WORKER_PORT ?? String(getDefaultWorkerPort())}`,
        CLAUDE_MEM_AUTH_MODE: "api-key",
        CLAUDE_MEM_RUNTIME: "worker",
        // Phase 1a (cmem-sdk rename): canonical server settings keys. Hooks read
        // these first; the legacy `*_BETA_*` defaults below remain so existing
        // settings.json files still resolve correctly.
        CLAUDE_MEM_SERVER_URL: `http://127.0.0.1:${process.env.CLAUDE_MEM_SERVER_PORT ?? String(getDefaultServerPort())}`,
        // Default server runtime URL — aligned with the per-install port fallback
        CLAUDE_MEM_SERVER_API_KEY: "",
        // Local hook API key, populated by installer when runtime=server
        CLAUDE_MEM_SERVER_PROJECT_ID: "",
        // Default Postgres project_id used by hooks when runtime=server
        CLAUDE_MEM_SERVER_BETA_URL: `http://127.0.0.1:${process.env.CLAUDE_MEM_SERVER_PORT ?? String(getDefaultServerPort())}`,
        // Legacy server-beta runtime URL — aligned with the per-install port fallback
        CLAUDE_MEM_SERVER_BETA_API_KEY: "",
        // Legacy local hook API key (read as fallback when CLAUDE_MEM_SERVER_API_KEY unset)
        CLAUDE_MEM_SERVER_BETA_PROJECT_ID: "",
        // Legacy Postgres project_id (read as fallback when CLAUDE_MEM_SERVER_PROJECT_ID unset)
        CLAUDE_MEM_DEDUP_ENABLED: "false",
        // #3038 — opt-in; Tier-0 exact auto-merge + Tier-1 review-only candidates
        CLAUDE_MEM_DEDUP_COSINE_THRESHOLD: "0.80",
        // empirical near-dup sweet spot for short titles (F1≈0.95)
        CLAUDE_MEM_DEDUP_IDF_VETO_DF: "10",
        // token in <=10 project records vetoes the merge (Fellegi-Sunter blocking key)
        CLAUDE_MEM_DEDUP_MIN_SHARED_TOKENS: "2",
        // >=2 shared tokens before cosine (kills sparse-vector noise)
        CLAUDE_MEM_DEDUP_MIN_PROJECT_DOCS: "10",
        // cold-start gate: IDF unreliable below ~10 docs/project
        CLAUDE_MEM_DEDUP_MAX_SCAN: "2000",
        // per-insert candidate-scan cap (logged when exceeded)
        CLAUDE_MEM_DEDUP_MAX_BACKFILL_ROWS: "50000",
        // dedup-scan skips a project with more rows than this (memory safety)
        CLAUDE_MEM_TOOL_USES_SEARCH_ENABLED: "false",
        CLAUDE_MEM_TOOL_USES_RETENTION_DAYS: "0",
        // 0 = keep forever (default); N = purge linked tool_uses older than N days at worker start
        CLAUDE_MEM_LOG_RETENTION_DAYS: "30",
        // 30 days of daily logs; 0 = keep forever. Today's and yesterday's files are always kept
        CLAUDE_MEM_WORKER_AUTOSTART: "true",
        // 'false' = the worker is managed externally: hooks, the MCP server and `start` use a running worker but never launch, kill or recycle one.
        // Daily update to the release the owner promotes. On by default; Claude
        // Code's DISABLE_AUTOUPDATER (unless FORCE_AUTOUPDATE_PLUGINS=1),
        // DISABLE_UPDATES and CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC also turn it
        // off, set in the environment or in the env block of Claude Code's user or
        // managed settings.
        CLAUDE_MEM_AUTO_UPDATE: "true",
        // only 'true' (any case) is on; 'false' or any other value = never check for or install an update
        CLAUDE_MEM_AUTO_UPDATE_PROMOTED_RELEASE_URL: "",
        // Empty = the built-in release switch (DEFAULT_PROMOTED_RELEASE_URL in src/services/auto-update/auto-update-check.ts), so a saved settings.json never pins it; tests and the sandbox run point it at a local server or a file:// path in settings.json, since the updater never reads its environment variable
        CLAUDE_MEM_PROJECT_NAME_SOURCE: "path"
        // 'path' (default) = folder/git-root basename; 'git-remote' = stable org/repo slug from the git `origin` URL (survives directory renames). Opt-in; default preserves existing behavior.
      };
      static getAllDefaults() {
        return { ...this.DEFAULTS };
      }
      static defaultsForSettingsPath(settingsPath) {
        const defaults = { ...this.DEFAULTS };
        const dataDir = dirname4(settingsPath);
        const workerPort = String(getDefaultWorkerPort(dataDir));
        const serverPort = process.env.CLAUDE_MEM_SERVER_PORT ?? String(getDefaultServerPort(dataDir));
        defaults.CLAUDE_MEM_WORKER_PORT = workerPort;
        defaults.CLAUDE_MEM_QUEUE_REDIS_PREFIX = `claude_mem_${process.env.CLAUDE_MEM_WORKER_PORT ?? workerPort}`;
        defaults.CLAUDE_MEM_SERVER_URL = `http://127.0.0.1:${serverPort}`;
        defaults.CLAUDE_MEM_SERVER_BETA_URL = `http://127.0.0.1:${serverPort}`;
        return defaults;
      }
      static get(key) {
        const value = process.env[key] ?? this.DEFAULTS[key];
        if (key === "CLAUDE_MEM_WORKER_HOST") {
          return this.normalizeWorkerHost(value);
        }
        if (key === "CLAUDE_MEM_DATA_DIR") {
          return expandHome(value);
        }
        return value;
      }
      // 'localhost' resolves IPv6-first on modern Windows resolvers while
      // server.listen(port, 'localhost') binds ::1 only, so the hook client and
      // the worker can land on different loopback families (#2992). Pin the
      // documented IPv4 loopback so every consumer of the setting agrees.
      static normalizeWorkerHost(host) {
        return host === "localhost" ? "127.0.0.1" : host;
      }
      static finalizeSettings(settings, applyEnvOverrides) {
        const result = applyEnvOverrides ? this.applyEnvOverrides(settings) : settings;
        result.CLAUDE_MEM_WORKER_HOST = this.normalizeWorkerHost(result.CLAUDE_MEM_WORKER_HOST);
        const dataDir = result.CLAUDE_MEM_DATA_DIR?.trim();
        if (dataDir && result.CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH === this.DEFAULTS.CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH) {
          result.CLAUDE_MEM_TRANSCRIPTS_CONFIG_PATH = join7(expandHome(dataDir), "transcript-watch.json");
        }
        return result;
      }
      static getInt(key) {
        const value = this.get(key);
        return parseInt(value, 10);
      }
      static applyEnvOverrides(settings) {
        const result = { ...settings };
        for (const key of Object.keys(this.DEFAULTS)) {
          if (process.env[key] !== void 0) {
            result[key] = process.env[key];
          }
        }
        return result;
      }
      static loadFromFile(settingsPath, applyEnvOverrides = true, options = {}) {
        const warn = options.warn ?? console.warn;
        try {
          const defaults = this.defaultsForSettingsPath(settingsPath);
          if (!existsSync5(settingsPath)) {
            if (!options.readOnly) {
              try {
                writeJsonFileAtomic(settingsPath, defaults, { mode: 384 });
                for (const raised of CHANGED_SHIPPED_DEFAULTS) markRaisedDefaultDone(settingsPath, raised);
                warn("[SETTINGS] Created settings file with defaults:", settingsPath);
              } catch (error) {
                warn("[SETTINGS] Failed to create settings file, using in-memory defaults:", settingsPath, error instanceof Error ? error.message : String(error));
              }
            }
            return this.finalizeSettings(defaults, applyEnvOverrides);
          }
          const settingsData = readFileSync4(settingsPath, "utf-8");
          const settings = parseJsonWithBom(settingsData);
          let flatSettings = settingsTarget(settings);
          const hasNestedEnv = flatSettings !== settings;
          const writableRoot = withoutStaleRootCopies(settings);
          const hasPeerRootKeys = hasNestedEnv && Object.keys(writableRoot).some((key) => key !== "env");
          if (hasNestedEnv) {
            if (!hasPeerRootKeys && !options.readOnly) {
              try {
                writeJsonFileAtomic(settingsPath, flatSettings, { mode: 384 });
                warn("[SETTINGS] Migrated settings file from nested to flat schema:", settingsPath);
              } catch (error) {
                warn("[SETTINGS] Failed to auto-migrate settings file:", settingsPath, error instanceof Error ? error.message : String(error));
              }
            }
          }
          if (flatSettings.CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES === LEGACY_TELEGRAM_TRIGGER_TYPES) {
            flatSettings = {
              ...flatSettings,
              CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES: this.DEFAULTS.CLAUDE_MEM_TELEGRAM_TRIGGER_TYPES
            };
            if (!options.readOnly) {
              try {
                writeJsonFileAtomic(
                  settingsPath,
                  hasPeerRootKeys ? { ...writableRoot, env: flatSettings } : flatSettings,
                  { mode: 384 }
                );
                warn("[SETTINGS] Migrated Telegram trigger types off the legacy default:", settingsPath);
              } catch (error) {
                warn("[SETTINGS] Failed to migrate Telegram trigger types:", settingsPath, error instanceof Error ? error.message : String(error));
              }
            }
          }
          if (hasPinnedShippedHaiku(flatSettings, settingsPath)) {
            const pinnedModel = String(flatSettings.CLAUDE_MEM_MODEL).trim();
            flatSettings = {
              ...flatSettings,
              CLAUDE_MEM_MODEL: this.DEFAULTS.CLAUDE_MEM_MODEL
            };
            if (!options.readOnly) {
              try {
                writeJsonFileAtomic(
                  settingsPath,
                  hasPeerRootKeys ? { ...writableRoot, env: flatSettings } : flatSettings,
                  { mode: 384 }
                );
                warn(
                  `[SETTINGS] Migrated Claude model off the pinned ${pinnedModel} to ${this.DEFAULTS.CLAUDE_MEM_MODEL}:`,
                  settingsPath
                );
              } catch (error) {
                warn("[SETTINGS] Failed to migrate the pinned Claude model:", settingsPath, error instanceof Error ? error.message : String(error));
              }
            }
          }
          if (hasRetiredOpenRouterDefault(flatSettings)) {
            const retiredModel = String(flatSettings.CLAUDE_MEM_OPENROUTER_MODEL).trim();
            flatSettings = {
              ...flatSettings,
              CLAUDE_MEM_OPENROUTER_MODEL: this.DEFAULTS.CLAUDE_MEM_OPENROUTER_MODEL
            };
            if (!options.readOnly) {
              try {
                writeJsonFileAtomic(
                  settingsPath,
                  hasPeerRootKeys ? { ...writableRoot, env: flatSettings } : flatSettings,
                  { mode: 384 }
                );
                warn(
                  `[SETTINGS] Migrated OpenRouter model off the retired default ${retiredModel} to ${this.DEFAULTS.CLAUDE_MEM_OPENROUTER_MODEL}:`,
                  settingsPath
                );
              } catch (error) {
                warn("[SETTINGS] Failed to migrate the retired OpenRouter model:", settingsPath, error instanceof Error ? error.message : String(error));
              }
            }
          }
          const rewrittenHubUrl = migratedCloudSyncHubUrl(flatSettings.CLAUDE_MEM_CLOUD_SYNC_HUB_URL);
          if (rewrittenHubUrl !== null) {
            flatSettings = {
              ...flatSettings,
              CLAUDE_MEM_CLOUD_SYNC_HUB_URL: rewrittenHubUrl
            };
            if (!options.readOnly) {
              try {
                writeJsonFileAtomic(
                  settingsPath,
                  hasPeerRootKeys ? { ...writableRoot, env: flatSettings } : flatSettings,
                  { mode: 384 }
                );
                warn("[SETTINGS] Migrated cloud sync hub URL to", rewrittenHubUrl, "from a retired hub host:", settingsPath);
              } catch (error) {
                warn("[SETTINGS] Failed to migrate cloud sync hub URL:", settingsPath, error instanceof Error ? error.message : String(error));
              }
            }
          }
          for (const raised of CHANGED_SHIPPED_DEFAULTS) {
            if (existsSync5(raisedDefaultMarkerPath(settingsPath, raised))) continue;
            if (flatSettings[raised.key] !== raised.legacy) {
              if (!options.readOnly) markRaisedDefaultDone(settingsPath, raised);
              continue;
            }
            if (options.readOnly && raised.applyOnlyWhenSaved) continue;
            const beforeMove = flatSettings;
            flatSettings = {
              ...flatSettings,
              [raised.key]: this.DEFAULTS[raised.key]
            };
            if (!options.readOnly) {
              try {
                writeJsonFileAtomic(
                  settingsPath,
                  hasPeerRootKeys ? { ...writableRoot, env: flatSettings } : flatSettings,
                  { mode: 384 }
                );
                markRaisedDefaultDone(settingsPath, raised);
                warn(
                  `[SETTINGS] Migrated ${raised.key} off the old ${raised.legacy}${raised.unit} default to ${this.DEFAULTS[raised.key]}${raised.unit}:`,
                  settingsPath
                );
              } catch (error) {
                if (raised.applyOnlyWhenSaved) flatSettings = beforeMove;
                const reported = `${raised.key}\0${settingsPath}`;
                if (!raisedDefaultFailuresReported.has(reported)) {
                  raisedDefaultFailuresReported.add(reported);
                  warn(
                    raised.applyOnlyWhenSaved ? `[SETTINGS] Failed to migrate ${raised.key}; keeping the saved ${raised.legacy} (reported once per process):` : `[SETTINGS] Failed to migrate ${raised.key}; using the new default in memory (reported once per process):`,
                    settingsPath,
                    error instanceof Error ? error.message : String(error)
                  );
                }
              }
            }
          }
          const result = { ...defaults };
          for (const key of Object.keys(defaults)) {
            if (flatSettings[key] !== void 0) {
              result[key] = coercePersistedSettingValue(flatSettings[key]);
            }
          }
          return this.finalizeSettings(result, applyEnvOverrides);
        } catch (error) {
          warn("[SETTINGS] Failed to load settings, using defaults:", settingsPath, error instanceof Error ? error.message : String(error));
          const defaults = this.defaultsForSettingsPath(settingsPath);
          return this.finalizeSettings(defaults, applyEnvOverrides);
        }
      }
    };
  }
});

// src/utils/redaction.ts
import { existsSync as existsSync6, readFileSync as readFileSync5 } from "fs";
function genericBuiltinRegex(lookbehind) {
  return new RegExp(`${lookbehind}${GENERIC_VALUE}`, "gi");
}
function webhookHost(host) {
  const ci = host.replace(/\\.|[a-z]/g, (c) => c.length === 1 ? `[${c}${c.toUpperCase()}]` : c);
  return String.raw`(?:^|\/\/|@|[^\w.\/@%-])${ci}`;
}
function keyedLookbehind(key) {
  return `(?<=${key}${OPTIONAL_QUOTE}${BOUNDED_SPACE}[=:]${BOUNDED_SPACE}${OPTIONAL_QUOTE})`;
}
function matchAfterEscapedWhitespace(pattern) {
  const source = pattern.regex.source.replace(/(^|\||\(\?:)\\b/g, `$1${ESCAPED_WHITESPACE_OR_WORD_BOUNDARY}`);
  return { ...pattern, regex: new RegExp(source, pattern.regex.flags) };
}
function redactSensitive(input, config) {
  if (!config.enabled || input.length === 0) {
    return { redacted: input, counts: {}, oversize: false };
  }
  if (input.length > MAX_INPUT_CHARS) {
    logger.warn("REDACT", "field exceeds the 1M-char redaction cap; replaced by an oversize marker", void 0, {
      inputLength: input.length
    });
    return { redacted: OVERSIZE_MARKER, counts: { oversize: 1 }, oversize: true };
  }
  const disabled = new Set(config.disabledBuiltinPatterns ?? []);
  const counts = {};
  let working = input;
  const compiledCustom = [];
  for (const cp of config.customPatterns ?? []) {
    if (!cp.name || cp.name.length === 0) {
      logger.warn("REDACT", "custom pattern skipped: missing name", void 0, { pattern: cp });
      continue;
    }
    try {
      compiledCustom.push({ name: cp.name, regex: new RegExp(cp.regex, "g") });
    } catch (error) {
      logger.warn("REDACT", "custom pattern skipped: invalid regex", { name: cp.name }, error instanceof Error ? error : new Error(String(error)));
    }
  }
  const allPatterns = [
    ...compiledCustom,
    ...BUILTIN_REDACTION_PATTERNS,
    ...config.genericEnabled ? GENERIC_REDACTION_PATTERNS : []
  ];
  for (const pattern of allPatterns) {
    if (disabled.has(pattern.name)) continue;
    pattern.regex.lastIndex = 0;
    working = working.replace(pattern.regex, () => {
      counts[pattern.name] = (counts[pattern.name] ?? 0) + 1;
      return `<redacted type='${pattern.name}'/>`;
    });
  }
  if (config.logMatches && Object.keys(counts).length > 0) {
    logger.debug("REDACT", "patterns matched", void 0, { counts });
  }
  return { redacted: working, counts, oversize: false };
}
function safeParseCustomPatterns(raw) {
  if (!raw || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      logger.warn("REDACT", "CLAUDE_MEM_REDACT_CUSTOM_PATTERNS is not a JSON array, ignoring");
      return [];
    }
    return parsed.filter((p) => p && typeof p.name === "string" && typeof p.regex === "string");
  } catch (error) {
    logger.warn(
      "REDACT",
      "failed to parse CLAUDE_MEM_REDACT_CUSTOM_PATTERNS as JSON",
      void 0,
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}
function loadRedactionConfig(settings) {
  return {
    enabled: settings.CLAUDE_MEM_REDACT_ENABLED === "true",
    disabledBuiltinPatterns: (settings.CLAUDE_MEM_REDACT_DISABLED_BUILTINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    customPatterns: safeParseCustomPatterns(settings.CLAUDE_MEM_REDACT_CUSTOM_PATTERNS ?? "[]"),
    logMatches: settings.CLAUDE_MEM_REDACT_LOG_MATCHES === "true",
    genericEnabled: settings.CLAUDE_MEM_REDACT_GENERIC_ENABLED === "true"
  };
}
function readSettingsText(settingsPath) {
  if (!existsSync6(settingsPath)) return null;
  try {
    return readFileSync5(settingsPath, "utf-8");
  } catch {
    return "";
  }
}
function isUnreadableSettings(text5) {
  if (text5 === null) return false;
  try {
    const parsed = JSON.parse(stripUtf8Bom(text5));
    return parsed === null || typeof parsed !== "object" || Array.isArray(parsed);
  } catch {
    return true;
  }
}
function configForUnreadableSettings(settingsPath, text5, loaded) {
  if (process.env.CLAUDE_MEM_REDACT_ENABLED === "false") return loaded;
  const requested = lastLoadedConfig?.enabled === true || REDACTION_REQUESTED_IN_RAW.test(text5);
  if (!requested) return loaded;
  if (!warnedUnreadableSettings) {
    warnedUnreadableSettings = true;
    logger.warn("REDACT", "settings.json could not be read; secret redaction stays on until it is repaired", {
      settingsPath,
      using: lastLoadedConfig?.enabled ? "the last configuration that loaded" : "the built-in patterns"
    });
  }
  return lastLoadedConfig?.enabled ? lastLoadedConfig : BUILTINS_ONLY;
}
function getRedactionConfig(settingsPath = USER_SETTINGS_PATH) {
  const now = Date.now();
  if (cachedConfig && now - cacheStamp < CACHE_TTL_MS) {
    return cachedConfig;
  }
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
  const loaded = loadRedactionConfig(settings);
  const text5 = loaded.enabled ? null : readSettingsText(settingsPath);
  if (isUnreadableSettings(text5)) {
    cachedConfig = configForUnreadableSettings(settingsPath, text5, loaded);
  } else {
    cachedConfig = loaded;
    lastLoadedConfig = loaded;
  }
  cacheStamp = now;
  return cachedConfig;
}
function genericMarkerForKeyedValue(key, value, config) {
  if (!config.genericEnabled) return null;
  const name = GENERIC_PASSWORD_KEY.test(key) ? "generic_password" : GENERIC_TOKEN_KEY.test(key) ? "generic_token" : null;
  if (!name) return null;
  if (config.disabledBuiltinPatterns?.includes(name)) return null;
  if (!WHOLE_GENERIC_VALUE.test(value) || !/[A-Za-z]/.test(value)) return null;
  return `<redacted type='${name}'/>`;
}
function bearerMarkerForKeyedValue(key, value, config) {
  if (!config.genericEnabled || config.disabledBuiltinPatterns?.includes("bearer_token")) return null;
  if (!AUTHORIZATION_KEY.test(key)) return null;
  const match = KEYED_BEARER_VALUE.exec(value);
  return match ? `${match[1]}<redacted type='bearer_token'/>${value.slice(match[0].length)}` : null;
}
function basicMarkerForKeyedValue(key, value, config) {
  if (!config.genericEnabled || config.disabledBuiltinPatterns?.includes("basic_auth")) return null;
  if (!AUTHORIZATION_KEY.test(key)) return null;
  const match = KEYED_BASIC_VALUE.exec(value);
  return match ? `${match[1]}<redacted type='basic_auth'/>${value.slice(match[0].length)}` : null;
}
function awsSessionTokenMarkerForKeyedValue(key, value, config) {
  if (config.disabledBuiltinPatterns?.includes("aws_session_token")) return null;
  if (!AWS_SESSION_TOKEN_KEY.test(key) || !WHOLE_AWS_SESSION_TOKEN_VALUE.test(value)) return null;
  return "<redacted type='aws_session_token'/>";
}
function awsSecretKeyMarkerForKeyedValue(key, value, config) {
  if (config.disabledBuiltinPatterns?.includes("aws_secret_key")) return null;
  if (!AWS_SECRET_KEY_KEY.test(key) || !WHOLE_AWS_SECRET_KEY_VALUE.test(value)) return null;
  return "<redacted type='aws_secret_key'/>";
}
function cookieMarkerForKeyedValue(key, value, config) {
  if (config.disabledBuiltinPatterns?.includes("cookie_header")) return null;
  if (!COOKIE_KEY.test(key) || value.trim().length < 4) return null;
  return "<redacted type='cookie_header'/>";
}
function redactJsonStrings(value, config = getRedactionConfig()) {
  if (!config.enabled) return value;
  const walk = (node, key) => {
    if (typeof node === "string") {
      const cookieMarker = key === void 0 ? null : cookieMarkerForKeyedValue(key, node, config);
      if (cookieMarker) return cookieMarker;
      const result = redactSensitive(node, config);
      if (key === void 0 || Object.keys(result.counts).length > 0) return result.redacted;
      return awsSessionTokenMarkerForKeyedValue(key, node, config) ?? awsSecretKeyMarkerForKeyedValue(key, node, config) ?? bearerMarkerForKeyedValue(key, node, config) ?? basicMarkerForKeyedValue(key, node, config) ?? genericMarkerForKeyedValue(key, node, config) ?? result.redacted;
    }
    if (Array.isArray(node)) return node.map((child) => walk(child, key !== void 0 && COOKIE_KEY.test(key) ? key : void 0));
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([childKey, child]) => [childKey, walk(child, childKey)]));
    }
    return node;
  };
  return walk(value);
}
var GENERIC_VALUE_CLASS, GENERIC_VALUE, OPTIONAL_QUOTE, BOUNDED_SPACE, BARE_TOKEN_KEY, ESCAPED_QUOTE, STRING_EDGE, ASSIGNMENT_START, LINE_START, LINE_END, GENERIC_TOKEN_REGEX, ESCAPED_WHITESPACE_OR_WORD_BOUNDARY, COOKIE_VALUE_CHAR, BUILTIN_REDACTION_PATTERNS, GENERIC_REDACTION_PATTERNS, MAX_INPUT_CHARS, OVERSIZE_MARKER, cachedConfig, cacheStamp, CACHE_TTL_MS, lastLoadedConfig, warnedUnreadableSettings, BUILTINS_ONLY, REDACTION_REQUESTED_IN_RAW, GENERIC_PASSWORD_KEY, GENERIC_TOKEN_KEY, WHOLE_GENERIC_VALUE, AUTHORIZATION_KEY, KEYED_BEARER_VALUE, KEYED_BASIC_VALUE, AWS_SESSION_TOKEN_KEY, WHOLE_AWS_SESSION_TOKEN_VALUE, AWS_SECRET_KEY_KEY, WHOLE_AWS_SECRET_KEY_VALUE, COOKIE_KEY;
var init_redaction = __esm({
  "src/utils/redaction.ts"() {
    "use strict";
    init_logger();
    init_SettingsDefaultsManager();
    init_paths();
    init_atomic_json();
    GENERIC_VALUE_CLASS = String.raw`[A-Za-z0-9_.\-+/=~@#$%^*!?]`;
    GENERIC_VALUE = `(?=${GENERIC_VALUE_CLASS}{8})${GENERIC_VALUE_CLASS}*[A-Za-z]${GENERIC_VALUE_CLASS}*`;
    OPTIONAL_QUOTE = String.raw`(?:\\{0,3}["'])?`;
    BOUNDED_SPACE = String.raw`\s{0,8}`;
    BARE_TOKEN_KEY = String.raw`(?:token|secret|api_key)`;
    ESCAPED_QUOTE = String.raw`\\{0,3}["']`;
    STRING_EDGE = String.raw`(?<!\\)"`;
    ASSIGNMENT_START = String.raw`(?:^|[\s?&]|\\[nrt]|${STRING_EDGE})`;
    LINE_START = String.raw`(?:^|\n|\\n|${STRING_EDGE})[ \t]{0,8}(?:-[ \t]{1,8})?`;
    LINE_END = String.raw`(?:${ESCAPED_QUOTE})?[ \t]{0,8}(?:$|\r?\n|\\{1,3}[rn]|#|${STRING_EDGE})`;
    GENERIC_TOKEN_REGEX = new RegExp([
      `${keyedLookbehind(String.raw`\b\w*_${BARE_TOKEN_KEY}`)}${GENERIC_VALUE}`,
      `(?<=${ESCAPED_QUOTE}${BARE_TOKEN_KEY}${ESCAPED_QUOTE}${BOUNDED_SPACE}:${BOUNDED_SPACE}${ESCAPED_QUOTE})${GENERIC_VALUE}`,
      `(?<=${ASSIGNMENT_START}${BARE_TOKEN_KEY}=${OPTIONAL_QUOTE})${GENERIC_VALUE}(?!\\(|${GENERIC_VALUE_CLASS})`,
      String.raw`(?<=--(?:[a-z0-9]+[-_])*(?:token|secret|api[-_]key)(?:=|[ \t]{1,8})${OPTIONAL_QUOTE})${GENERIC_VALUE}`,
      `(?<=${LINE_START}${BARE_TOKEN_KEY}:[ \\t]{1,8}${OPTIONAL_QUOTE})${GENERIC_VALUE}(?=${LINE_END})`
    ].join("|"), "gi");
    ESCAPED_WHITESPACE_OR_WORD_BOUNDARY = String.raw`(?:(?<=\\[nrt])|\b)`;
    COOKIE_VALUE_CHAR = String.raw`[^\\\n\r"'\`<]`;
    BUILTIN_REDACTION_PATTERNS = [
      // A `Cookie`/`Set-Cookie` header value is a session credential whatever the
      // cookie is named (`Cookie: sessionid=...`, `set-cookie: sid=...`), as printed
      // by `curl -v`, a proxy log or a captured response dump. Only the value is
      // replaced, so the key stays readable. The Cowork shim has redacted these
      // since the plugin landed (its COOKIE_RE, #3733), so the same session text
      // was redacted on the way to cmem.ai and stored verbatim by the local worker.
      // keyedLookbehind takes JSON-escaped keys (`\"Cookie\":\"…\"`); an optional
      // `[` takes the first entry of Node's `"set-cookie": ["…"]` array. The value
      // stops at a line end, a quote or a backslash, so in `JSON.stringify` text it
      // ends before an escaped `\n` or `\"` and leaves the rest of the payload and
      // its JSON intact, and at `<`, so it never re-redacts its own marker. The
      // 4-char floor keeps a bare `Cookie: x` placeholder out. First in the list:
      // the whole header value goes before a vendor pattern can split it with its
      // marker and leave a later cookie in the same header readable.
      { name: "cookie_header", regex: new RegExp(`(?<=(?:\\b(?:set-)?cookie)${OPTIONAL_QUOTE}${BOUNDED_SPACE}[=:]${BOUNDED_SPACE}(?:\\[${BOUNDED_SPACE})?${OPTIONAL_QUOTE})(?![ \\t])${COOKIE_VALUE_CHAR}{4,}`, "gi") },
      // The password in a URL's userinfo: `postgres://app:hunter2@db/prod`,
      // `redis://:hunter2@cache:6379/0`, `https://user:pass@host/repo.git` (what
      // `git remote -v` and a DATABASE_URL print). Only the password is replaced,
      // so the scheme, user and host stay readable. The value stops at `/`, `@`,
      // whitespace and quotes; a `<` start keeps an earlier marker and a `$`/`{`
      // start keeps a `${DB_PASS}` placeholder from being taken for a secret.
      // First in the list, so the whole password goes before a vendor pattern can
      // split it with its marker and leave the rest of it behind.
      { name: "url_credentials", regex: /(?<=\b[a-z][a-z0-9+.-]*:\/\/[^\s:\/@'"<>]*:)(?![${<])[^\s\/@'"<>]+(?=@)/gi },
      // `AKIA` is a long-term access key ID; `ASIA` is the temporary one that STS,
      // SSO and instance roles hand out (`aws sts assume-role`, `aws configure
      // export-credentials`), printed next to its secret and session token.
      { name: "aws_access_key", regex: /(?:AKIA|ASIA)[0-9A-Z]{16}/g },
      // Anchored to its key names: `AWS_SECRET_ACCESS_KEY=…` in env output,
      // `aws_secret_access_key = …` in ~/.aws/credentials and SDK arguments (any
      // letter case), and `"SecretAccessKey": "…"` in `aws sts` / `aws configure
      // export-credentials` JSON, which prints it beside the ASIA key ID and the
      // session token. keyedLookbehind also takes JSON-style `"KEY": "val"`.
      { name: "aws_secret_key", regex: new RegExp(`${keyedLookbehind(String.raw`(?:aws_secret_access_key|\bSecretAccessKey)`)}[A-Za-z0-9/+=]{40}`, "gi") },
      // The session token of temporary credentials (STS, SSO, `aws configure
      // export-credentials`) grants access together with the key pair, so it is
      // anchored to its key names the same way: `AWS_SESSION_TOKEN=…` in env
      // output, `aws_session_token = …` in ~/.aws/credentials and
      // `"SessionToken": "…"` in `aws sts` JSON. Real tokens run to hundreds of
      // base64 characters; the 100-char floor keeps short placeholders out.
      { name: "aws_session_token", regex: new RegExp(`${keyedLookbehind(String.raw`\b(?:aws_session_token|SessionToken)`)}[A-Za-z0-9/+=]{100,}`, "gi") },
      { name: "github_pat", regex: /\bgh[oprsu]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{82}\b/g },
      // openai_key, anthropic_key, slack_token, jwt and google_api_key end in a
      // class that includes `-`. A closing `\b` after a `-` needs a word character
      // to follow, so a Google key ending in `-` was not redacted at all and the
      // others left their final `-` in the stored text. `(?!\w)` is the same
      // "the token ends here" check without that gap.
      { name: "openai_key", regex: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,}(?!\w)/g },
      { name: "anthropic_key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}(?!\w)/g },
      // Slack bot/user/legacy tokens (`xoxb-`, `xoxp-`, …), refresh tokens from
      // token rotation (`xoxe-`) and app-level Socket Mode tokens (`xapp-`).
      { name: "slack_token", regex: /\b(?:xox[abeprs]|xapp)-[A-Za-z0-9-]{10,}(?!\w)/g },
      { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?!\w)/g },
      // A PGP secret key is armored as `PRIVATE KEY BLOCK`, and an encrypted
      // PKCS#8 key as `ENCRYPTED PRIVATE KEY`.
      { name: "private_key_pem", regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
      // API keys (`sk_`/`pk_`/`rk_`) and webhook signing secrets (`whsec_`, what
      // `stripe listen` prints and STRIPE_WEBHOOK_SECRET holds), which forge events.
      { name: "stripe_key", regex: /\b(?:(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}|whsec_[A-Za-z0-9]{32,})\b/g },
      { name: "google_api_key", regex: /\bAIza[0-9A-Za-z_-]{35}(?!\w)/g },
      // Google OAuth 2.0 access tokens: `ya29.` + a base64url body, plus the
      // `ya29.c.` form the GCE metadata server hands out. `gcloud auth
      // print-access-token`, `curl -H "Authorization: Bearer …"` lines and token
      // JSON print them; each grants an hour of the account's API access.
      { name: "google_oauth_token", regex: /\bya29\.(?:c\.)?[0-9A-Za-z_-]{20,}(?!\w)/g },
      // GitLab personal/project/group access tokens (`glpat-`), deploy tokens (`gldt-`),
      // and runner authentication tokens (`glrt-` + 20 chars; newer routable tokens
      // add dot-separated segments), Hugging Face user access tokens (`hf_` + 34 chars),
      // npm access tokens (`npm_` + 36 chars) and Docker Hub personal access tokens
      // (`dckr_pat_` + 27 chars): credentials printed in config files, CLI commands
      // (`glab`, `huggingface-cli`, `npm`, `docker login`), and env dumps.
      { name: "gitlab_token", regex: /\bgl(?:pat|dt|rt)-[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+)*(?!\w)/g },
      { name: "huggingface_token", regex: /\bhf_[A-Za-z0-9]{30,}\b/g },
      { name: "npm_token", regex: /\bnpm_[A-Za-z0-9]{36}\b/g },
      { name: "docker_pat", regex: /\bdckr_pat_[A-Za-z0-9_-]{27,}(?!\w)/g },
      // Linear personal API keys (`lin_api_` + 40 alphanumerics) and Notion
      // integration tokens (`ntn_` + 46 alphanumerics, and the older `secret_` +
      // 43): what `LINEAR_API_KEY=…` / `NOTION_TOKEN=…` lines, MCP server configs
      // and `curl -H "Authorization: …"` commands print. Fixed lengths keep
      // `secret_` words and short look-alikes out.
      { name: "linear_key", regex: /\blin_api_[A-Za-z0-9]{40}(?!\w)/g },
      { name: "notion_token", regex: /\b(?:ntn_[A-Za-z0-9]{46}|secret_[A-Za-z0-9]{43})(?!\w)/g },
      // SendGrid API keys (`SG.` + 22 + `.` + 43 base64url chars), DigitalOcean
      // personal access, OAuth and refresh tokens (`dop_v1_`/`doo_v1_`/`dor_v1_` +
      // 64 hex) and Shopify Admin API, app and shared-secret tokens (`shpat_`,
      // `shpca_`, `shppa_`, `shpss_` + 32 hex): what `doctl`, the Shopify CLI and
      // `.env` dumps print.
      { name: "sendgrid_key", regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![\w-])/g },
      { name: "digitalocean_token", regex: /\bdo[opr]_v1_[a-f0-9]{64}\b/g },
      { name: "shopify_token", regex: /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g },
      // PyPI API tokens: `pypi-` + a base64url macaroon whose header always
      // starts `AgE` (pypi.org and test.pypi.org alike), printed by `twine`,
      // `uv publish` and `~/.pypirc` dumps. Real tokens run past 150 characters.
      { name: "pypi_token", regex: /\bpypi-AgE[A-Za-z0-9_-]{50,}(?!\w)/g },
      // Databricks personal access tokens (`dapi` + 32 hex, sometimes with a
      // `-<digit>` suffix) that DATABRICKS_TOKEN, `~/.databrickscfg` and
      // `databricks tokens create` print, and HashiCorp Vault service and batch
      // tokens (`hvs.` + 90-120 and `hvb.` + 138-300 base64url chars) that
      // VAULT_TOKEN, `~/.vault-token` and `vault login` / `vault token create`
      // print.
      { name: "databricks_token", regex: /\bdapi[a-f0-9]{32}(?:-\d)?(?!\w)/g },
      { name: "vault_token", regex: /\b(?:hvs\.[\w-]{90,120}|hvb\.[\w-]{138,300})(?![\w-])/g },
      // Two OpenAI-compatible providers this project onboards users for
      // (src/shared/openai-compat-presets.ts): NVIDIA NIM issues `nvapi-` keys and
      // Runcrate issues `rc_live_` keys. Both presets tell the user the prefix in
      // their installer hint, and neither was claimed by openai_key (`sk-`), so a
      // key pasted into a session (or printed by a `curl`/`.env` dump) was stored
      // verbatim. 32+ trailing chars keeps short placeholders out.
      { name: "nvidia_nim_key", regex: /\bnvapi-[A-Za-z0-9_-]{32,}(?!\w)/g },
      { name: "runcrate_key", regex: /\brc_live_[A-Za-z0-9_-]{24,}(?!\w)/g },
      // Groq API keys (`gsk_` + 52 alphanumerics) and xAI API keys (`xai-` + 80
      // chars): LLM provider keys that `.env` files, `export GROQ_API_KEY=…` /
      // `XAI_API_KEY=…` lines and `curl -H "Authorization: Bearer …"` commands
      // print. Neither prefix is claimed by openai_key, so they stayed in the text.
      { name: "groq_key", regex: /\bgsk_[A-Za-z0-9]{52}(?!\w)/g },
      { name: "xai_key", regex: /\bxai-[A-Za-z0-9_]{80}(?!\w)/g },
      // Perplexity API keys (`pplx-` + 48 alphanumerics): an LLM provider key
      // that `.env` files, `export PERPLEXITY_API_KEY=…` lines and `curl -H
      // "Authorization: Bearer …"` commands print. The prefix is not claimed by
      // openai_key, and Perplexity model ids share it (`pplx-embed-v1-4b`), so
      // the fixed 48-char alphanumeric body keeps the model ids out.
      { name: "perplexity_key", regex: /\bpplx-[A-Za-z0-9]{48}(?!\w)/g },
      // Supabase personal access tokens (`sbp_` + 40 hex, what `supabase login`
      // stores and SUPABASE_ACCESS_TOKEN holds) and Sentry auth tokens: personal
      // ones (`sntryu_` + 64 hex) and organization ones (`sntrys_` + a base64
      // payload + `_` + a 43-char base64 secret), which SENTRY_AUTH_TOKEN lines,
      // `.sentryclirc` dumps and source-map upload commands print.
      { name: "supabase_token", regex: /\bsbp_[a-f0-9]{40}(?!\w)/g },
      { name: "sentry_token", regex: /\b(?:sntryu_[a-f0-9]{64}(?!\w)|sntrys_[A-Za-z0-9+\/]{20,}={0,2}_[A-Za-z0-9+\/]{43}(?![\w+\/]))/g },
      // Grafana tokens: service account tokens (`glsa_` + 32 alphanumerics + `_`
      // + an 8-hex checksum) and Grafana Cloud access policy / API tokens (`glc_`
      // + a base64 payload), which GRAFANA_TOKEN / GRAFANA_SERVICE_ACCOUNT_TOKEN
      // lines, Terraform provider configs and `curl -H "Authorization: Bearer …"`
      // commands print. Postman API keys (`PMAK-` + 24 hex + `-` + 34 hex), which
      // POSTMAN_API_KEY lines and `newman` / `postman` CLI commands print.
      { name: "grafana_token", regex: /\b(?:glsa_[A-Za-z0-9]{32}_[A-Fa-f0-9]{8}(?!\w)|glc_[A-Za-z0-9+\/]{32,400}={0,2}(?![\w+\/=]))/g },
      { name: "postman_key", regex: /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}(?!\w)/g },
      // Pulumi access tokens (`pul-` + 40 hex), which PULUMI_ACCESS_TOKEN lines,
      // `pulumi login` output and CI configs print. Doppler personal tokens
      // (`dp.pt.` + 43 alphanumerics), which DOPPLER_TOKEN lines and
      // `doppler configure` dumps print.
      { name: "pulumi_token", regex: /\bpul-[a-f0-9]{40}(?!\w)/g },
      { name: "doppler_token", regex: /\bdp\.pt\.[A-Za-z0-9]{43}(?!\w)/g },
      // Heroku API keys in the current format (`HRKU-AA` + 58 characters), which
      // HEROKU_API_KEY lines, `heroku auth:token` output and ~/.netrc dumps print.
      // Atlassian API tokens (`ATATT3` + 186 characters), which JIRA_API_TOKEN /
      // CONFLUENCE_API_TOKEN lines and `acli` / `curl -u user:token` commands print.
      { name: "heroku_key", regex: /\bHRKU-AA[0-9A-Za-z_-]{58}(?![\w-])/g },
      { name: "atlassian_token", regex: /\bATATT3[A-Za-z0-9_=-]{186}(?![\w=-])/g },
      // Incoming webhook URLs carry their secret in the path, so anyone holding
      // one can post to the channel: Slack (`hooks.slack.com/services/T…/B…/…`,
      // plus workflow and trigger URLs) and Discord (`discord.com/api/webhooks/
      // <id>/<token>`, discordapp.com and the ptb/canary hosts too), as printed by
      // `.env` dumps, CI configs and `curl -X POST` commands. Only the last path
      // segment is replaced, so the host and the workspace/channel ids stay
      // readable. The host must start the URL's host part (after `//`, `@`, or a
      // non-URL character), so `example.com/hooks.slack.com/…` keeps its path, and
      // it matches in any letter case, as DNS does; the path stays case-sensitive.
      { name: "slack_webhook", regex: new RegExp(String.raw`(?<=${webhookHost(String.raw`hooks\.slack\.com`)}\/(?:services|workflows|triggers)\/T[A-Z0-9]+\/[A-Z0-9]+\/(?:[0-9]+\/)?)[A-Za-z0-9]{20,}(?!\w)`, "g") },
      { name: "discord_webhook", regex: new RegExp(String.raw`(?<=${webhookHost(String.raw`(?:(?:ptb|canary)\.)?discord(?:app)?\.com`)}\/api\/(?:v\d+\/)?webhooks\/[0-9]{17,20}\/)[A-Za-z0-9_-]{60,}(?![\w-])`, "g") },
      // claude-mem's own credentials: server API keys (`cmem_` + 43 base64url
      // chars, server-bootstrap.ts createRawApiKey) and cmem.ai Pro memory keys.
      { name: "claude_mem_key", regex: /\bcmem_[A-Za-z0-9_-]{32,}|\bcm_pro_[A-Za-z0-9_-]{8,}/g }
    ].map(matchAfterEscapedWhitespace);
    GENERIC_REDACTION_PATTERNS = [
      // `pwd` only as a suffix (`DB_PWD`, `MYSQL_PWD`): the bare `PWD` and
      // `OLDPWD` environment variables hold a working directory, not a secret.
      { name: "generic_password", regex: genericBuiltinRegex(keyedLookbehind(String.raw`\b(?:\w*_?(?:password|passwd)|\w+_pwd)`)) },
      { name: "generic_token", regex: GENERIC_TOKEN_REGEX },
      { name: "bearer_token", regex: genericBuiltinRegex(`(?<=\\bAuthorization${OPTIONAL_QUOTE}${BOUNDED_SPACE}:${BOUNDED_SPACE}${OPTIONAL_QUOTE}Bearer${BOUNDED_SPACE})`) },
      // `Authorization: Basic …` carries base64(user:password), a password anyone
      // can decode, as in `curl -H "Authorization: Basic dXNlcjpodW50ZXIy"`.
      { name: "basic_auth", regex: genericBuiltinRegex(`(?<=\\bAuthorization${OPTIONAL_QUOTE}${BOUNDED_SPACE}:${BOUNDED_SPACE}${OPTIONAL_QUOTE}Basic${BOUNDED_SPACE})`) }
    ];
    MAX_INPUT_CHARS = 1024 * 1024;
    OVERSIZE_MARKER = "<redacted type='oversize'/>";
    cachedConfig = null;
    cacheStamp = 0;
    CACHE_TTL_MS = 5e3;
    lastLoadedConfig = null;
    warnedUnreadableSettings = false;
    BUILTINS_ONLY = { enabled: true, disabledBuiltinPatterns: [], customPatterns: [], logMatches: false };
    REDACTION_REQUESTED_IN_RAW = /"CLAUDE_MEM_REDACT_ENABLED"\s*:\s*"true"/;
    GENERIC_PASSWORD_KEY = /(?:password|passwd)$|\w_pwd$/i;
    GENERIC_TOKEN_KEY = /(?:^|_)(?:secret|token|api_key)$/i;
    WHOLE_GENERIC_VALUE = new RegExp(`^${GENERIC_VALUE_CLASS}{8,}$`);
    AUTHORIZATION_KEY = /^(?:proxy-)?authorization$/i;
    KEYED_BEARER_VALUE = new RegExp(`^(${BOUNDED_SPACE}Bearer${BOUNDED_SPACE})${GENERIC_VALUE}`, "i");
    KEYED_BASIC_VALUE = new RegExp(`^(${BOUNDED_SPACE}Basic${BOUNDED_SPACE})${GENERIC_VALUE}`, "i");
    AWS_SESSION_TOKEN_KEY = /^(?:aws_session_token|SessionToken)$/i;
    WHOLE_AWS_SESSION_TOKEN_VALUE = /^[A-Za-z0-9/+=]{100,}$/;
    AWS_SECRET_KEY_KEY = /^(?:aws_secret_access_key|SecretAccessKey)$/i;
    WHOLE_AWS_SECRET_KEY_VALUE = /^[A-Za-z0-9/+=]{40}$/;
    COOKIE_KEY = /^(?:set-)?cookie$/i;
  }
});

// src/services/sync/diagnostic-redaction.ts
function redactSyncDiagnostic(value, config = getRedactionConfig()) {
  if (!config.enabled) return value;
  let remainingNodes = 5e4;
  const text5 = (input, keys = []) => {
    if (!keys.length) return redactSensitive(input, config).redacted;
    for (const key of keys) {
      const redacted = redactJsonStrings({ [key]: input }, config)[key];
      if (redacted !== input) return redacted;
    }
    return input;
  };
  const walk = (input, depth, keys = []) => {
    if (depth > 32 || --remainingNodes < 0) return BUDGET_MARKER;
    if (typeof input === "string") {
      if (input.length > MAX_DIAGNOSTIC_CHARS) return redactSensitive(input, config).redacted;
      try {
        const parsed = JSON.parse(input);
        if (parsed !== null && (typeof parsed === "object" || typeof parsed === "string")) {
          const sanitized = walk(parsed, depth + 1, keys);
          const serialized = JSON.stringify(sanitized);
          if (serialized !== JSON.stringify(parsed)) return serialized;
        }
      } catch {
      }
      return text5(input, keys);
    }
    if (Array.isArray(input)) return input.length > remainingNodes ? BUDGET_MARKER : input.map((item) => walk(item, depth + 1, keys));
    if (input && typeof input === "object") {
      const entries = Object.entries(input);
      if (entries.length > remainingNodes) return BUDGET_MARKER;
      return Object.fromEntries(entries.map(([name, item]) => [text5(name, keys), walk(item, depth + 1, [name, ...keys])]));
    }
    return input;
  };
  return walk(value, 0);
}
var MAX_DIAGNOSTIC_CHARS, BUDGET_MARKER;
var init_diagnostic_redaction = __esm({
  "src/services/sync/diagnostic-redaction.ts"() {
    "use strict";
    init_redaction();
    MAX_DIAGNOSTIC_CHARS = 1024 * 1024;
    BUDGET_MARKER = "<redacted type='diagnostic_budget'/>";
  }
});

// src/shared/media-contract.ts
function object(value, keys, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new MediaError(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new MediaError(code);
  const record = value;
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new MediaError(code);
  return record;
}
function boundedString(value, pattern, max, code) {
  if (typeof value !== "string" || value.length > max || !pattern.test(value)) throw new MediaError(code);
  return value;
}
function validateMediaManifest(value) {
  const record = object(value, ["version", "attachments", "overflow"], "invalid_manifest");
  if (record.version !== MEDIA_MANIFEST_VERSION || !Array.isArray(record.attachments)) throw new MediaError("invalid_manifest");
  if (record.attachments.length > MEDIA_LIMITS.maxObservationRefs) throw new MediaError("manifest_too_large");
  if (record.overflow !== void 0 && typeof record.overflow !== "boolean") throw new MediaError("invalid_manifest");
  const ids = /* @__PURE__ */ new Set();
  const attachments = Array.from(record.attachments, (value2) => {
    const ref = object(value2, ["id", "label", "inspection"], "invalid_manifest");
    const id = boundedString(ref.id, UUID_V4, 36, "invalid_manifest");
    const label = boundedString(ref.label, LABEL, MEDIA_LIMITS.maxLabelChars, "invalid_manifest");
    if (ids.has(id) || ref.inspection !== "inspected" && ref.inspection !== "uninspected") throw new MediaError("invalid_manifest");
    ids.add(id);
    return { id, label, inspection: ref.inspection };
  });
  const result = { version: MEDIA_MANIFEST_VERSION, attachments };
  if (record.overflow !== void 0) result.overflow = record.overflow;
  if (new TextEncoder().encode(JSON.stringify(result)).length > MEDIA_LIMITS.maxManifestBytes) throw new MediaError("manifest_too_large");
  return result;
}
var MEDIA_MANIFEST_VERSION, MEDIA_METADATA_NAMESPACE, MEDIA_LIMITS, MediaError, UUID_V4, LABEL;
var init_media_contract = __esm({
  "src/shared/media-contract.ts"() {
    "use strict";
    MEDIA_MANIFEST_VERSION = 1;
    MEDIA_METADATA_NAMESPACE = "cmem_media_v1";
    MEDIA_LIMITS = Object.freeze({
      // Abuse protection: caps one event at 4 stored images (about 13 MiB) and one
      // observer turn at 4 derivatives (maxGatewayImageBytes).
      maxImagesPerEvent: 4,
      // Provider maximum: Vercel Functions take request bodies up to 4.5 MB; this
      // plus maxUploadBodyBytes' multipart overhead (3.06 MiB, 3.2 MB) fits.
      maxSourceBytes: 3 * 1024 * 1024,
      // Same bound for the stored full-size copy: a lossless re-encode of an accepted
      // source must still fit, and a stored copy is served back in one Vercel
      // response, also limited to 4.5 MB.
      maxCanonicalBytes: 3 * 1024 * 1024,
      // Owner's rule, 2026-11-05/06: no stored copy is multiple megabytes, and every
      // copy is lossy WebP. Both converters fit each canonical they encode into this.
      // maxCanonicalBytes stays the bound for an accepted upload and for reading a
      // copy stored before this rule (lossless, up to 3 MiB). Measured 2026-11-06 at
      // quality 80: the largest of 29 real screenshots is 406 KiB, and a 2800x23880
      // full-page screenshot fitted to 8192 px is 528 KiB, so all keep full
      // resolution with about 2 times headroom.
      maxEncodedCanonicalBytes: 1024 * 1024,
      // Abuse protection (decompression bombs): a decode holds about 4 bytes per
      // pixel, so at most about 96 MB. A 6016x3384 display (20.4 million px) fits.
      maxPixels: 24e6,
      // Abuse protection: bounds long thin images that pass maxPixels. An 8K
      // display (7680 px wide) fits.
      maxDimension: 8192,
      // Abuse protection: one conversion holds a shared instance's CPU. The upload
      // route's 59 s maxDuration fits this plus two 20 s Storage writes.
      conversionTimeoutSeconds: 5,
      // Abuse protection: instances serve concurrent requests, so one decode of up
      // to about 96 MB runs at a time; others fail fast as conversion_busy and retry.
      maxConcurrentConversions: 1,
      // Abuse protection on what a model is sent: 4 of these make the 1 MiB
      // maxGatewayImageBytes.
      maxDerivativeBytes: 256 * 1024,
      // Provider maximum: Anthropic downscales images whose long edge is above
      // 1,568 px (standard tier, platform.claude.com/docs/en/build-with-claude/vision),
      // so pixels beyond that cost tokens and add nothing.
      maxDerivativeDimension: 1536,
      // One largest source as base64 (3 MiB x 4/3 = 4 MiB), so the local event JSON
      // stays under its existing 5 MB cap.
      maxInlineEncodedBytes: 4 * 1024 * 1024,
      // Abuse protection: metadata.cmem_media_v1 syncs to every device; 32 refs of
      // about 120 bytes each stay inside maxManifestBytes.
      maxObservationRefs: 32,
      // Abuse protection: labels are generated (event1_image1); 64 leaves room and
      // keeps a ref small.
      maxLabelChars: 64,
      // Abuse protection: bounds one manifest; 32 refs need about 4 KiB.
      maxManifestBytes: 8192,
      // Abuse protection: bounds the private provenance row; its largest part is
      // the 4096-character locator.
      maxProvenanceBytes: 8192,
      // Operating-system maximum: PATH_MAX is 4096 on Linux (1024 on macOS).
      maxSourceLocatorChars: 4096,
      // maxImagesPerEvent x maxDerivativeBytes: the most one observer turn can send.
      maxGatewayImageBytes: 4 * 256 * 1024,
      // maxSourceBytes plus 64 KiB for the manifest (8 KiB at most) and multipart
      // headers; still under Vercel's 4.5 MB request body maximum.
      maxUploadBodyBytes: 3 * 1024 * 1024 + 64 * 1024,
      // Abuse protection, sized so a paying user's images are not refused (owner,
      // 2026-11-05: "dont throw away images, on cloud they'll be PAYING me").
      // Measured 2026-11-05: the median converted pair (canonical plus derivative)
      // of 27 real screenshots is 321 KiB, so 100 screenshots a day is about
      // 11.2 GiB a year. Past the Pro plan's 100 GB, Supabase Storage costs $0.0213
      // per GB a month (supabase.com/docs/guides/platform/manage-your-usage/
      // storage-size, read 2026-11-05), so a full owner (26.8 GB) costs about $0.57
      // a month. Pro enforces it: uploads past it answer 413 quota_exceeded and the
      // image stays on the computer.
      ownerQuotaBytes: 25 * 1024 * 1024 * 1024
    });
    MediaError = class extends Error {
      constructor(code, message = code) {
        super(message);
        this.code = code;
        this.name = "MediaError";
      }
      code;
    };
    UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    LABEL = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
  }
});

// src/shared/cloud-sync-limits.ts
var init_cloud_sync_limits = __esm({
  "src/shared/cloud-sync-limits.ts"() {
    "use strict";
  }
});

// src/services/sync/CanonicalContent.ts
import { createHash as createHash2, randomUUID } from "crypto";
function jsonError(message) {
  const reason = redactSyncDiagnostic(message);
  logger.debug("CLOUD_SYNC", "Rejected invalid canonical content", { reason });
  throw new Error(`canonical content: ${reason}`);
}
function canonicalJson(value) {
  return JSON.stringify(normalizeJson(value, /* @__PURE__ */ new Set()));
}
function normalizeJson(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) jsonError("numbers must be finite");
    if (!Number.isSafeInteger(value) && Number.isInteger(value)) {
      jsonError("integers must be safe; use decimal strings for uint64 values");
    }
    if (Object.is(value, -0)) return 0;
    return value;
  }
  if (typeof value !== "object") jsonError(`unsupported JSON value ${typeof value}`);
  if (seen.has(value)) jsonError("cycles are not allowed");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => normalizeJson(item, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      jsonError("objects must be plain objects");
    }
    const input = value;
    const output = {};
    for (const key of Object.keys(input).sort()) {
      const item = input[key];
      if (item === void 0) jsonError(`undefined is not allowed at ${key}`);
      output[key] = normalizeJson(item, seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}
function sha256Base64Url(value) {
  return createHash2("sha256").update(value, "utf8").digest("base64url");
}
function assertCanonicalDecimal(value, options = {}) {
  if (typeof value !== "string" || !CANONICAL_DECIMAL.test(value)) {
    return jsonError("decimal values must be unsigned base-10 strings without leading zeroes");
  }
  if (BigInt(value) > UINT64_MAX) jsonError("decimal value exceeds uint64");
  if (options.positive && value === "0") jsonError("decimal value must be positive");
  return value;
}
function compareCanonicalDecimals(left, right) {
  assertCanonicalDecimal(left);
  assertCanonicalDecimal(right);
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
var CANONICAL_DECIMAL, UINT64_MAX;
var init_CanonicalContent = __esm({
  "src/services/sync/CanonicalContent.ts"() {
    "use strict";
    init_logger();
    init_diagnostic_redaction();
    init_media_contract();
    init_cloud_sync_limits();
    CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
    UINT64_MAX = 18446744073709551615n;
  }
});

// src/services/work-view/work-product.mjs
import { statSync as statSync3 } from "node:fs";
import { basename as basename4, extname, isAbsolute } from "node:path";
import { createHash as createHash3 } from "node:crypto";
function safeWebUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
function isLocalPath(value, isAbsolutePath = isAbsolute) {
  return typeof value === "string" && isAbsolutePath(value) && !value.includes("\0") && !value.split(/[\\/]/).includes("..");
}
function fileKind(path) {
  return isLocalPath(path) ? FILE_KINDS[extname(path).toLowerCase()] ?? null : null;
}
function kindForUrl(url, fallback) {
  const { hostname: hostname2, pathname } = new URL(url);
  if (hostname2 === "github.com" && /\/pull\/\d+/.test(pathname)) return "pull-request";
  if (/\.(?:vercel\.app|netlify\.app|pages\.dev)$/.test(hostname2)) return "deployment";
  const extension = FILE_KINDS[extname(pathname).toLowerCase()];
  return extension ?? fallback;
}
function parse(value) {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function urlsIn(value, found = []) {
  const pending = [value];
  const visited = /* @__PURE__ */ new WeakSet();
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "string") {
      const url = safeWebUrl(item);
      if (url) found.push(url);
    } else if (item && typeof item === "object" && !visited.has(item)) {
      visited.add(item);
      const children = Array.isArray(item) ? item : Object.entries(item).filter(([key, child]) => /url$/i.test(key) || typeof child === "object").map(([, child]) => child);
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
  }
  return found;
}
function commitShaResolver(shas) {
  const prefixes = /* @__PURE__ */ new Map();
  for (const sha of shas) for (let length = 7; length <= sha.length; length++) {
    const prefix = sha.slice(0, length), known = prefixes.get(prefix);
    if (known === void 0 || known !== null && sha.startsWith(known)) prefixes.set(prefix, sha);
    else if (known !== null && !known.startsWith(sha)) prefixes.set(prefix, null);
  }
  return (sha) => prefixes.has(sha) ? prefixes.get(sha) : sha;
}
function githubRepo(remote) {
  const match = typeof remote === "string" ? remote.trim().match(GITHUB_REMOTE) : null;
  return match ? `${match[1]}/${match[2]}` : null;
}
function gitUrl(product) {
  if (!product.repo) return void 0;
  return product.kind === "commit" ? `https://github.com/${product.repo}/commit/${product.sha}` : `https://github.com/${product.repo}/tree/${product.branch.split("/").map(encodeURIComponent).join("/")}`;
}
function outputText(call, response) {
  if (typeof response === "string") return response;
  if (response && typeof response === "object") return [response.stdout, response.stderr].filter((part) => typeof part === "string").join("\n");
  return typeof call.tool_response === "string" ? call.tool_response : "";
}
function commitSubjects(command) {
  const starts = [...command.matchAll(gitPattern(String.raw`commit\b`, "g"))].map((match) => match.index + match[0].length);
  return starts.map((start, index) => {
    const invocation = command.slice(start, starts[index + 1]);
    const argumentEnd = invocation.match(/^(?:>[&|]|<&|&>>?|[^"'\\;&|\n]|\\[\s\S]|"(?:[^"\\]|\\[\s\S])*"|'[^']*')*/)[0].length;
    const matchArgument = (pattern) => {
      const match = invocation.match(pattern);
      return match && match.index < argumentEnd ? match : null;
    };
    const substituted = matchArgument(/\s(?:-[a-zA-Z]*m\s+|--message(?:=|\s+))"\$\(\s*cat\s+<<-?\s*['"]?\w+['"]?[^\n]*\n([^\n]*)/);
    if (substituted) return short(substituted[1]);
    const inline = matchArgument(/\s(?:-[a-zA-Z]*m\s+|--message(?:=|\s+))(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
    const heredoc = matchArgument(/\s-F\s+-\s*<<-?\s*['"]?\w+['"]?\n([^\n]*)/);
    const text5 = inline ? inline[1]?.replace(BASH_DOUBLE_QUOTE_ESCAPE, "$1") ?? inline[2] : heredoc?.[1];
    return short(text5?.split("\n")[0]);
  });
}
function commitsFrom(command, response, out) {
  const commits = /* @__PURE__ */ new Map();
  const add = (sha, branch, subject) => {
    const known = commits.get(sha);
    commits.set(sha, { sha, branch: branch ?? known?.branch ?? null, subject: subject ?? known?.subject ?? null });
  };
  const recorded = response?.gitOperation?.commit;
  const subjects = commitSubjects(command);
  if (!subjects.length && !recorded?.sha) return [];
  for (const [, ref, sha, subject] of out.matchAll(new RegExp(String.raw`^\[(.+?)(?: \(root-commit\))? (${SHA})\] (.+)$`, "gm"))) {
    add(sha, ref.startsWith("detached HEAD") ? null : ref, short(subject));
  }
  if (typeof recorded?.sha === "string" && new RegExp(`^${SHA}$`).test(recorded.sha)) add(recorded.sha, typeof recorded.branch === "string" ? recorded.branch : null, null);
  if (!commits.size) {
    const rtkSha = subjects.length === 1 ? out.match(new RegExp(`^ok (${SHA})$`, "m"))?.[1] : null;
    if (rtkSha) add(rtkSha, null, subjects[0]);
    else {
      const printed = [...out.matchAll(new RegExp(`^(${SHA}) (.+)$`, "gm"))].map(([, sha, subject]) => [sha, short(subject)]);
      for (const subject of subjects) {
        const match = subject && printed.find(([, printedSubject]) => printedSubject === subject);
        if (match) add(match[0], null, subject);
      }
    }
  }
  const resolveSha = commitShaResolver([...commits.keys()]);
  const unique = /* @__PURE__ */ new Map();
  for (const commit of commits.values()) {
    const sha = resolveSha(commit.sha) ?? commit.sha, known = unique.get(sha);
    unique.set(sha, { ...commit, sha, branch: commit.branch ?? known?.branch ?? null, subject: commit.subject ?? known?.subject ?? null });
  }
  return [...unique.values()];
}
function pushTargets(command) {
  const word = String.raw`(?:[^\s"'<>;&|()]+|"[^"]*"|'[^']*')+`;
  const redirection = String.raw`(?:\d*(?:>>?|<{1,3})&?|&>>?)`;
  const pattern = gitPattern(String.raw`push\b((?:[ \t]+(?:#[^\n]*)?|${redirection}|${word})*)`, "g");
  const redirect = new RegExp(`^${redirection}$`);
  return [...command.matchAll(pattern)].map(([, args]) => {
    const shellTokens = args.match(new RegExp(`${redirection}|${word}`, "g")) ?? [];
    const tokens = [];
    for (let index = 0; index < shellTokens.length; index++) {
      if (shellTokens[index].startsWith("#")) break;
      if (redirect.test(shellTokens[index])) {
        index++;
        continue;
      }
      tokens.push(unquote(shellTokens[index]));
    }
    const positional = [];
    let dryRun = false, deleting = false, tags = false, repoOption;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token === "--") {
        positional.push(...tokens.slice(index + 1));
        break;
      }
      if (token === "--repo") {
        repoOption = tokens[++index];
        continue;
      }
      if (token.startsWith("--repo=")) {
        repoOption = token.slice("--repo=".length);
        continue;
      }
      if (/^--(?:push-option|receive-pack|exec|recurse-submodules)$/.test(token)) {
        index++;
        continue;
      }
      if (token.startsWith("--")) {
        if (token === "--dry-run" || token === "--no-dry-run") dryRun = token === "--dry-run";
        if (token === "--delete" || token === "--no-delete") deleting = token === "--delete";
        if (token === "--tags" || token === "--no-tags") tags = token === "--tags";
        continue;
      }
      if (token.startsWith("-")) {
        let flags = token.slice(1);
        const valueAt = flags.indexOf("o");
        if (valueAt !== -1) {
          if (valueAt === flags.length - 1) index++;
          flags = flags.slice(0, valueAt);
        }
        if (flags.includes("n")) dryRun = true;
        if (flags.includes("d")) deleting = true;
        continue;
      }
      positional.push(token);
    }
    const [remote, ...refspecs] = positional;
    const destinations = [];
    for (let index = 0; index < refspecs.length; index++) {
      const spec = refspecs[index];
      if (spec === "tag") {
        tags = true;
        index++;
        continue;
      }
      destinations.push(spec.startsWith(":") ? "" : spec.replace(/^\+/, "").split(":").at(-1));
    }
    const branches = deleting ? [] : destinations.map((ref) => ref && ref !== "HEAD" && (!ref.startsWith("refs/") || ref.startsWith("refs/heads/")) ? ref.replace(/^refs\/heads\//, "") : null);
    const deletesOrTags = deleting || tags || destinations.some((ref) => ref.startsWith("refs/tags/"));
    return { repo: githubRepo(remote ?? repoOption), branches, dryRun, deletesOrTags };
  });
}
function pushesFrom(command, response, out) {
  const targets = pushTargets(command);
  const recorded = response?.gitOperation?.push?.branch;
  if (!targets.length && typeof recorded !== "string") return [];
  let target = targets.length === 1 ? targets[0] : null;
  let index = 0;
  let repo = target?.repo ?? null;
  const pushes = /* @__PURE__ */ new Map();
  const add = (branch2, head) => {
    const key = JSON.stringify([repo, branch2]);
    pushes.set(key, { branch: branch2, repo, heads: head ? [head] : [] });
  };
  const lines = out.split("\n");
  const mixedSimulation = targets.some((t) => t.dryRun) && targets.some((t) => !t.dryRun);
  if (mixedSimulation) {
    const reportsPush = (text5) => typeof text5 === "string" && /^(?:To |Everything up-to-date$)/m.test(text5);
    if (lines.filter(reportsPush).length !== targets.length || reportsPush(response?.stdout) && reportsPush(response?.stderr)) return [];
  }
  for (const line of lines) {
    if (line === "Everything up-to-date") {
      index++;
      continue;
    }
    const remote = line.match(/^To (\S+)$/);
    if (remote) {
      target = targets[index++] ?? (targets.length === 1 ? targets[0] : null);
      repo = githubRepo(remote[1]) ?? target?.repo ?? null;
      continue;
    }
    if (target?.dryRun) continue;
    const porcelain = line.match(/^[ +*]\t[^:\t]*:refs\/heads\/([^\t]+)\t(.+)$/);
    if (porcelain) {
      add(porcelain[1], porcelain[2].match(new RegExp(String.raw`^${SHA}\.\.\.?(${SHA})`))?.[1]);
      continue;
    }
    const ref = line.match(new RegExp(String.raw`^\s*[ +*]?\s*(?:${SHA}\.\.\.?(${SHA})|\[new branch\])\s+(\S+)\s+->\s+(\S+)`));
    if (ref && !ref[3].startsWith("refs/tags/")) {
      const branch2 = ref[3].replace(/^refs\/heads\//, "");
      if (!target?.deletesOrTags || target.branches.includes(branch2) || line.includes("[new branch]")) add(branch2, ref[1]);
    }
  }
  const branch = recorded ?? target?.branches.find(Boolean);
  if (!pushes.size && targets.length <= 1 && !target?.dryRun && branch && (!target?.deletesOrTags || target.branches.includes(branch)) && !/Everything up-to-date|\[up to date\]|\[new tag\]|\[deleted\]|\[rejected\]|failed to push|^fatal:/m.test(out)) add(branch);
  return [...pushes.values()];
}
function createdBranchesFrom(command, out) {
  const requested = [...new Set([...command.matchAll(gitPattern(String.raw`(?:checkout\s+-[bB]|switch\s+-[cC])\s+("[^"]+"|'[^']+'|[^\s;&|)]+)`, "g"))].map((match) => unquote(match[1])))];
  const confirmed = new Set([...out.matchAll(/^(?:Switched to a new branch|Switched to and reset branch|Reset branch) '(.+)'\r?$/gm)].map((match) => match[1]));
  if (confirmed.size > 0 || /^(?:fatal:|error:|Already on ')/m.test(out)) {
    return requested.filter((branch) => confirmed.has(branch)).map((branch) => ({ branch, repo: null, heads: [] }));
  }
  return requested.filter((branch) => out.includes(`'${branch}'`)).map((branch) => ({ branch, repo: null, heads: [] }));
}
function pullRequestFrom(command, response, out, { atEpoch, sourceRef: sourceRef2 }) {
  if (!/(?:^|[;&|(\n])\s*(?:rtk\s+)?gh\s+pr\s+create\b/.test(command)) return [];
  const printed = out.match(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/m)?.[0];
  const url = safeWebUrl(response?.gitOperation?.pr?.url ?? printed);
  if (!url) return [];
  const title = command.match(/(?:--title(?:=|\s+)|\s-t\s+)(?:"((?:[^"\\]|\\.)+)"|'([^']+)'|([^\s"'-][^\s]*))/);
  const titleText = title?.[1]?.replace(BASH_DOUBLE_QUOTE_ESCAPE, "$1") ?? title?.[2] ?? title?.[3];
  return [{ kind: "pull-request", title: short(titleText) ?? `PR #${url.split("/").at(-1)}`, url, atEpoch, sourceRef: sourceRef2 }];
}
function pullRequestFromGitHubTool(input, response, { atEpoch, sourceRef: sourceRef2 }) {
  const repoPart = (value) => typeof value === "string" && /^[\w.-]+$/.test(value);
  const numericId = (value) => typeof value === "string" && /^[1-9]\d*$/.test(value) || Number.isSafeInteger(value) && value > 0;
  if (!repoPart(input.owner) || !repoPart(input.repo)) return [];
  const refused = (value) => value?.isError === true || value?.is_error === true || value?.error != null || value?.status === "awaiting_user_submission";
  if (refused(response) || refused(response?.structuredContent)) return [];
  const blocks = Array.isArray(response) ? response : response?.content;
  const candidates = [
    response?.structuredContent,
    response,
    ...Array.isArray(blocks) ? blocks.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => parse(block.text)) : []
  ];
  for (const result of candidates) {
    if (!result || typeof result !== "object" || refused(result) || !numericId(result.id)) continue;
    const url = safeWebUrl(result.html_url ?? result.url);
    if (!url) continue;
    const parsed = new URL(url), path = /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)$/.exec(parsed.pathname);
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port || parsed.search || parsed.hash || !path || path[1].toLowerCase() !== input.owner.toLowerCase() || path[2].toLowerCase() !== input.repo.toLowerCase() || result.number !== void 0 && (!numericId(result.number) || String(result.number) !== path[3])) continue;
    return [{ kind: "pull-request", title: short(result.title ?? input.title) ?? `PR #${path[3]}`, url, atEpoch, sourceRef: sourceRef2 }];
  }
  return [];
}
function gitProductsFromCommand(command, response, out, { atEpoch = null, sourceRef: sourceRef2 = null } = {}) {
  const pushes = pushesFrom(command, response, out);
  const branches = [...createdBranchesFrom(command, out).filter((created) => !pushes.some((pushed) => pushed.branch === created.branch)), ...pushes];
  const products = [];
  for (const commit of commitsFrom(command, response, out)) {
    const matchingPushes = pushes.filter((push) => push.heads.some((head) => matchingCommitSha(head, commit.sha)));
    const pushed = commit.branch && pushes.find((push) => push.branch === commit.branch) || (matchingPushes.length === 1 ? matchingPushes[0] : null) || (!commit.branch && pushes.length === 1 ? pushes[0] : null);
    products.push({ kind: "commit", title: commit.subject ? `${commit.sha.slice(0, 7)} ${commit.subject}` : commit.sha.slice(0, 7), sha: commit.sha, branch: commit.branch ?? pushed?.branch ?? null, repo: pushed?.repo ?? null, atEpoch, sourceRef: sourceRef2 });
  }
  for (const branch of branches) products.push({ kind: "branch", title: branch.branch, branch: branch.branch, repo: branch.repo, heads: branch.heads, atEpoch, sourceRef: sourceRef2 });
  return products.map((product) => ({ ...product, url: gitUrl(product) }));
}
function productsFromToolUse(call) {
  const input = parse(call.tool_input) ?? {}, response = parse(call.tool_response);
  const sourceRef2 = { kind: "tool-use", id: call.id };
  const atEpoch = call.created_at_epoch ?? null;
  if (GITHUB_PULL_REQUEST_TOOL.test(call.tool_name)) return pullRequestFromGitHubTool(input, response, { atEpoch, sourceRef: sourceRef2 });
  if (call.tool_name === "Bash" && typeof input.command === "string") {
    const out = outputText(call, response);
    return [...pullRequestFrom(input.command, response, out, { atEpoch, sourceRef: sourceRef2 }), ...gitProductsFromCommand(input.command, response, out, { atEpoch, sourceRef: sourceRef2 })];
  }
  const publisher = PUBLISHING_TOOLS.find((tool) => tool.match.test(call.tool_name));
  if (!publisher || !response) return [];
  if (call.tool_name === "Artifact" && (input.action ?? "publish") !== "publish") return [];
  if (call.tool_name === "Artifact" && input.asset) return [];
  const urls = [...new Set(urlsIn(response))].filter((url) => !/\/(?:api|oauth)\//.test(new URL(url).pathname));
  const title = short(response.title ?? input.title ?? input.name) ?? (isLocalPath(input.file_path) ? basename4(input.file_path) : null);
  return urls.slice(0, 1).map((url) => ({ kind: kindForUrl(url, publisher.kind), title: title ?? new URL(url).hostname, url, atEpoch, sourceRef: sourceRef2 }));
}
function productsFromObservation(observation) {
  const files = parse(observation.files_modified);
  if (!Array.isArray(files)) return [];
  return files.flatMap((path, index) => {
    const kind = fileKind(path);
    if (!kind) return [];
    const title = /^index\.\w+$/i.test(basename4(path)) ? basename4(path.slice(0, -basename4(path).length - 1)) || basename4(path) : basename4(path);
    return [{ kind, title, path, atEpoch: observation.created_at_epoch ?? null, sourceRef: { kind: "observation", id: observation.id, index } }];
  });
}
function isWorkProductField(field) {
  return WORK_PRODUCT_FIELDS.has(field) || /_url$/.test(field);
}
function productsFromFields(fields, { atEpoch = null, sourceRef: sourceRef2 = null } = {}) {
  const products = [];
  let index = 0;
  for (const [field, value] of Object.entries(fields ?? {})) {
    if (!isWorkProductField(field)) continue;
    const decoded = WORK_PRODUCT_FIELDS.has(field) && typeof value === "string" && /^\s*[[{]/.test(value) ? parse(value) ?? value : value;
    const values2 = WORK_PRODUCT_FIELDS.has(field) ? Array.isArray(decoded) ? decoded : [decoded] : typeof value === "string" ? [value] : [];
    for (const value2 of values2) {
      const entry = value2 && typeof value2 === "object" && !Array.isArray(value2) ? value2 : { url: value2 };
      const url = safeWebUrl(entry.url ?? entry.link);
      const path = isLocalPath(entry.path) ? entry.path : isLocalPath(entry.url) ? entry.url : null;
      const kind = short(entry.kind), title = short(entry.title ?? entry.name);
      const ref = sourceRef2 && { ...sourceRef2, index: index++ };
      if (url) products.push({ kind: kind ?? kindForUrl(url, LEGACY_KINDS[field] ?? "link"), title: title ?? new URL(url).hostname, url, field, atEpoch, sourceRef: ref });
      else if (path && (kind || fileKind(path))) products.push({ kind: kind ?? fileKind(path), title: title ?? basename4(path), path, field, atEpoch, sourceRef: ref });
    }
  }
  return products;
}
function localProductId(ref) {
  if (!ref || !["observation", "work-state", "deliverable"].includes(ref.kind) || typeof ref.device !== "string" || !ref.device || !/^\d+$/.test(String(ref.row ?? "")) || ref.index !== void 0 && (!Number.isSafeInteger(ref.index) || ref.index < 0)) return null;
  return `local_${createHash3("sha256").update(JSON.stringify([ref.kind, ref.device, String(ref.row), ref.index ?? 0])).digest("hex")}`;
}
function mergeProducts(lists, limit = 60) {
  const recorded = lists.flat();
  const resolveSha = commitShaResolver(recorded.flatMap((product) => product.kind === "commit" && product.sha ? [product.sha] : product.heads ?? []));
  const products = recorded.map((product) => product.kind === "commit" && product.sha ? { ...product, sha: resolveSha(product.sha) ?? product.sha } : product);
  const pushesByBranch = /* @__PURE__ */ new Map(), repoByHead = /* @__PURE__ */ new Map(), repoBySource = /* @__PURE__ */ new Map();
  for (const product of products) if (product.kind === "branch" && product.repo) {
    if (!pushesByBranch.has(product.branch)) pushesByBranch.set(product.branch, []);
    pushesByBranch.get(product.branch).push(product);
    for (const head of product.heads ?? []) {
      const sha = resolveSha(head);
      if (sha === null) continue;
      if (!repoByHead.has(sha)) repoByHead.set(sha, /* @__PURE__ */ new Set());
      repoByHead.get(sha).add(product.repo);
    }
  }
  const sourceKey = (product) => product.sourceRef ? `${product.sourceRef.kind}:${product.sourceRef.id}` : null;
  const pushedAfter = (product) => {
    const repos = new Set((pushesByBranch.get(product.branch) ?? []).filter((push) => product.kind === "branch" || (push.atEpoch ?? 0) >= (product.atEpoch ?? 0)).map((push) => push.repo));
    return repos.size === 1 ? [...repos][0] : null;
  };
  const repoOf = (product) => {
    const repos = product.sha ? repoByHead.get(product.sha) : null;
    return product.repo ?? pushedAfter(product) ?? (repos?.size === 1 ? [...repos][0] : null);
  };
  for (const product of products) if (product.kind === "commit") {
    const source = sourceKey(product), repo = repoOf(product);
    if (!source || !repo) continue;
    if (!repoBySource.has(source)) repoBySource.set(source, /* @__PURE__ */ new Set());
    repoBySource.get(source).add(repo);
  }
  const unique = /* @__PURE__ */ new Map();
  for (const product of products.sort((a, b) => (b.atEpoch ?? 0) - (a.atEpoch ?? 0))) {
    const isGit = product.kind === "commit" || product.kind === "branch";
    const sourceRepos = repoBySource.get(sourceKey(product));
    const repo = isGit && !product.repo ? repoOf(product) ?? (product.kind === "commit" && sourceRepos?.size === 1 ? [...sourceRepos][0] : null) : null;
    const resolved = repo || isGit && product.repo ? { ...product, ...repo ? { repo } : {}, url: gitUrl({ ...product, repo: repo ?? product.repo }) } : product;
    const key = productKey(resolved);
    if (!unique.has(key)) unique.set(key, resolved);
  }
  return [...unique.values()].slice(0, limit);
}
function productsFromDeliverable(row) {
  if (!Number.isSafeInteger(row?.id) || row.id < 1 || typeof row.bucket_path !== "string" || !row.bucket_path) return [];
  const name = basename4(row.bucket_path);
  return [{
    kind: short(row.kind) ?? fileKind(row.bucket_path) ?? "file",
    title: short(row.title) ?? name,
    url: `/api/deliverables/${row.id}/${encodeURIComponent(name)}`,
    bucketPath: row.bucket_path,
    sourcePath: typeof row.source_path === "string" ? row.source_path : null,
    deliverable: true,
    atEpoch: row.created_at_epoch ?? null,
    sourceRef: { kind: "deliverable", id: row.id }
  }];
}
function bucketFileAvailable(product) {
  if (typeof product?.bucketPath !== "string" || !product.bucketPath) return false;
  try {
    return statSync3(product.bucketPath).isFile();
  } catch {
    return false;
  }
}
function copyCoversSource(copy, sourcePath) {
  if (typeof copy?.atEpoch !== "number" || !bucketFileAvailable(copy)) return false;
  try {
    const source = statSync3(sourcePath);
    return !source.isFile() || source.mtimeMs <= copy.atEpoch;
  } catch {
    return true;
  }
}
function servableFile(product) {
  if (!product?.path || !fileKind(product.path)) return null;
  try {
    return statSync3(product.path).isFile() ? product.path : null;
  } catch {
    return null;
  }
}
function fileUrl(product) {
  const ref = product.sourceRef;
  return product.path && ref ? `/api/work-view/file/${ref.kind}/${ref.id}/${ref.index ?? 0}` : null;
}
var FILE_KINDS, PUBLISHING_TOOLS, GITHUB_PULL_REQUEST_TOOL, WORK_PRODUCT_FIELDS, LEGACY_KINDS, MAX_TITLE, short, GIT_PREFIX, gitPattern, GITHUB_REMOTE, SHA, unquote, matchingCommitSha, BASH_DOUBLE_QUOTE_ESCAPE, productKey, FILE_EXTENSION_PATTERN;
var init_work_product = __esm({
  "src/services/work-view/work-product.mjs"() {
    "use strict";
    FILE_KINDS = {
      ".png": "image",
      ".jpg": "image",
      ".jpeg": "image",
      ".webp": "image",
      ".gif": "image",
      ".svg": "image",
      ".mp4": "video",
      ".mov": "video",
      ".webm": "video",
      ".pdf": "document",
      ".docx": "document",
      ".pptx": "deck",
      ".key": "deck",
      ".xlsx": "spreadsheet",
      ".csv": "spreadsheet",
      ".html": "page"
    };
    PUBLISHING_TOOLS = [
      { match: /^Artifact$/, kind: "artifact" },
      { match: /notion-create-pages$/, kind: "page" },
      { match: /Claude_Docs__(?:batch|create)$/, kind: "document" },
      { match: /chatgpt_space__create_page$/, kind: "page" },
      { match: /sites__save_version_and_deploy/, kind: "deployment" }
    ];
    GITHUB_PULL_REQUEST_TOOL = /(?:^|__)create_pull_request$/;
    WORK_PRODUCT_FIELDS = /* @__PURE__ */ new Set(["work_product", "work_products", "deliverable", "deliverables"]);
    LEGACY_KINDS = { docs_url: "documentation", documentation_url: "documentation", promo_url: "promotion", announcement_url: "promotion", pr_url: "pull-request", deck_url: "deck", artifact_url: "artifact" };
    MAX_TITLE = 140;
    short = (value) => {
      const text5 = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
      return text5 ? text5.length > MAX_TITLE ? `${text5.slice(0, MAX_TITLE - 1).trimEnd()}…` : text5 : null;
    };
    GIT_PREFIX = String.raw`(?:^|[;&|(\n])\s*(?:rtk\s+)?(?:\/usr\/bin\/)?git(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))*\s+`;
    gitPattern = (subcommand, flags = "") => new RegExp(GIT_PREFIX + subcommand, flags);
    GITHUB_REMOTE = /^(?:https:\/\/github\.com\/|(?:git@)?github\.com:|ssh:\/\/(?:git@)?(?:github\.com(?::22)?|ssh\.github\.com:443)\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;
    SHA = "[0-9a-f]{7,40}";
    unquote = (token) => token.replace(/^(["'])(.*)\1$/, "$2");
    matchingCommitSha = (left, right) => left.startsWith(right) || right.startsWith(left);
    BASH_DOUBLE_QUOTE_ESCAPE = /\\([$`"\\])/g;
    productKey = (product) => product.kind === "commit" && product.sha ? `commit:${product.sha}` : product.kind === "branch" && product.branch ? `branch:${product.repo ?? ""}:${product.branch}` : product.productId ?? product.url ?? product.path;
    FILE_EXTENSION_PATTERN = Object.keys(FILE_KINDS).map((extension) => `files_modified LIKE '%${extension}"%'`).join(" OR ");
  }
});

// src/utils/worktree.ts
var init_worktree = __esm({
  "src/utils/worktree.ts"() {
    "use strict";
    init_logger();
  }
});

// src/utils/project-filter.ts
var init_project_filter = __esm({
  "src/utils/project-filter.ts"() {
    "use strict";
    init_expand_home();
    init_logger();
  }
});

// src/utils/project-environments.ts
var init_project_environments = __esm({
  "src/utils/project-environments.ts"() {
    "use strict";
    init_project_filter();
    init_logger();
  }
});

// src/utils/project-name.ts
import { existsSync as existsSync7, realpathSync as realpathSync2, statSync as statSync4 } from "fs";
function settingsFileMtimeMs() {
  try {
    return statSync4(USER_SETTINGS_PATH).mtimeMs;
  } catch {
    return -1;
  }
}
function readIdentitySettings() {
  const mtimeMs = settingsFileMtimeMs();
  if (mtimeMs === -1) {
    return SettingsDefaultsManager.getAllDefaults();
  }
  if (identitySettingsCache && identitySettingsCache.mtimeMs === mtimeMs) {
    return identitySettingsCache.settings;
  }
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  identitySettingsCache = { mtimeMs: settingsFileMtimeMs(), settings };
  return settings;
}
function useGitRemoteProjectNames() {
  const source = process.env[PROJECT_NAME_SOURCE_SETTING] ?? readIdentitySettings().CLAUDE_MEM_PROJECT_NAME_SOURCE;
  return String(source ?? "path").trim().toLowerCase() === "git-remote";
}
var PROJECT_NAME_SOURCE_SETTING, identitySettingsCache;
var init_project_name = __esm({
  "src/utils/project-name.ts"() {
    "use strict";
    init_expand_home();
    init_paths();
    init_SettingsDefaultsManager();
    init_logger();
    init_worktree();
    init_project_environments();
    PROJECT_NAME_SOURCE_SETTING = "CLAUDE_MEM_PROJECT_NAME_SOURCE";
    identitySettingsCache = null;
  }
});

// src/services/work-view/session-project.mjs
import { existsSync as existsSync8, realpathSync as realpathSync3 } from "node:fs";
import { homedir as homedir6, tmpdir } from "node:os";
import { basename as basename5, dirname as dirname5, join as join8, resolve as resolve3, sep as sep2 } from "node:path";
function projectRoot(project, gitRemoteNames = useGitRemoteProjectNames()) {
  if (typeof project !== "string") return null;
  return gitRemoteNames ? project : project.split("/")[0];
}
function upgradedGroupRoot(savedRoot, anchorRoot, memberRoots = []) {
  if (typeof savedRoot !== "string" || !savedRoot || savedRoot.includes("/")) return savedRoot;
  const widened = (root) => typeof root === "string" && root.startsWith(`${savedRoot}/`);
  if (widened(anchorRoot)) return anchorRoot;
  const candidates = new Set(memberRoots.filter(widened));
  return candidates.size === 1 ? [...candidates][0] : savedRoot;
}
var NO_PROJECT, realpathOrSelf, TEMP_FOLDERS, HOME, TEMP_PROJECT_NAMES, AGENT_HOMES;
var init_session_project = __esm({
  "src/services/work-view/session-project.mjs"() {
    "use strict";
    init_project_name();
    NO_PROJECT = "";
    realpathOrSelf = (path) => {
      try {
        return realpathSync3(path);
      } catch {
        return path;
      }
    };
    TEMP_FOLDERS = [.../* @__PURE__ */ new Set([resolve3(tmpdir()), realpathOrSelf(resolve3(tmpdir())), "/tmp", "/private/tmp"])];
    HOME = homedir6();
    TEMP_PROJECT_NAMES = new Set(TEMP_FOLDERS.map((folder) => basename5(folder)).filter((name) => name && name !== "tmp"));
    AGENT_HOMES = [".claude", ".codex", ".gemini", ".claude-mem", ".cursor"].map((name) => join8(HOME, name));
  }
});

// src/services/work-view/request-projection.mjs
import { createHash as createHash4 } from "node:crypto";
function requestMediaSummary(activity) {
  const refs = /* @__PURE__ */ new Map();
  for (const entry of activity) for (const ref of entry.media?.attachments ?? []) if (!refs.has(ref.id)) refs.set(ref.id, ref);
  if (!refs.size) return null;
  return { count: refs.size, preview: [...refs.values()].slice(0, REQUEST_MEDIA_PREVIEW_LIMIT) };
}
function requestText(value, max = 1200) {
  if (typeof value !== "string") return null;
  const requestSection = value.match(/^\s*#{1,2}\s+My request\s*:\s*(?:\r?\n)?([\s\S]*)$/im);
  const text5 = (requestSection?.[1] ?? value).replace(/<(environment_context|instructions|system-reminder|turn_aborted|permissions|collaboration_mode|skills_instructions)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/^\s*#\s*AGENTS\.md instructions[^\n]*(?:\n|$)/gim, " ").replace(/<\/?pasted_content\b[^>]*>/gi, "").trim();
  if (/^\s*#{1,2}\s+Files mentioned by the user\s*:/i.test(text5)) return null;
  if (!text5 || /^\s*<(?:environment_context|instructions|system-reminder)\b/i.test(text5)) return null;
  return text5.length > max ? `${text5.slice(0, max - 1).trimEnd()}…` : text5;
}
function isHumanActionRequest(value) {
  const text5 = requestText(value);
  if (!text5) return false;
  const plain2 = text5.replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
  if (/^(?:please\s+)?read\s+(?:the\s+)?[\w./ -]*(?:AGENTS|KICKOFF|CLAUDE)\.md(?:\s+and\s+(?:follow|obey|read|apply)(?:\s+it|\s+the\s+instructions)?\s*)?[.!]?$/i.test(plain2)) return false;
  if (/^(?:hi|hello|hey|thanks|thank you|ok(?:ay)?|yes|no|sure|continue|go ahead|keep going|resume|done)[.!\s]*$/i.test(plain2)) return false;
  if (/^(?:You are (?:Codex|an AI)|Available skills|Environment context)\b/i.test(plain2)) return false;
  if (/^(?:(?:please|just)\s+)?make sure (?:this|that|it|everything) (?:is |will be |keeps? )?(?:working|works|ok|okay|correct)(?:[.!\s]*)$/i.test(plain2)) return false;
  if (/^you can (?:def(?:initely)? )?do (?:real )?tests?[,;.!\s]/i.test(plain2) && !/\b(?:fix|build|create|implement|change|update|rename|remove|add)\b/i.test(plain2)) return false;
  if (/(?:^|\s)GOAL\s*:\s*\S/i.test(plain2)) return true;
  if (ENGLISH_ACTION.test(plain2)) return true;
  const opening = IMPERATIVE_OPENING.exec(plain2);
  if (opening && !NOT_A_VERB.test(opening[1])) return true;
  if (/[^\x00-\x7F]/.test(plain2)) return new RegExp("\\p{L}.*\\p{L}", "u").test(plain2);
  return !ENGLISH_WORDS.test(plain2) && (plain2.match(/\b[a-z]{3,}\b/gi) ?? []).length >= 2;
}
function humanRequestTitle(original) {
  const text5 = requestText(typeof original === "string" ? original : original?.text);
  if (!text5) return "";
  const goal = text5.match(/(?:^|\n)\s*GOAL\s*:\s*([^\n]+)/i);
  const lines = text5.split(/\n+/).map((line2) => line2.trim()).filter(Boolean);
  const first = goal?.[1] ?? lines[0] ?? "";
  const nextQuotedLine = /\bcalled\s*$/i.test(first) && /^["“'‘]/.test(lines[1] ?? "") ? ` ${lines[1]}` : "";
  const line = `${first}${nextQuotedLine}`.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#{1,6}\s*/, "").replace(/\s+/g, " ").trim();
  const clause = line.split(/(?<=[.!?])\s|;\s/)[0];
  if (clause.length <= 100) return clause;
  const cut = clause.slice(0, 99), boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > 60 ? boundary : 99).trimEnd()}…`;
}
function placeholderTitleFromAsk(askText) {
  const ask = requestText(askText ?? null, FOCUS_ASK_CHARS);
  return humanRequestTitle(ask) || requestText(ask, 120) || "Untitled request";
}
function conversationKey(session) {
  if (!session?.content_session_id || !session?.platform_source) return null;
  return JSON.stringify(["conversation", session.platform_source, session.content_session_id]);
}
function compareSourceOrder(a = null, b = null) {
  if (!a || !b) return 0;
  const time = a[0] - b[0];
  const device = a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  const left = BigInt(a[2]), right = BigInt(b[2]);
  return time || device || (left < right ? -1 : left > right ? 1 : 0);
}
function originalFor(session, prompts) {
  const ordered = prompts.filter((prompt) => prompt.session_db_id === session.id).sort((a, b) => (a.prompt_number ?? Infinity) - (b.prompt_number ?? Infinity) || (a.created_at_epoch ?? 0) - (b.created_at_epoch ?? 0) || a.id - b.id);
  const first = ordered.find((prompt) => isHumanActionRequest(prompt.prompt_text));
  const initial = () => ({ text: requestText(session.user_prompt), source: "session-initial-request", sourceId: session.sharedOnly ? null : session.id, url: session.sharedOnly ? null : `/api/work-view/evidence/session/${session.id}`, ...session.sharedOnly ? { sourceIdentity: { kind: "session", conversation: conversationKey(session) } } : {}, promptNumber: 1, atEpoch: session.started_at_epoch ?? null });
  if (isHumanActionRequest(session.user_prompt) && (!first || first.prompt_number > 1)) return initial();
  if (first) return { text: requestText(first.prompt_text), source: "user-prompt", sourceId: first.id, url: `/api/work-view/evidence/prompt/${first.id}`, promptNumber: first.prompt_number, atEpoch: first.created_at_epoch ?? null };
  if (isHumanActionRequest(session.user_prompt)) return initial();
  return null;
}
function buildHumanRequests(view, records = {}, { titleCache = {}, ledger = null, onProductFile = null, localFiles = true, getProjectRoot = projectRoot } = {}) {
  const sessions = new Map((records.sessions ?? []).map((session) => [session.id, session]));
  const prompts = records.prompts ?? [];
  const promptsBySession = /* @__PURE__ */ new Map();
  for (const prompt of prompts) {
    if (!promptsBySession.has(prompt.session_db_id)) promptsBySession.set(prompt.session_db_id, []);
    promptsBySession.get(prompt.session_db_id).push(prompt);
  }
  const flattened = (view.agents ?? []).flatMap((agent) => (agent.work ?? []).map((item) => ({ ...item, agentId: agent.id, agentLabel: agent.label, agentSessionId: agent.sessionId })));
  const subagentIds = new Set((view.agents ?? []).filter((agent) => agent.isSubagent).map((agent) => agent.id));
  const activityPool = /* @__PURE__ */ new Map();
  for (const agent of view.agents ?? []) for (const activity of agent.activity ?? []) activityPool.set(`${agent.id}:${activity.id}`, { ...activity, agentId: agent.id, agentLabel: agent.label });
  for (const activity of view.recentActivity ?? []) {
    const agent = (view.agents ?? []).find((candidate) => candidate.id === activity.agentGroupId);
    if (agent) activityPool.set(`${agent.id}:${activity.id}`, { ...activity, agentId: agent.id, agentLabel: agent.label });
  }
  function activityFor(items, requestId, limit) {
    const matches = /* @__PURE__ */ new Map();
    for (const item of items) {
      const refs = new Set((item.sourceRefs ?? []).map((ref) => `${ref.kind}:${ref.id}`));
      for (const activity of activityPool.values()) {
        if (activity.agentId !== item.agentId) continue;
        const direct = refs.has(activity.id) || activity.sourceRef && refs.has(`${activity.sourceRef.kind}:${activity.sourceRef.id}`);
        const observationForPrompt = activity.kind === "observation" && item.request?.key && activity.requestKey === item.request.key;
        if (direct || observationForPrompt) matches.set(`${activity.agentId}:${activity.id}`, { ...activity, promptRequestKey: activity.requestKey ?? null, requestKey: requestId });
      }
    }
    return [...matches.values()].sort((a, b) => (b.atEpoch ?? 0) - (a.atEpoch ?? 0)).slice(0, limit);
  }
  const explicitIds = /* @__PURE__ */ new Map();
  for (const item of flattened) {
    const key = conversationKey(sessions.get(item.agentSessionId));
    if (key && item.requestId) {
      if (!explicitIds.has(key)) explicitIds.set(key, /* @__PURE__ */ new Set());
      explicitIds.get(key).add(String(item.requestId));
    }
  }
  const sessionsByKey = /* @__PURE__ */ new Map();
  for (const session of sessions.values()) {
    const key = conversationKey(session);
    if (key && !sessionsByKey.has(key)) sessionsByKey.set(key, session);
  }
  const rootFromMembers = (groupId, group) => {
    const anchorRoot = getProjectRoot(sessionsByKey.get(group.anchor)?.project);
    if (anchorRoot) return anchorRoot;
    const memberRoots = new Set(Object.entries(ledger.groups.conversations).filter(([, id]) => id === groupId).map(([key]) => getProjectRoot(sessionsByKey.get(key)?.project)).filter(Boolean));
    return memberRoots.size === 1 ? [...memberRoots][0] : NO_PROJECT;
  };
  const derivedRoots = /* @__PURE__ */ new Map();
  const groupRoot = (groupId) => {
    const group = ledger?.groups?.groups?.[groupId];
    if (group?.projectRoot === NO_PROJECT) {
      if (!derivedRoots.has(groupId)) derivedRoots.set(groupId, rootFromMembers(groupId, group));
      return derivedRoots.get(groupId);
    }
    return getProjectRoot(sessionsByKey.get(group?.anchor)?.project);
  };
  const groupFor = (key, session) => {
    const groupId = key ? ledger?.groups?.conversations?.[key] ?? null : null;
    if (!groupId) return null;
    const storedRoot = ledger.groups.groups[groupId]?.projectRoot;
    if (typeof storedRoot === "string" && storedRoot !== NO_PROJECT) return groupId;
    const own = getProjectRoot(session?.project), expected = groupRoot(groupId);
    return own == null || expected == null || own === expected || storedRoot === NO_PROJECT && own === NO_PROJECT ? groupId : null;
  };
  const requests = /* @__PURE__ */ new Map(), unlinkedWork = [];
  const requestFor = (id, { key, original, groupId = null, explicit = null, explicitText = null }) => {
    let request = requests.get(id);
    const anchorAsk = groupId ? ledger?.groups?.groups?.[groupId]?.anchorAsk ?? null : null;
    if (anchorAsk && (anchorAsk.atEpoch ?? Infinity) < (original.atEpoch ?? Infinity)) original = anchorAsk;
    if (!request) {
      request = { id, conversationKey: key, conversationKeys: [], original, explicitRequestText: explicitText, scopeUpdates: [], projects: [], agentIds: [], items: [], workstreams: [], updatedAtEpoch: 0, explicitRequestId: explicit, groupId };
      requests.set(id, request);
    } else {
      if (!request.explicitRequestText && explicitText) request.explicitRequestText = explicitText;
      if (groupId && (original.atEpoch ?? Infinity) < (request.original.atEpoch ?? Infinity)) request.original = original;
    }
    if (key && !request.conversationKeys.includes(key)) request.conversationKeys.push(key);
    return request;
  };
  const addProject = (request, project) => {
    if (typeof project === "string" && project && !request.projects.includes(project)) request.projects.push(project);
  };
  for (const [key, session] of [...sessionsByKey].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (explicitIds.has(key) || ledger?.groups?.ignored?.[key]) continue;
    const original = originalFor(session, promptsBySession.get(session.id) ?? []);
    if (!original) continue;
    const groupId = groupFor(key, session);
    addProject(requestFor(groupId ? JSON.stringify(["overall-request", groupId]) : key, { key, original, groupId }), session.project);
  }
  for (const [groupId, group] of Object.entries(ledger?.groups?.groups ?? {})) {
    const id = JSON.stringify(["overall-request", groupId]);
    if (requests.has(id) || !group?.anchorAsk || ledger?.groups?.ignored?.[group.anchor]) continue;
    const anchorSession = sessionsByKey.get(group.anchor);
    if (anchorSession) continue;
    requestFor(id, { key: isConversationKey(group.anchor) ? group.anchor : null, original: group.anchorAsk, groupId });
  }
  for (const item of flattened) {
    const session = sessions.get(item.agentSessionId);
    const key = conversationKey(session);
    const knownIds = explicitIds.get(key);
    const explicit = item.requestId ? String(item.requestId) : knownIds?.size === 1 ? [...knownIds][0] : null;
    if (!item.requestId && knownIds?.size > 1) {
      unlinkedWork.push({ ...item, reason: "multiple-explicit-requests-without-item-link" });
      continue;
    }
    let original = session ? originalFor(session, promptsBySession.get(session.id) ?? []) : null;
    const explicitText = isHumanActionRequest(item.requestText) ? requestText(item.requestText) : null;
    if (!original && explicit && explicitText) original = { text: explicitText, source: "explicit-work-state-request", sourceId: item.id, url: item.url, promptNumber: null, atEpoch: item.lastUpdateEpoch ?? null };
    if (!original || !key && !explicit) {
      unlinkedWork.push({ ...item, reason: key ? "no-substantive-human-request" : "no-confirmed-conversation-or-explicit-request" });
      continue;
    }
    if (!explicit && key && ledger?.groups?.ignored?.[key]) {
      unlinkedWork.push({ ...item, reason: "ignored-by-request-grouping" });
      continue;
    }
    const groupId = !explicit ? groupFor(key, session) : null;
    const root = getProjectRoot(session?.project) ?? getProjectRoot(item.project);
    const id = explicit ? JSON.stringify(root == null ? ["explicit-request", explicit] : ["explicit-request", root, explicit]) : groupId ? JSON.stringify(["overall-request", groupId]) : key;
    const request = requestFor(id, { key, original, groupId, explicit, explicitText });
    addProject(request, session?.project);
    addProject(request, item.project);
    if (!request.agentIds.includes(item.agentId)) request.agentIds.push(item.agentId);
    request.items.push(item);
    request.updatedAtEpoch = Math.max(request.updatedAtEpoch, item.lastUpdateEpoch ?? 0);
  }
  const requestsByConversation = /* @__PURE__ */ new Map();
  for (const request of requests.values()) for (const key of request.conversationKeys) {
    if (!requestsByConversation.has(key)) requestsByConversation.set(key, []);
    requestsByConversation.get(key).push(request);
  }
  const sessionsByMemory = new Map([...sessions.values()].filter((session) => session.memory_session_id).map((session) => [session.memory_session_id, session]));
  const recordedProducts = /* @__PURE__ */ new Map();
  const attach = (session, products) => {
    const owners = requestsByConversation.get(conversationKey(session));
    if (owners?.length !== 1 || !products.length) return;
    if (!recordedProducts.has(owners[0])) recordedProducts.set(owners[0], []);
    recordedProducts.get(owners[0]).push(...products);
  };
  for (const call of records.productCalls ?? []) attach(sessions.get(call.session_db_id), productsFromToolUse(call));
  for (const observation of records.productObservations ?? []) attach(sessionsByMemory.get(observation.memory_session_id), productsFromObservation(observation));
  for (const row of records.productDeliverables ?? []) attach(row, productsFromDeliverable(row));
  for (const record of records.sharedProducts ?? []) {
    const session = sessionsByKey.get(record.conversationKey);
    if (session) attach(session, record.products ?? []);
  }
  const sessionIdsByKey = /* @__PURE__ */ new Map();
  for (const session of sessions.values()) {
    const key = conversationKey(session);
    if (key) sessionIdsByKey.set(key, [...sessionIdsByKey.get(key) ?? [], session.id]);
  }
  for (const request of requests.values()) {
    const merged = mergeProducts([...recordedProducts.get(request) ?? [], ...request.items.flatMap((item) => item.workProduct ?? [])]);
    request.sourceProductHash = createHash4("sha256").update(canonicalJson(JSON.parse(JSON.stringify(merged)))).digest("hex");
    request.sourceProductRecordedAtEpoch = merged.every((product) => Number.isFinite(product.atEpoch) && product.atEpoch > 0) ? merged.reduce((latest, product) => Math.max(latest, product.atEpoch), 0) : null;
    const copies = localFiles ? merged.filter((product) => product.deliverable && product.sourcePath) : [];
    const coverage = new Map(copies.map((copy) => [copy, copyCoversSource(copy, copy.sourcePath)]));
    const covered = (product) => Boolean(product.path) && copies.some((copy) => copy.sourcePath === product.path && coverage.get(copy));
    request.workProduct = merged.filter((product) => !covered(product)).map((product) => {
      const available = product.path ? localFiles && Boolean(servableFile(product)) : product.deliverable ? localFiles && bucketFileAvailable(product) : true;
      if (product.path || product.bucketPath) onProductFile?.(product, available, coverage.get(product) ?? null);
      return { ...product, fileUrl: localFiles ? fileUrl(product) : null, available };
    });
    const relatedIds = new Set(request.conversationKeys.flatMap((key) => sessionIdsByKey.get(key) ?? []));
    const related = [...relatedIds].flatMap((id) => promptsBySession.get(id) ?? []);
    request.updatedAtEpoch = Math.max(request.updatedAtEpoch, request.original.atEpoch ?? 0, ...related.map((prompt) => prompt.created_at_epoch ?? 0));
    if (!request.agentIds.length) {
      for (const agent of view.agents ?? []) if (relatedIds.has(agent.sessionId) && !request.agentIds.includes(agent.id)) request.agentIds.push(agent.id);
    }
    request.scopeUpdates = related.filter((prompt) => !(request.original.source === "user-prompt" && prompt.id === request.original.sourceId) && requestText(prompt.prompt_text) && (request.original.promptNumber == null || prompt.prompt_number >= request.original.promptNumber)).sort((a, b) => {
      const first = conversationKey(sessions.get(a.session_db_id)) ?? "";
      const second = conversationKey(sessions.get(b.session_db_id)) ?? "";
      return (b.created_at_epoch ?? 0) - (a.created_at_epoch ?? 0) || b.prompt_number - a.prompt_number || (first < second ? 1 : first > second ? -1 : 0) || b.id - a.id;
    }).slice(0, 6).reverse().map((prompt) => ({ text: requestText(prompt.prompt_text, 500), sourceId: prompt.id, url: `/api/work-view/evidence/prompt/${prompt.id}`, promptNumber: prompt.prompt_number, atEpoch: prompt.created_at_epoch ?? null }));
    const streams = /* @__PURE__ */ new Map();
    for (const item of request.items) {
      const id = item.listId ?? JSON.stringify(["agent-session", item.agentId]);
      if (!streams.has(id)) streams.set(id, { id, title: item.listName ?? item.title, agentIds: [], items: [] });
      const stream = streams.get(id);
      if (!stream.agentIds.includes(item.agentId)) stream.agentIds.push(item.agentId);
      stream.items.push(item);
    }
    request.workstreams = [...streams.values()];
    request.agentIds.sort((a, b) => Number(subagentIds.has(a)) - Number(subagentIds.has(b)));
    for (const stream of request.workstreams) stream.activity = activityFor(stream.items, request.id, 20);
    request.activity = activityFor(request.items, request.id, 40);
    const media = requestMediaSummary(request.activity);
    if (media) request.media = media;
    const metadata = (key) => request.items.map((item) => ({ item, record: item[key] })).filter(({ record }) => record).sort((a, b) => (b.record.atEpoch ?? 0) - (a.record.atEpoch ?? 0));
    const lifecycleRecords = request.items.flatMap((item) => [
      ...typeof item.requestStatus === "string" && item.requestStatus.trim() ? [{ status: item.requestStatus.trim(), explicit: true, field: "request_status", sourceId: item.id, url: item.url, atEpoch: item.requestStatusSource?.atEpoch ?? item.lastUpdateEpoch ?? null, sourceOrder: item.requestStatusSource?.sourceOrder ?? null, sourceRef: item.requestStatusSource?.sourceRef ?? null }] : [],
      ...typeof item.requestComplete === "boolean" ? [{ status: item.requestComplete ? "done" : "open", complete: item.requestComplete, explicit: true, field: "request_complete", sourceId: item.id, url: item.url, atEpoch: item.requestCompleteSource?.atEpoch ?? item.lastUpdateEpoch ?? null, sourceOrder: item.requestCompleteSource?.sourceOrder ?? null, sourceRef: item.requestCompleteSource?.sourceRef ?? null }] : []
    ]).sort((a, b) => (b.atEpoch ?? 0) - (a.atEpoch ?? 0) || compareSourceOrder(b.sourceOrder, a.sourceOrder) || Number(b.field === "request_complete") - Number(a.field === "request_complete"));
    request.lifecycle = lifecycleRecords[0] ?? null;
    request.startedAtEpoch = request.original.atEpoch ?? null;
    request.progress = request.groupId ? ledger?.progress?.[request.groupId] ?? null : null;
    request.completedAtEpoch = request.lifecycle && (request.lifecycle.complete === true || ["done", "completed", "complete", "shipped", "delivered"].includes(request.lifecycle.status.toLowerCase())) ? request.lifecycle.atEpoch : null;
    request.requestedBy = metadata("requestedBySource")[0]?.item.requestedBy ?? null;
    request.requestedBySource = metadata("requestedBySource")[0]?.record ?? null;
    request.shipEstimate = metadata("shipEstimateSource")[0]?.item.shipEstimate ?? null;
    request.shipEstimateSource = metadata("shipEstimateSource")[0]?.record ?? null;
    request.stageSourceText = metadata("stageSource")[0]?.item.stageSourceText ?? null;
    request.stageSource = metadata("stageSource")[0]?.record ?? null;
    const collect = (section, valueKey) => {
      const unique = /* @__PURE__ */ new Map();
      for (const item of request.items) for (const value of item.afterShip?.[section] ?? []) {
        const key = JSON.stringify([value.kind ?? section, value[valueKey]]);
        if (!unique.has(key)) unique.set(key, { ...value, sourceRefs: [] });
        const target = unique.get(key);
        for (const ref of value.sourceRefs ?? []) if (!target.sourceRefs.some((other) => other.kind === ref.kind && other.id === ref.id)) target.sourceRefs.push(ref);
      }
      return [...unique.values()];
    };
    const resources = collect("resources", "url"), classifications = collect("classifications", "text"), notes = collect("notes", "text");
    request.afterShip = resources.length || classifications.length || notes.length ? { resources, classifications, notes } : null;
    const cached = titleCache instanceof Map ? titleCache.get(request.id) : titleCache[request.id];
    const cachedTitle = typeof cached === "string" ? cached.trim() : cached && cached.source === request.original.source && cached.sourceId != null && String(cached.sourceId) === String(request.original.sourceId) && typeof cached.title === "string" ? cached.title.trim() : "";
    const groupTitle = request.groupId ? ledger?.groups?.groups?.[request.groupId]?.title?.trim() ?? "" : "";
    request.title = cachedTitle || groupTitle || humanRequestTitle(request.explicitRequestText ?? request.original);
    request.titleSource = cachedTitle ? "title-cache" : groupTitle ? "request-group" : request.explicitRequestText ? "explicit-work-state-request" : "original-human-request";
    request.items.sort((a, b) => (b.lastUpdateEpoch ?? 0) - (a.lastUpdateEpoch ?? 0));
  }
  return { humanRequests: [...requests.values()].sort((a, b) => b.updatedAtEpoch - a.updatedAtEpoch), unlinkedWork };
}
var REQUEST_MEDIA_PREVIEW_LIMIT, ENGLISH_ACTION, IMPERATIVE_OPENING, NOT_A_VERB, ENGLISH_WORDS, isConversationKey, FOCUS_ASK_CHARS;
var init_request_projection = __esm({
  "src/services/work-view/request-projection.mjs"() {
    "use strict";
    init_CanonicalContent();
    init_work_product();
    init_session_project();
    REQUEST_MEDIA_PREVIEW_LIMIT = 4;
    ENGLISH_ACTION = /\b(?:make|build|create|implement|design|fix|investigate|audit|review|write|rewrite|show|see|find|search|explain|compare|help|convert|add|remove|update|rename|run|test|verify|deploy|analyze|analyse|read|tell|open|generate|ship|merge|commit|push|release|publish|set up|i want|i need|can you|could you|would you|how (?:can|do|does|is)|what (?:is|are|does|did)|why (?:is|are|does|did)|do we|do you|(?:is|are|seems?|looks?) (?:broken|failing|wrong)|doesn'?t work|not working)\b/i;
    IMPERATIVE_OPENING = /^(?:please\s+)?([a-z]{3,})\s+(?:the|this|that|these|those|all|every|each|my|our|your|its|it|them|any|some|a|an)\b/i;
    NOT_A_VERB = /^(?:the|and|for|with|from|now|then|just|not|about|after|before|into|onto|over|under|like|also|here|there|when|where|what|which|who|why|how|but|yet|all|any|some|its|our|your|this|that|these|those|they|she|his|her|one|two|three)$/i;
    ENGLISH_WORDS = /\b(?:the|a|an|this|that|it|is|are|to|of|and|for|with|in|on|my|me|you|we|please|just|all|so|now|then|from|be|not)\b/i;
    isConversationKey = (value) => {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) && parsed[0] === "conversation" && parsed.length === 3;
      } catch {
        return false;
      }
    };
    FOCUS_ASK_CHARS = 400;
  }
});

// src/services/work-view/owner-goals.mjs
function isOwnerGoalsList(name) {
  return name === OWNER_GOALS_LIST || String(name ?? "").startsWith(`${OWNER_GOALS_LIST}/`);
}
function goalKindOf(fields) {
  const value = fields?.goal_kind;
  if (GOAL_KINDS.includes(value)) return { kind: value, legacy: false };
  if (Object.hasOwn(LEGACY_GOAL_KINDS, value)) return { kind: LEGACY_GOAL_KINDS[value], legacy: true };
  throw new Error(`Owner-goals item ${JSON.stringify(fields?.task ?? null)} has an unknown goal_kind: ${JSON.stringify(value ?? null)}`);
}
var OWNER_GOALS_LIST, GOAL_KINDS, LEGACY_GOAL_KINDS;
var init_owner_goals = __esm({
  "src/services/work-view/owner-goals.mjs"() {
    "use strict";
    OWNER_GOALS_LIST = "owner-goals";
    GOAL_KINDS = ["focus-area", "ask"];
    LEGACY_GOAL_KINDS = { priority: "focus-area", "open-ask": "ask" };
  }
});

// src/services/work-view/work-state-limits.mjs
var MAX_WORK_STATE_FIELDS_JSON_CHARS;
var init_work_state_limits = __esm({
  "src/services/work-view/work-state-limits.mjs"() {
    "use strict";
    MAX_WORK_STATE_FIELDS_JSON_CHARS = 2e3;
  }
});

// src/services/work-view/shared-records.mjs
function sharedWriter(value) {
  text2(value, 128, "writer");
  if (Buffer.byteLength(value, "utf8") > 128) fail("writer exceeds canonical byte limit");
  return value;
}
function sharedIdentity(kind, key) {
  if (typeof kind !== "string" || !/^[a-z][a-z0-9_-]{0,47}$/.test(kind)) fail("invalid kind");
  text2(key, 1024, "key");
  return sharedRecordKey(kind, key);
}
function createSharedEntry({ batchId, writer, kind, key, revision, base = null, value, deleted = false }) {
  sharedWriter(writer);
  text2(batchId, 100, "batch");
  sharedIdentity(kind, key);
  assertCanonicalDecimal(revision, { positive: true });
  if (base !== null) hash(base);
  if (typeof deleted !== "boolean") fail("invalid deletion flag");
  const payload = canonicalJson(deleted ? null : value);
  if (bytes(payload) > SHARED_WORK_MAX_VALUE_BYTES) fail("value exceeds byte limit");
  return {
    version: 1,
    record: "entry",
    batch: batchId,
    writer,
    kind,
    key,
    revision,
    base,
    deleted,
    payload,
    hash: sharedValueHash(kind, key, deleted ? null : value, deleted)
  };
}
function createSharedBatch(entries, { batchId, writer }) {
  sharedWriter(writer);
  text2(batchId, 100, "batch");
  if (!Array.isArray(entries) || !entries.length || entries.length > SHARED_WORK_MAX_UPDATES) fail("invalid batch size");
  const identities = /* @__PURE__ */ new Set();
  const groups = [[]];
  for (const entry of entries) {
    if (entry.batch !== batchId || entry.writer !== writer) fail("entry belongs to another batch");
    const identity = sharedIdentity(entry.kind, entry.key);
    if (identities.has(identity)) fail("duplicate logical object in batch");
    identities.add(identity);
    const ref = sharedEntryRef(entry);
    let group = groups.at(-1);
    if (bytes(canonicalJson([...group, ref])) > SHARED_WORK_MAX_MANIFEST_BYTES) {
      group = [];
      groups.push(group);
    }
    group.push(ref);
    if (bytes(canonicalJson(group)) > SHARED_WORK_MAX_MANIFEST_BYTES) fail("manifest reference exceeds byte limit");
  }
  if (groups.length > SHARED_WORK_MAX_PARTS) fail("too many manifest parts");
  const manifests = groups.map((refs, part) => {
    const payload2 = canonicalJson(refs);
    return { version: 1, record: "manifest", batch: batchId, writer, part, payload: payload2, hash: sha256Base64Url(payload2) };
  });
  const payload = canonicalJson(manifests.map((part) => part.hash));
  const commit = { version: 1, record: "commit", batch: batchId, writer, count: entries.length, payload, hash: sha256Base64Url(payload) };
  return [
    ...entries.map((fields) => ({ listName: `${SHARED_WORK_PREFIX}entry`, fields })),
    ...manifests.map((fields) => ({ listName: `${SHARED_WORK_PREFIX}manifest`, fields })),
    { listName: `${SHARED_WORK_PREFIX}commit`, fields: commit }
  ];
}
function parseSharedRow(row, localDeviceId, { redactionReceipt = null } = {}) {
  if (!isSharedWorkList(row.list_name)) return null;
  if (!row.list_name.startsWith(SHARED_WORK_PREFIX)) return { unsupported: true };
  if (typeof row.fields === "string" && bytes(row.fields) > SHARED_WORK_MAX_ROW_BYTES) fail("row exceeds byte limit");
  const fields = typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields;
  if (!fields || fields.version !== 1) return { unsupported: true };
  const writer = row.origin_device_id ?? localDeviceId;
  sharedWriter(writer);
  if (fields.writer !== writer) fail("writer does not match origin");
  text2(fields.batch, 100, "batch");
  hash(fields.hash);
  if (row.list_name !== `${SHARED_WORK_PREFIX}${fields.record}`) fail("record/list mismatch");
  if (fields.record === "entry") {
    exact(fields, ["version", "record", "batch", "writer", "kind", "key", "revision", "base", "deleted", "payload", "hash"]);
    sharedIdentity(fields.kind, fields.key);
    assertCanonicalDecimal(fields.revision, { positive: true });
    if (fields.base !== null) hash(fields.base);
    if (typeof fields.deleted !== "boolean" || typeof fields.payload !== "string" || bytes(fields.payload) > SHARED_WORK_MAX_VALUE_BYTES) fail("invalid entry payload");
    const value = JSON.parse(fields.payload);
    if (canonicalJson(value) !== fields.payload || fields.deleted && value !== null) fail("entry hash mismatch");
    const result = { ...fields, value };
    if (sharedValueHash(fields.kind, fields.key, value, fields.deleted) !== fields.hash) {
      const receipt = redactionReceipt;
      if (!receipt || String(row.id) !== String(receipt.row_id) || row.origin_device_id !== receipt.origin_device_id || String(row.origin_local_id) !== receipt.origin_local_id || String(row.sync_rev) !== receipt.sync_rev || sha256Base64Url(canonicalJson(fields)) !== receipt.stored_fields_hash) fail("entry hash mismatch");
      const ref = JSON.parse(receipt.original_ref_json);
      exact(ref, ["kind", "key", "revision", "hash", "entryHash"]);
      hash(ref.hash);
      hash(ref.entryHash);
      if (ref.kind !== fields.kind || ref.key !== fields.key || ref.revision !== fields.revision || ref.hash !== fields.hash) fail("redaction receipt does not match entry");
      Object.defineProperty(result, verifiedRedactionReference, { value: ref });
    }
    return result;
  }
  if (fields.record === "manifest") {
    exact(fields, ["version", "record", "batch", "writer", "part", "payload", "hash"]);
    if (!Number.isInteger(fields.part) || fields.part < 0 || fields.part >= SHARED_WORK_MAX_PARTS || typeof fields.payload !== "string" || bytes(fields.payload) > SHARED_WORK_MAX_MANIFEST_BYTES) fail("invalid manifest");
    const refs = JSON.parse(fields.payload);
    if (!Array.isArray(refs) || !refs.length || refs.length > SHARED_WORK_MAX_UPDATES || canonicalJson(refs) !== fields.payload) fail("invalid references");
    for (const ref of refs) {
      exact(ref, ["kind", "key", "revision", "hash", "entryHash"]);
      sharedIdentity(ref.kind, ref.key);
      assertCanonicalDecimal(ref.revision, { positive: true });
      hash(ref.hash);
      hash(ref.entryHash);
    }
    if (sha256Base64Url(fields.payload) !== fields.hash) fail("manifest hash mismatch");
    return { ...fields, refs };
  }
  if (fields.record === "commit") {
    exact(fields, ["version", "record", "batch", "writer", "count", "payload", "hash"]);
    if (!Number.isInteger(fields.count) || fields.count < 1 || fields.count > SHARED_WORK_MAX_UPDATES || typeof fields.payload !== "string" || bytes(fields.payload) > SHARED_WORK_MAX_MANIFEST_BYTES) fail("invalid commit");
    const parts = JSON.parse(fields.payload);
    if (!Array.isArray(parts) || !parts.length || parts.length > SHARED_WORK_MAX_PARTS || canonicalJson(parts) !== fields.payload) fail("invalid commit parts");
    parts.forEach(hash);
    if (sha256Base64Url(fields.payload) !== fields.hash) fail("commit hash mismatch");
    return { ...fields, parts };
  }
  fail("unknown record type");
}
var SHARED_WORK_PREFIX, SHARED_WORK_MAX_VALUE_BYTES, SHARED_WORK_MAX_MANIFEST_BYTES, SHARED_WORK_MAX_ROW_BYTES, SHARED_WORK_MAX_UPDATES, SHARED_WORK_MAX_PARTS, isSharedWorkList, sharedRecordKey, sharedValueHash, fail, text2, hash, bytes, verifiedRedactionReference, exact, sharedEntryRef;
var init_shared_records = __esm({
  "src/services/work-view/shared-records.mjs"() {
    "use strict";
    init_CanonicalContent();
    SHARED_WORK_PREFIX = "__my_work_v1:";
    SHARED_WORK_MAX_VALUE_BYTES = 48e3;
    SHARED_WORK_MAX_MANIFEST_BYTES = 48e3;
    SHARED_WORK_MAX_ROW_BYTES = 128e3;
    SHARED_WORK_MAX_UPDATES = 512;
    SHARED_WORK_MAX_PARTS = 32;
    isSharedWorkList = (value) => typeof value === "string" && /^__my_work_v\d+:/.test(value);
    sharedRecordKey = (kind, key) => canonicalJson([kind, key]);
    sharedValueHash = (kind, key, value, deleted = false) => sha256Base64Url(canonicalJson({ kind, key, value: deleted ? null : value, deleted }));
    fail = (message) => {
      throw new TypeError(`Shared My Work: ${message}`);
    };
    text2 = (value, max, name) => {
      if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) fail(`invalid ${name}`);
      return value;
    };
    hash = (value) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) fail("invalid hash");
      return value;
    };
    bytes = (value) => Buffer.byteLength(value, "utf8");
    verifiedRedactionReference = /* @__PURE__ */ Symbol("verified-redaction-reference");
    exact = (value, keys) => {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail("invalid fields");
    };
    sharedEntryRef = (entry) => {
      if (entry[verifiedRedactionReference]) return entry[verifiedRedactionReference];
      const fields = Object.fromEntries(["version", "record", "batch", "writer", "kind", "key", "revision", "base", "deleted", "payload", "hash"].map((key) => [key, entry[key]]));
      return {
        kind: entry.kind,
        key: entry.key,
        revision: entry.revision,
        hash: entry.hash,
        entryHash: sha256Base64Url(canonicalJson(fields))
      };
    };
  }
});

// src/services/work-view/work-state-status.mjs
var CLOSED_STATUSES, isClosedWorkStateStatus;
var init_work_state_status = __esm({
  "src/services/work-view/work-state-status.mjs"() {
    "use strict";
    CLOSED_STATUSES = /* @__PURE__ */ new Set(["done", "dropped"]);
    isClosedWorkStateStatus = (status) => status != null && CLOSED_STATUSES.has(String(status).toLowerCase());
  }
});

// src/services/work-view/work-state-reduce.mjs
function reduceWorkState(entries, { currentProject, currentProjectScope = [], eventLimit = Infinity, localDeviceId = "" } = {}) {
  entries = entries.filter((entry) => !isSharedWorkList(entry.list_name));
  const scope = new Set(currentProjectScope.map(normalizedKey));
  const listsById = /* @__PURE__ */ new Map();
  const events = [];
  let revision = 0;
  const device = (row) => row.origin_device_id ?? localDeviceId;
  for (const row of [...entries].sort((a, b) => {
    const timeAndDevice = a.created_at_epoch - b.created_at_epoch || (device(a) < device(b) ? -1 : device(a) > device(b) ? 1 : 0);
    if (timeAndDevice) return timeAndDevice;
    const left = BigInt(a.origin_local_id ?? a.id), right = BigInt(b.origin_local_id ?? b.id);
    return left < right ? -1 : left > right ? 1 : 0;
  })) {
    revision = Math.max(revision, row.id);
    const fields = typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("Invalid work-state entry");
    const id = listId(row.scope_project ?? row.project, row.list_name);
    let list2 = listsById.get(id);
    if (!list2) {
      list2 = { id, project: row.scope_project ?? row.project, name: row.list_name, fields: {}, tasksByName: /* @__PURE__ */ new Map(), updatedAtEpoch: 0, stateUpdatedAtEpoch: null, latestEntryId: 0 };
      listsById.set(id, list2);
    }
    const taskName = fields.task == null || fields.task === "" ? null : String(fields.task);
    let target = list2;
    if (taskName !== null) {
      target = list2.tasksByName.get(taskName);
      if (!target) {
        target = { id: taskId(id, taskName), name: taskName, fields: {}, updatedAtEpoch: 0, latestEntryId: 0 };
        list2.tasksByName.set(taskName, target);
      }
    } else {
      list2.stateUpdatedAtEpoch = row.created_at_epoch;
    }
    const changes = [];
    for (const [key, value] of Object.entries(fields)) {
      const hadPrevious = Object.hasOwn(target.fields, key);
      const previous = target.fields[key];
      if (key !== "task" && (value === null && hadPrevious || value !== null && (!hadPrevious || previous !== value))) {
        changes.push({ field: key, ...hadPrevious ? { previous } : {}, value, hadPrevious });
      }
      if (value === null) delete target.fields[key];
      else target.fields[key] = value;
    }
    target.updatedAtEpoch = row.created_at_epoch;
    target.latestEntryId = row.id;
    list2.updatedAtEpoch = row.created_at_epoch;
    list2.latestEntryId = row.id;
    events.push({
      id: row.id,
      project: list2.project,
      originProject: row.project,
      listName: row.list_name,
      listId: id,
      task: taskName,
      taskId: taskName === null ? null : target.id,
      type: taskName === null ? "state" : "task",
      fields,
      changes,
      status: taskName === null ? target.fields.status == null ? "open" : String(target.fields.status).toLowerCase() : effectiveStatus(target.fields.status),
      at: iso(row.created_at_epoch),
      atEpoch: row.created_at_epoch,
      sourceOrder: [row.created_at_epoch, device(row), String(row.origin_local_id ?? row.id)],
      inCurrentScope: scope.has(normalizedKey(row.project))
    });
  }
  const lists = [...listsById.values()].sort((a, b) => b.updatedAtEpoch - a.updatedAtEpoch || b.latestEntryId - a.latestEntryId).map((list2) => {
    const tasks2 = [...list2.tasksByName.values()].map((task) => ({
      ...task,
      status: effectiveStatus(task.fields.status),
      isOpen: !isClosedWorkStateStatus(task.fields.status),
      updatedAt: iso(task.updatedAtEpoch)
    }));
    const stateIsOpen = Object.keys(list2.fields).some((key) => key !== "task") && !isClosedWorkStateStatus(list2.fields.status);
    const { tasksByName, ...record } = list2;
    return {
      ...record,
      status: isClosedWorkStateStatus(list2.fields.status) ? String(list2.fields.status).toLowerCase() : "open",
      isOpen: stateIsOpen || tasks2.some((task) => task.isOpen),
      inCurrentScope: scope.has(normalizedKey(list2.project)),
      updatedAt: iso(list2.updatedAtEpoch),
      stateUpdatedAt: iso(list2.stateUpdatedAtEpoch),
      tasks: tasks2
    };
  });
  const projectsById = /* @__PURE__ */ new Map();
  for (const list2 of lists) {
    const key = normalizedKey(list2.project);
    const project = projectsById.get(key) ?? { id: list2.project, name: list2.project, lists: 0, openLists: 0, tasks: 0, doing: 0, inCurrentScope: list2.inCurrentScope, lastUpdatedAt: list2.updatedAt };
    project.lists++;
    project.openLists += Number(list2.isOpen);
    project.tasks += list2.tasks.length;
    project.doing += list2.tasks.filter((task) => task.isOpen && task.status === "doing").length;
    projectsById.set(key, project);
  }
  const projects = [...projectsById.values()];
  const tasks = lists.flatMap((list2) => list2.tasks);
  const summary = {
    projects: projects.length,
    lists: lists.length,
    openLists: lists.filter((list2) => list2.isOpen).length,
    tasks: tasks.length,
    openTasks: tasks.filter((task) => task.isOpen).length,
    todo: tasks.filter((task) => task.status === "todo").length,
    doing: tasks.filter((task) => task.status === "doing").length,
    done: tasks.filter((task) => task.status === "done").length,
    dropped: tasks.filter((task) => task.status === "dropped").length,
    unknown: tasks.filter((task) => task.status === "unknown").length
  };
  return {
    schemaVersion: 1,
    revision,
    entryCount: entries.length,
    currentProject,
    currentProjectScope,
    summary,
    projects,
    lists,
    events: events.slice(-eventLimit).reverse(),
    lastUpdatedAt: events.length ? events.at(-1).at : null
  };
}
var normalizedKey, iso, effectiveStatus, listId, taskId;
var init_work_state_reduce = __esm({
  "src/services/work-view/work-state-reduce.mjs"() {
    "use strict";
    init_shared_records();
    init_work_state_status();
    normalizedKey = (value) => String(value).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
    iso = (epoch2) => epoch2 == null ? null : new Date(epoch2).toISOString();
    effectiveStatus = (status) => status == null || status === "" ? "unknown" : String(status).toLowerCase();
    listId = (project, name) => JSON.stringify([normalizedKey(project), name]);
    taskId = (parentId, name) => JSON.stringify([parentId, name]);
  }
});

// src/services/work-view/nav-words.mjs
function navWordIn(name) {
  const words = ` ${String(name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" ")} `;
  return NAV_LABELS.find((label) => words.includes(` ${label} `)) ?? null;
}
var NAV_LABELS;
var init_nav_words = __esm({
  "src/services/work-view/nav-words.mjs"() {
    "use strict";
    NAV_LABELS = Object.freeze(["my focus", "my work", "my rules", "other", "suggested", "past focus", "monitor", "steer"]);
  }
});

// src/services/work-view/focus-done-date.mjs
function doneAtAfterChange({ statusBefore, doneAtBefore, statusAfter, changedAt }) {
  if (statusAfter !== "done") return null;
  return statusBefore === "done" ? doneAtBefore : changedAt;
}
var init_focus_done_date = __esm({
  "src/services/work-view/focus-done-date.mjs"() {
    "use strict";
  }
});

// src/services/work-view/my-focus.mjs
function fitsOneWrite(fields, what) {
  if (JSON.stringify(fields).length > MAX_WORK_STATE_FIELDS_JSON_CHARS) throw new RangeError(`This ${what} is too long to save. Shorten it.`);
  return fields;
}
function focusAreaRowFields(area) {
  const focusAreaId = text3(area.focusAreaId);
  if (!focusAreaId || focusAreaId === OTHER_FOCUS_AREA_ID) throw new Error(`A focus area needs an id other than "${OTHER_FOCUS_AREA_ID}".`);
  if (!text3(area.name)) throw new Error("A focus area needs a name.");
  if (!FOCUS_AREA_STATUSES.includes(area.status)) throw new Error(`Unknown focus area status: ${area.status}`);
  if (!FOCUS_AREA_SOURCES.includes(area.source)) throw new Error(`Unknown focus area source: ${area.source}`);
  if (!FOCUS_AREA_DECIDED_BY.includes(area.decidedBy)) throw new Error(`Unknown focus area writer: ${area.decidedBy}`);
  return fitsOneWrite({
    task: focusAreaTaskName(focusAreaId),
    focus_area_id: focusAreaId,
    name: text3(area.name),
    goal: text3(area.goal) || null,
    about: text3(area.about) || null,
    status: area.status,
    priority_rank: rank(area.priorityRank),
    owner_rank: rank(area.ownerRank),
    source: area.source,
    merged_into: text3(area.mergedInto) || null,
    evidence: text3(area.evidence) || null,
    decided_by: area.decidedBy
  }, "focus area");
}
function placementRowFields(placement) {
  const anchor = text3(placement.anchorConversationKey);
  if (!anchor) throw new Error("A placement needs the request's anchor conversation key.");
  if (!text3(placement.focusAreaId)) throw new Error('A placement needs a focus area id or "other".');
  if (!PLACEMENT_PLACED_BY.includes(placement.placedBy)) throw new Error(`Unknown placement writer: ${placement.placedBy}`);
  return fitsOneWrite({
    task: placementTaskName(anchor),
    anchor_conversation_key: anchor,
    focus_area_id: text3(placement.focusAreaId),
    placed_by: placement.placedBy,
    confidence: rank(placement.confidence),
    basis: text3(placement.basis) || null,
    evidence: text3(placement.evidence) || null
  }, "placement");
}
function applyPatch(target, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (key === "task") continue;
    if (value === null) delete target[key];
    else target[key] = value;
  }
}
function buildFocusAreas(state, { localDeviceId = null } = {}) {
  if (typeof state.entryCount === "number" && state.events.length !== state.entryCount) {
    throw new Error("My Focus needs every work-state row; the events were cut.");
  }
  const areas = /* @__PURE__ */ new Map(), placements = /* @__PURE__ */ new Map();
  let otherPassHash = null;
  for (const event of [...state.events].reverse()) {
    if (!isMyFocusList(event.listName)) continue;
    if (event.task === null) {
      if (localDeviceId !== null && event.sourceOrder?.[1] === localDeviceId && Object.hasOwn(event.fields, "other_pass_hash")) otherPassHash = text3(event.fields.other_pass_hash) || null;
      continue;
    }
    if (event.task.startsWith(FOCUS_AREA_TASK_PREFIX)) {
      const focusAreaId = text3(event.fields.focus_area_id) || event.task.slice(FOCUS_AREA_TASK_PREFIX.length);
      if (focusAreaId === OTHER_FOCUS_AREA_ID) throw new Error(`A my-focus area row uses the reserved id "${OTHER_FOCUS_AREA_ID}".`);
      const decidedBy = event.fields.decided_by;
      if (!FOCUS_AREA_DECIDED_BY.includes(decidedBy)) throw new Error(`Focus area ${focusAreaId} has an unknown writer: ${decidedBy}`);
      const area = areas.get(focusAreaId) ?? { fields: {}, ownerDecided: false, savedAt: null, doneAt: null };
      if (area.ownerDecided && decidedBy === "system") continue;
      const statusBefore = area.fields.status;
      applyPatch(area.fields, event.fields);
      if (decidedBy !== "system") area.ownerDecided = decidedBy === "owner";
      area.savedAt = event.at;
      area.doneAt = doneAtAfterChange({ statusBefore, doneAtBefore: area.doneAt, statusAfter: area.fields.status, changedAt: event.at });
      areas.set(focusAreaId, area);
    } else if (event.task.startsWith(PLACEMENT_TASK_PREFIX)) {
      const anchor = text3(event.fields.anchor_conversation_key) || event.task.slice(PLACEMENT_TASK_PREFIX.length);
      const placedBy = event.fields.placed_by;
      if (!PLACEMENT_PLACED_BY.includes(placedBy)) throw new Error(`A placement has an unknown writer: ${placedBy}`);
      const placement = placements.get(anchor) ?? { owner: null, router: null };
      placement[placedBy] ??= { fields: {}, device: null };
      applyPatch(placement[placedBy].fields, event.fields);
      placement[placedBy].device = event.sourceOrder?.[1] ?? null;
      placements.set(anchor, placement);
    }
  }
  const focusAreas = [...areas].map(([focusAreaId, { fields, savedAt, doneAt }]) => {
    if (!text3(fields.name)) throw new Error(`Focus area ${focusAreaId} has no name.`);
    if (!FOCUS_AREA_STATUSES.includes(fields.status)) throw new Error(`Focus area ${focusAreaId} has an unknown status: ${fields.status}`);
    if (!FOCUS_AREA_SOURCES.includes(fields.source)) throw new Error(`Focus area ${focusAreaId} has an unknown source: ${fields.source}`);
    return {
      focusAreaId,
      name: text3(fields.name),
      goal: text3(fields.goal) || null,
      about: text3(fields.about) || null,
      status: fields.status,
      priorityRank: rank(fields.priority_rank),
      ownerRank: rank(fields.owner_rank),
      source: fields.source,
      mergedInto: text3(fields.merged_into) || null,
      evidence: text3(fields.evidence) || null,
      decidedBy: fields.decided_by,
      savedAt,
      doneAt
    };
  }).sort((a, b) => (a.ownerRank ?? Infinity) - (b.ownerRank ?? Infinity) || (a.priorityRank ?? Infinity) - (b.priorityRank ?? Infinity) || a.name.localeCompare(b.name));
  const byId = new Map(focusAreas.map((area) => [area.focusAreaId, area]));
  const resolve4 = (focusAreaId) => {
    if (focusAreaId === OTHER_FOCUS_AREA_ID) return OTHER_FOCUS_AREA_ID;
    const seen = /* @__PURE__ */ new Set();
    let area = byId.get(focusAreaId);
    while (area?.mergedInto && byId.has(area.mergedInto) && !seen.has(area.mergedInto)) {
      seen.add(area.focusAreaId);
      area = byId.get(area.mergedInto);
    }
    return area && !area.mergedInto && area.status !== "dismissed" ? area.focusAreaId : null;
  };
  const focusAreaIdByAnchor = /* @__PURE__ */ new Map();
  const placementsByAnchor = /* @__PURE__ */ new Map();
  const side = (written) => written && { focusAreaId: text3(written.fields.focus_area_id), basis: text3(written.fields.basis) || null, evidence: text3(written.fields.evidence) || null, device: written.device };
  for (const [anchor, { owner, router }] of placements) {
    const focusAreaId = owner && resolve4(text3(owner.fields.focus_area_id)) || router && resolve4(text3(router.fields.focus_area_id));
    if (focusAreaId) focusAreaIdByAnchor.set(anchor, focusAreaId);
    placementsByAnchor.set(anchor, { owner: side(owner), router: side(router) });
  }
  return { focusAreas, focusAreaIdByAnchor, placementsByAnchor, resolveFocusAreaId: resolve4, otherPassHash };
}
function anchorConversationKeyFor(request, ledger) {
  const anchor = (request.groupId ? ledger?.groups?.groups?.[request.groupId]?.anchor : null) || request.conversationKey;
  return typeof anchor === "string" && anchor ? anchor : null;
}
function placeRequests(humanRequests, focusAreaIdByAnchor, ledger) {
  return humanRequests.map((request) => {
    const anchorConversationKey = anchorConversationKeyFor(request, ledger);
    const focusAreaId = anchorConversationKey ? focusAreaIdByAnchor.get(anchorConversationKey) : void 0;
    return { ...request, anchorConversationKey, ...focusAreaId ? { focusAreaId } : {} };
  });
}
var MY_FOCUS_LIST, OTHER_FOCUS_AREA_ID, FOCUS_AREA_TASK_PREFIX, PLACEMENT_TASK_PREFIX, FOCUS_AREA_STATUSES, FOCUS_AREA_SOURCES, PROPOSAL_SOURCES, PROPOSAL_KINDS, FOCUS_AREA_DECIDED_BY, PLACEMENT_PLACED_BY, isMyFocusList, focusAreaTaskName, placementTaskName, text3, rank;
var init_my_focus = __esm({
  "src/services/work-view/my-focus.mjs"() {
    "use strict";
    init_work_state_limits();
    init_work_state_reduce();
    init_nav_words();
    init_focus_done_date();
    MY_FOCUS_LIST = "my-focus";
    OTHER_FOCUS_AREA_ID = "other";
    FOCUS_AREA_TASK_PREFIX = "Focus area: ";
    PLACEMENT_TASK_PREFIX = "Placement: ";
    FOCUS_AREA_STATUSES = ["suggested", "kept", "dismissed", "done"];
    FOCUS_AREA_SOURCES = ["owner-goals", "clustering", "promotion", "seed", "owner"];
    PROPOSAL_SOURCES = Object.freeze({ new: "clustering", promote: "promotion" });
    PROPOSAL_KINDS = Object.freeze(Object.keys(PROPOSAL_SOURCES));
    FOCUS_AREA_DECIDED_BY = ["owner", "system", "owner-restore"];
    PLACEMENT_PLACED_BY = ["router", "owner"];
    isMyFocusList = (name) => name === MY_FOCUS_LIST;
    focusAreaTaskName = (focusAreaId) => `${FOCUS_AREA_TASK_PREFIX}${focusAreaId}`;
    placementTaskName = (anchorConversationKey) => `${PLACEMENT_TASK_PREFIX}${anchorConversationKey}`;
    text3 = (value) => typeof value === "string" ? value.trim() : "";
    rank = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  }
});

// src/shared/gemini-error-details.ts
var init_gemini_error_details = __esm({
  "src/shared/gemini-error-details.ts"() {
    "use strict";
  }
});

// src/shared/api-key-pool.ts
var KEY_COOLDOWN_MS, RATE_LIMIT_COOLDOWN_MAX_MS, ROTATE_KINDS, KEY_ROTATE_KINDS;
var init_api_key_pool = __esm({
  "src/shared/api-key-pool.ts"() {
    "use strict";
    init_paths();
    init_logger();
    init_gemini_error_details();
    KEY_COOLDOWN_MS = {
      rate_limit: 6e4,
      quota_exhausted: 30 * 6e4,
      auth_invalid: 6 * 60 * 6e4
    };
    RATE_LIMIT_COOLDOWN_MAX_MS = 15 * 6e4;
    ROTATE_KINDS = /* @__PURE__ */ new Set(["rate_limit", "quota_exhausted", "auth_invalid"]);
    KEY_ROTATE_KINDS = [...ROTATE_KINDS];
  }
});

// src/supervisor/env-sanitizer.ts
var ENV_PROXY_VARS, ENV_PRESERVE;
var init_env_sanitizer = __esm({
  "src/supervisor/env-sanitizer.ts"() {
    "use strict";
    ENV_PROXY_VARS = /* @__PURE__ */ new Set([
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
      "no_proxy",
      "npm_config_proxy",
      "npm_config_https_proxy",
      "npm_config_noproxy",
      // Node's fetch ignores HTTP(S)_PROXY until this is set (NODE_USE_ENV_PROXY=1).
      // Claude Code applies it from user settings; the observer child does not
      // load those settings, so the flag has to travel with the other proxy vars
      // (#5400). The lowercase spelling matches the http_proxy family.
      "NODE_USE_ENV_PROXY",
      "node_use_env_proxy"
    ]);
    ENV_PRESERVE = /* @__PURE__ */ new Set([
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_GIT_BASH_PATH",
      // The CLI documents CLAUDE_CODE_TMPDIR as the fix for a root-owned per-uid
      // /tmp/claude-<uid> directory (#4161). Stripping it here sent the SDK child
      // back to /tmp, so the child hit that directory and exited 1 on every spawn
      // — the user's only documented escape did nothing.
      "CLAUDE_CODE_TMPDIR",
      // Documented Claude Code gateway compatibility switch. The Observer must
      // inherit an explicit beta opt-out because settingSources: [] prevents the
      // SDK child from recovering it from user settings. Keep this as a single
      // named exception: arbitrary CLAUDE_CODE_* host settings remain stripped.
      "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
      // One of Claude Code's documented "no background updates" switches (the
      // other two, DISABLE_AUTOUPDATER and DISABLE_UPDATES, have no CLAUDE_CODE_
      // prefix and pass already). The worker's auto-update check reads it from its
      // own env to stay off (src/services/auto-update/auto-update-check.ts), and
      // every worker spawn passes through sanitizeEnv, so stripping it left the
      // updater running for a user who set it. The Observer's SDK child inherits
      // it too, which keeps the user's choice there as well. Keep this as a single
      // named exception: arbitrary CLAUDE_CODE_* host settings remain stripped.
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
      // claude-mem's own setting, not a CLI knob (the CLI never reads it): the
      // path to the claude binary, documented as settable from the file OR the
      // env. Every daemon spawn passes through sanitizeEnv, and the worker reads
      // the env override (SettingsDefaultsManager.applyEnvOverrides), so
      // stripping it silently dropped the env form.
      "CLAUDE_CODE_PATH",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY",
      "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
      "CLAUDE_CODE_SKIP_VERTEX_AUTH",
      "CLAUDE_CODE_SKIP_FOUNDRY_AUTH",
      "ANTHROPIC_BEDROCK_BASE_URL",
      "AWS_REGION",
      "AWS_PROFILE",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "ANTHROPIC_VERTEX_PROJECT_ID",
      "CLOUD_ML_REGION",
      "GOOGLE_APPLICATION_CREDENTIALS",
      ...ENV_PROXY_VARS
    ]);
  }
});

// src/shared/oauth-token.ts
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync;
var init_oauth_token = __esm({
  "src/shared/oauth-token.ts"() {
    "use strict";
    init_paths();
    init_SettingsDefaultsManager();
    init_logger();
    execFileAsync = promisify(execFile);
  }
});

// src/shared/EnvManager.ts
var init_EnvManager = __esm({
  "src/shared/EnvManager.ts"() {
    "use strict";
    init_env_sanitizer();
    init_logger();
    init_paths();
    init_atomic_json();
    init_SettingsDefaultsManager();
    init_oauth_token();
  }
});

// src/shared/pro-promo.ts
var PRO_TRIAL_MAX_DAYS, PRO_TRIAL_LABEL, PLAN_USAGE_GAIN_PERCENT, PRO_TRIAL_PITCH;
var init_pro_promo = __esm({
  "src/shared/pro-promo.ts"() {
    "use strict";
    PRO_TRIAL_MAX_DAYS = 30;
    PRO_TRIAL_LABEL = `${PRO_TRIAL_MAX_DAYS} Day Free Trial`;
    PLAN_USAGE_GAIN_PERCENT = 100;
    PRO_TRIAL_PITCH = `${PRO_TRIAL_LABEL} — memory runs off-plan. Get up to ${PLAN_USAGE_GAIN_PERCENT}% more usage from your plan`;
  }
});

// src/shared/relayed-text.ts
var init_relayed_text = __esm({
  "src/shared/relayed-text.ts"() {
    "use strict";
  }
});

// src/shared/cmem-gateway.ts
var init_cmem_gateway = __esm({
  "src/shared/cmem-gateway.ts"() {
    "use strict";
    init_paths();
    init_SettingsDefaultsManager();
    init_settings_document();
    init_hook_io();
    init_pro_promo();
    init_relayed_text();
  }
});

// src/services/work-view/shared-file-hooks.mjs
var init_shared_file_hooks = __esm({
  "src/services/work-view/shared-file-hooks.mjs"() {
    "use strict";
  }
});

// src/services/work-view/request-groups.mjs
import { createHash as createHash6 } from "node:crypto";
import { homedir as homedir7 } from "node:os";
import { join as join9 } from "node:path";
function applyGroupDecisions(stored, decisions, now = Date.now(), { projectOf = /* @__PURE__ */ new Map(), getProjectRoot = projectRoot } = {}) {
  if (!Array.isArray(decisions?.groups)) throw new TypeError("Decisions need a groups array.");
  const next = structuredClone(stored ?? emptyGroups());
  for (const [index, decision] of decisions.groups.entries()) {
    const label = `groups[${index}]`;
    if (typeof decision.title !== "string" || !decision.title.trim() || decision.title.length > 120) throw new TypeError(`${label}.title must be 1–120 characters.`);
    if (!Array.isArray(decision.conversations) || !decision.conversations.length || !decision.conversations.every(isConversationKey)) throw new TypeError(`${label}.conversations must list conversation keys, earliest first.`);
    const links = decision.links ?? [];
    const members = new Set(decision.conversations);
    const parent = new Map(decision.conversations.map((key) => [key, key]));
    const find = (key) => {
      while (parent.get(key) !== key) key = parent.get(key);
      return key;
    };
    for (const link of links) {
      if (!LINK_KINDS.includes(link.kind)) throw new TypeError(`${label} has unknown link kind ${link.kind}.`);
      if (typeof link.evidence !== "string" || !link.evidence.trim()) throw new TypeError(`${label} has a link without evidence.`);
      if (!Array.isArray(link.conversations) || link.conversations.length < 2 || !link.conversations.every((key) => members.has(key))) throw new TypeError(`${label} has a link that must name 2+ of the group's own conversations.`);
      for (const key of link.conversations.slice(1)) parent.set(find(key), find(link.conversations[0]));
    }
    if (decision.conversations.length > 1 && !links.length) throw new TypeError(`${label} joins conversations without a recorded link.`);
    const unsupported = decision.conversations.filter((key) => find(key) !== find(decision.conversations[0]));
    if (unsupported.length) throw new TypeError(`${label} joins ${unsupported.join(", ")} without evidence linking it to the anchor.`);
    const id = groupIdFor(decision.conversations[0]);
    if (decision.projectRoot != null && (typeof decision.projectRoot !== "string" || !decision.projectRoot.trim())) throw new TypeError(`${label}.projectRoot must be a non-empty string when given.`);
    const explicitRoot = decision.projectRoot ?? (next.groups[id]?.rootNamed ? next.groups[id].projectRoot : null);
    const allMembers = [.../* @__PURE__ */ new Set([...decision.conversations, ...Object.entries(next.conversations).filter(([key, groupId]) => groupId === id && !decision.conversations.includes(key)).map(([key]) => key)])];
    const storedRoot = upgradedGroupRoot(
      next.groups[id]?.projectRoot,
      getProjectRoot(projectOf.get(next.groups[id]?.anchor)),
      allMembers.map((key) => getProjectRoot(projectOf.get(key)))
    );
    const rootWasUnknown = storedRoot === NO_PROJECT;
    const roots = /* @__PURE__ */ new Map();
    for (const key of allMembers) {
      const root = getProjectRoot(projectOf.get(key));
      if (root == null || rootWasUnknown && root === NO_PROJECT && !decision.conversations.includes(key)) continue;
      roots.set(root, [...roots.get(root) ?? [], key]);
    }
    if (typeof storedRoot === "string" && !rootWasUnknown && !roots.has(storedRoot)) roots.set(storedRoot, []);
    if (explicitRoot == null && roots.size > 1) throw new TypeError(`${label} joins conversations from different projects (${[...roots.keys()].map((root) => root || "no project").join(", ")}); a request stays inside one project root.`);
    const projectRootOfGroup = explicitRoot != null ? explicitRoot.trim() : roots.size ? [...roots.keys()][0] : storedRoot ?? null;
    for (const key of decision.conversations) {
      next.conversations[key] = id;
      if (next.ignored) delete next.ignored[key];
    }
    const memberSet = new Set(allMembers);
    const keptLinks = (next.groups[id]?.links ?? []).filter((link) => link.conversations.every((key) => memberSet.has(key)));
    const known = new Set(keptLinks.map((link) => JSON.stringify(link)));
    const mergedLinks = [...keptLinks, ...links.filter((link) => !known.has(JSON.stringify(link)))];
    next.groups[id] = { title: decision.title.trim(), anchor: decision.conversations[0], projectRoot: projectRootOfGroup, ...explicitRoot != null ? { rootNamed: true } : {}, links: mergedLinks, decidedAt: iso2(now), anchorAsk: stored?.groups?.[id]?.anchor === decision.conversations[0] ? stored.groups[id].anchorAsk ?? null : null };
  }
  next.ignored ??= {};
  for (const [index, ignored] of (decisions.ignored ?? []).entries()) {
    if (!isConversationKey(ignored.conversation)) throw new TypeError(`ignored[${index}].conversation must be a conversation key.`);
    next.ignored[ignored.conversation] = boundedText(ignored.reason, 200, `ignored[${index}].reason`);
    delete next.conversations[ignored.conversation];
  }
  const used = new Set(Object.values(next.conversations));
  for (const [id, group] of Object.entries(next.groups)) {
    if (!used.has(id)) delete next.groups[id];
    else group.links = (group.links ?? []).filter((link) => link.conversations.every((key) => next.conversations[key] === id));
  }
  next.updatedAt = iso2(now);
  return next;
}
function boundedText(value, max, label, optional2 = false) {
  if (optional2 && (value == null || value === "")) return "";
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be 1–${max} characters.`);
  if (value.length > max) {
    const target = textTarget(max);
    throw new TypeError(`${label} is ${value.length} characters; it must be 1–${max}. Bring it to about ${target} characters (cut at least ${value.length - target}).`);
  }
  return value.trim();
}
function openSuggestions(ledger) {
  const groups = ledger?.groups;
  if (!groups) return [];
  return Object.entries(groups.suggestions ?? {}).filter(([key, suggestion]) => suggestion?.status === "open" && groups.groups[suggestion.requestId] && groups.conversations[key] !== suggestion.requestId).map(([conversationKey2, suggestion]) => ({
    conversationKey: conversationKey2,
    requestId: suggestion.requestId,
    requestTitle: groups.groups[suggestion.requestId].title,
    confidence: suggestion.confidence,
    evidence: suggestion.evidence,
    judge: suggestion.judge,
    at: suggestion.at ?? null
  }));
}
var DATA_DIR2, LEDGER_DIR, LINK_KINDS, iso2, groupIdFor, emptyGroups, textTarget;
var init_request_groups = __esm({
  "src/services/work-view/request-groups.mjs"() {
    "use strict";
    init_request_projection();
    init_owner_goals();
    init_session_project();
    init_my_focus();
    init_shared_file_hooks();
    init_work_state_status();
    init_atomic_json();
    init_request_projection();
    DATA_DIR2 = process.env.CLAUDE_MEM_DATA_DIR || join9(homedir7(), ".claude-mem");
    LEDGER_DIR = join9(DATA_DIR2, "work-view");
    LINK_KINDS = ["shared-work-list", "shared-request-id", "agent-judgment", "judge"];
    iso2 = (epoch2) => Number.isFinite(epoch2) && epoch2 > 0 ? new Date(epoch2).toISOString() : null;
    groupIdFor = (anchorConversationKey) => `g_${createHash6("sha256").update(anchorConversationKey).digest("hex").slice(0, 12)}`;
    emptyGroups = () => ({ version: 1, updatedAt: null, conversations: {}, groups: {}, ignored: {} });
    textTarget = (max) => Math.floor(max * 0.75 / 10) * 10;
  }
});

// src/services/work-view/request-judge.mjs
var MAX_DECISION_BODY_BYTES;
var init_request_judge = __esm({
  "src/services/work-view/request-judge.mjs"() {
    "use strict";
    init_api_key_pool();
    init_EnvManager();
    init_cmem_gateway();
    init_openrouter_base_url();
    init_paths();
    init_SettingsDefaultsManager();
    init_request_groups();
    MAX_DECISION_BODY_BYTES = 64 * 1024;
  }
});

// src/services/work-view/cloud-renderer-core.mjs
init_CanonicalContent();
import { createHash as createHash11 } from "node:crypto";

// src/services/work-view/agent-view.mjs
init_request_projection();
init_owner_goals();

// src/services/work-view/my-rules.mjs
import { createHash as createHash5 } from "node:crypto";
var MY_RULES_LIST = "my-rules";
var RULE_TASK_PREFIX = "Rule: ";
var RULE_SCOPE_TIERS = ["everywhere", "project", "situation"];
var RULE_SET_BY = ["owner", "approved", "learned"];
var SAVED_RULE_STATUSES = ["on", "off", "replaced", "dismissed", "suggested"];
var MAX_QUOTES = 3;
var MAX_QUOTE_CHARS = 200;
var isMyRulesList = (name) => name === MY_RULES_LIST;
var ruleIdForPreference = (preference2) => `pref_${createHash5("sha256").update(String(preference2)).digest("hex").slice(0, 12)}`;
var ruleTaskName = (ruleId) => `${RULE_TASK_PREFIX}${ruleId}`;
var text = (value) => typeof value === "string" ? value.trim() : "";
var count = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
var quoteCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
var shortQuote = (quote2) => quote2.length > MAX_QUOTE_CHARS ? `${quote2.slice(0, MAX_QUOTE_CHARS - 1)}…` : quote2;
function quoteLines(quotes) {
  return quotes.slice(0, MAX_QUOTES).map((quote2) => {
    const at = quote2.at && Number.isFinite(Date.parse(quote2.at)) ? new Date(quote2.at).toISOString().slice(0, 16).replace("T", " ") : "";
    return `${at} | ${shortQuote(String(quote2.quote).replace(/\s+/g, " ").trim())}`;
  }).join("\n");
}
function parseQuoteLines(value, kind) {
  if (typeof value !== "string") return [];
  return value.split("\n").flatMap((line) => {
    const match = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)?\s*\|\s*(.+)$/.exec(line.trim());
    if (!match) return [];
    return [{ at: match[1] ? `${match[1].replace(" ", "T")}${match[1].length > 10 ? ":00Z" : ""}` : null, quote: match[2], kind }];
  });
}
var ruleScopeId = (tier, name) => tier === "everywhere" ? "everywhere" : `${tier}:${name}`;
function suggestionsFromStory(story) {
  const preferences = Array.isArray(story?.preferences) ? story.preferences : [];
  return preferences.filter((preference2) => text(preference2?.preference)).map((preference2) => {
    const originalQuotes = (preference2.quotes ?? []).filter((quote2) => text(quote2?.quote));
    const quotes = (story.source === "hosted-intent" ? originalQuotes : originalQuotes.slice(0, MAX_QUOTES)).map((quote2) => ({ at: quote2.at ?? null, quote: story.source === "hosted-intent" ? String(quote2.quote) : shortQuote(text(quote2.quote)), kind: preference2.kind }));
    const latest = quotes.map((quote2) => Date.parse(quote2.at ?? "")).filter(Number.isFinite);
    return {
      ruleId: ruleIdForPreference(preference2.preference),
      scopeTier: "everywhere",
      scopeName: "Everywhere",
      // Preferences are single sentences: the whole preference is the "then". Splitting a when out of it
      // would need a model call, which this view never makes; owner-goals' rules already carry their own.
      when: text(preference2.when),
      then: story.source === "hosted-intent" ? String(preference2.preference) : text(preference2.preference),
      setBy: "learned",
      status: "suggested",
      kind: preference2.kind ?? "directive",
      source: preference2.source === "owner-goals" ? "owner-goals" : "request-progress",
      timesSeen: Number.isInteger(preference2.supportCount) && preference2.supportCount > 0 ? preference2.supportCount : 1,
      latestAt: latest.length ? new Date(Math.max(...latest)).toISOString() : story.writtenAt ?? null,
      quotes,
      replacedBy: null,
      replacedAt: null,
      savedAt: null
    };
  });
}
function buildRules(state, ledger) {
  const rules = new Map(suggestionsFromStory(ledger?.story).map((rule) => [rule.ruleId, rule]));
  const writeOrder = new Map((state.events ?? []).map((event, index) => [event.id, index]));
  const ruleTasks = state.lists.filter((list2) => isMyRulesList(list2.name)).flatMap((list2) => list2.tasks).filter((task) => task.name.startsWith(RULE_TASK_PREFIX)).sort((a, b) => (a.updatedAtEpoch ?? 0) - (b.updatedAtEpoch ?? 0) || (writeOrder.get(b.latestEntryId) ?? 0) - (writeOrder.get(a.latestEntryId) ?? 0));
  for (const task of ruleTasks) {
    const fields = task.fields;
    const ruleId = text(fields.rule_id) || task.name.slice(RULE_TASK_PREFIX.length);
    const base = rules.get(ruleId) ?? {
      ruleId,
      scopeTier: "everywhere",
      scopeName: "Everywhere",
      when: "",
      then: "",
      setBy: "owner",
      status: "on",
      kind: "directive",
      source: "you",
      timesSeen: 1,
      latestAt: null,
      quotes: [],
      replacedBy: null,
      replacedAt: null,
      savedAt: null
    };
    const scopeTier = RULE_SCOPE_TIERS.includes(fields.scope_tier) ? fields.scope_tier : base.scopeTier;
    const savedQuotes = parseQuoteLines(fields.quotes, base.kind);
    const quotesTotal = quoteCount(fields.quotes_total);
    rules.set(ruleId, {
      ...base,
      scopeTier,
      scopeName: scopeTier === "everywhere" ? "Everywhere" : text(fields.scope_name) || base.scopeName,
      when: typeof fields.when === "string" ? fields.when.trim() : base.when,
      then: text(fields.then) || base.then,
      setBy: RULE_SET_BY.includes(fields.set_by) ? fields.set_by : base.setBy,
      status: SAVED_RULE_STATUSES.includes(fields.status) ? fields.status : base.status,
      source: text(fields.source) || base.source,
      timesSeen: count(fields.times_seen) ?? base.timesSeen,
      latestAt: text(fields.latest_at) || base.latestAt,
      quotes: savedQuotes.length && !(quotesTotal > savedQuotes.length && base.quotes.length > savedQuotes.length) ? savedQuotes : base.quotes,
      // The local story may still supply quotes that did not fit in the synced row.
      quotesTotal: quotesTotal ?? (savedQuotes.length || base.quotes.length),
      quotesOmitted: quotesTotal === null ? 0 : Math.max(0, quotesTotal - savedQuotes.length),
      replacedBy: text(fields.replaced_by) || null,
      replacedAt: text(fields.replaced_at) || null,
      savedAt: task.updatedAt
    });
  }
  const shown = [...rules.values()].filter((rule) => rule.then && !(rule.setBy === "owner" && rule.status === "dismissed"));
  const scopes = /* @__PURE__ */ new Map([["everywhere", { id: "everywhere", tier: "everywhere", name: "Everywhere" }]]);
  for (const rule of shown) {
    const id = ruleScopeId(rule.scopeTier, rule.scopeName);
    if (!scopes.has(id)) scopes.set(id, { id, tier: rule.scopeTier, name: rule.scopeName });
  }
  const story = ledger?.story ?? null;
  return {
    rules: shown.map((rule) => ({ ...rule, scopeId: ruleScopeId(rule.scopeTier, rule.scopeName) })),
    ruleScopes: [...scopes.values()].sort((a, b) => RULE_SCOPE_TIERS.indexOf(a.tier) - RULE_SCOPE_TIERS.indexOf(b.tier) || a.name.localeCompare(b.name)),
    rulesLearning: story ? {
      preferencesFound: Array.isArray(story.preferences) ? story.preferences.length : 0,
      newSuggestions: shown.filter((rule) => rule.status === "suggested").length,
      reviewsRead: Object.keys(ledger.progress ?? {}).length,
      writtenAt: story.writtenAt ?? null
    } : null
  };
}
function ruleRowFields(rule) {
  const fields = {
    task: ruleTaskName(rule.ruleId),
    rule_id: rule.ruleId,
    scope_tier: rule.scopeTier,
    scope_name: rule.scopeTier === "everywhere" ? "Everywhere" : rule.scopeName,
    when: rule.when ?? "",
    then: rule.then,
    set_by: rule.setBy,
    status: rule.status,
    source: rule.source,
    replaced_by: rule.replacedBy ?? null,
    replaced_at: rule.replacedAt ?? null,
    quotes: quoteLines(rule.quotes ?? []),
    times_seen: rule.timesSeen ?? 1,
    latest_at: rule.latestAt ?? null
  };
  let quotes = (rule.quotes ?? []).slice(0, MAX_QUOTES);
  const quotesTotal = Math.max(rule.quotes?.length ?? 0, quoteCount(rule.quotesTotal) ?? 0);
  if (quotesTotal > quotes.length) fields.quotes_total = quotesTotal;
  while (JSON.stringify(fields).length > 2e3 && quotes.length) {
    quotes = quotes.slice(0, -1);
    fields.quotes = quoteLines(quotes);
    fields.quotes_total = quotesTotal;
  }
  if (JSON.stringify(fields).length > 2e3) throw new RangeError("This rule is too long to save. Shorten it.");
  return fields;
}

// src/services/work-view/agent-view.mjs
init_my_focus();
init_work_product();

// src/services/work-view/agent-lifecycle.mjs
var AGENT_LIFECYCLE_LIST = "agent-lifecycle";
var isAgentLifecycleList = (name) => name === AGENT_LIFECYCLE_LIST;
var STOP_SOURCES = ["subagent-stop-hook", "owner-marked-finished"];
var stopKey = (platformSource, contentSessionId, agentId) => JSON.stringify([String(platformSource ?? "claude"), String(contentSessionId), String(agentId)]);
function agentStopFields({ platformSource, contentSessionId, agentId, agentType = null, stoppedAtEpoch, stopSource }) {
  if (!contentSessionId || !agentId) throw new Error("An agent stop needs the session and the agent id.");
  if (!STOP_SOURCES.includes(stopSource)) throw new Error(`Unknown agent stop source: ${stopSource}`);
  if (!Number.isFinite(stoppedAtEpoch) || stoppedAtEpoch <= 0) throw new Error("An agent stop needs the time it stopped.");
  return {
    task: `Agent ${agentId} in ${platformSource ?? "claude"} session ${contentSessionId}`,
    status: "done",
    platform_source: platformSource ?? "claude",
    content_session_id: contentSessionId,
    agent_id: agentId,
    agent_type: agentType ?? null,
    stopped_at: new Date(stoppedAtEpoch).toISOString(),
    stopped_at_epoch: stoppedAtEpoch,
    stop_source: stopSource
  };
}
function readAgentStops(state) {
  const stops = /* @__PURE__ */ new Map();
  for (const list2 of state.lists ?? []) {
    if (!isAgentLifecycleList(list2.name)) continue;
    for (const task of list2.tasks) {
      const { content_session_id: session, agent_id: agentId, platform_source: platform, stopped_at_epoch: at, stop_source: source } = task.fields;
      if (typeof session !== "string" || typeof agentId !== "string" || !Number.isFinite(at)) continue;
      const key = stopKey(platform, session, agentId);
      const current = stops.get(key);
      if (!current || at > current.stoppedAtEpoch) stops.set(key, { stoppedAtEpoch: at, source, entryId: task.latestEntryId });
    }
  }
  return stops;
}
function agentStopFor(stops, platformSource, contentSessionId, agentId) {
  if (!contentSessionId || !agentId) return null;
  return stops.get(stopKey(platformSource, contentSessionId, agentId)) ?? null;
}

// src/services/work-view/agent-view.mjs
init_session_project();

// src/services/media/feed.ts
init_media_contract();
init_logger();
function observationMediaFromMetadata(metadataJson) {
  if (typeof metadataJson !== "string" || metadataJson.length === 0) return void 0;
  let metadata;
  try {
    metadata = JSON.parse(metadataJson);
  } catch {
    logger.warn("DB", "Observation metadata unreadable; media refs omitted from feed", { code: "invalid_manifest" });
    return void 0;
  }
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return void 0;
  if (!Object.prototype.hasOwnProperty.call(metadata, MEDIA_METADATA_NAMESPACE)) return void 0;
  try {
    const manifest = validateMediaManifest(metadata[MEDIA_METADATA_NAMESPACE]);
    return manifest.attachments.length > 0 ? manifest : void 0;
  } catch (error) {
    logger.warn("DB", "Observation media manifest invalid; media refs omitted from feed", {
      code: error instanceof MediaError ? error.code : "invalid_manifest"
    });
    return void 0;
  }
}

// src/services/work-view/work-state-labels.mjs
init_my_focus();
init_owner_goals();
init_request_judge();
init_atomic_json();
init_redaction();
init_work_state_reduce();
init_work_state_status();
var JUDGED_WORK_STATES = {
  working: { criterion: "Still being worked on: the notes describe work under way, and nothing says it finished, stalled or waits on someone", recordedStatus: "doing" },
  not_started: { criterion: "Not started yet: planned, or a step of a plan waiting its turn after another step", recordedStatus: "todo" },
  waiting_on_person: { criterion: "Waiting on the person: a decision, review, approval, login, answer or merge only they can give", recordedStatus: "needs-you" },
  waiting_on_other: { criterion: "Waiting on something else: CI, a running job, a release, another agent, a date or an outside service", recordedStatus: "doing" },
  finished: { criterion: "Finished: the notes say the work already finished, shipped, merged or was verified, though it was never marked done", recordedStatus: "needs-review" },
  abandoned: { criterion: "Abandoned: superseded, replaced, moved elsewhere or no longer wanted", recordedStatus: "dropped" }
};
var LABEL_THRESHOLD = 0.8;
var REPLACEABLE_STATUSES = /* @__PURE__ */ new Set(["doing", "unknown", "open"]);
var TODO_REPLACEMENTS = /* @__PURE__ */ new Set(["finished", "abandoned"]);
var NOT_NOTES = /* @__PURE__ */ new Set(["task", "status"]);
var notesOf = (fields) => Object.fromEntries(Object.entries(fields).filter(([key, value]) => !NOT_NOTES.has(key) && value !== null));
function workStateItems(state) {
  const lists = state.lists.filter((list2) => !isOwnerGoalsList(list2.name) && !isMyRulesList(list2.name) && !isMyFocusList(list2.name) && !isAgentLifecycleList(list2.name));
  if (!lists.length) return [];
  const stateEntryIds = /* @__PURE__ */ new Map();
  const missingStateIds = new Set(lists.map((list2) => list2.id));
  for (const event of state.events) {
    if (event.task !== null || !missingStateIds.delete(event.listId)) continue;
    stateEntryIds.set(event.listId, event.id);
    if (!missingStateIds.size) break;
  }
  return lists.flatMap((list2) => {
    const stateEntryId = stateEntryIds.get(list2.id) ?? 0;
    const listNotesSent = Object.keys(notesOf(list2.fields)).length > 0;
    return [
      ...list2.tasks.map((task) => ({ ...task, list: list2, recordKind: "task", labelKey: listNotesSent ? `${task.latestEntryId}:${stateEntryId}` : String(task.latestEntryId) })),
      ...Object.keys(list2.fields).some((key) => key !== "task") ? [{ id: list2.id, name: list2.name, fields: list2.fields, status: list2.status, isOpen: !isClosedWorkStateStatus(list2.status), updatedAtEpoch: list2.stateUpdatedAtEpoch, latestEntryId: stateEntryId, labelKey: String(stateEntryId), list: list2, recordKind: "list" }] : []
    ];
  });
}
function appliedLabel(item, labels, threshold = LABEL_THRESHOLD) {
  const label = labels?.[item.labelKey];
  if (!label) return { judgedStatus: null, nextField: null, resultField: null, label: null };
  const recorded = item.recordKind === "list" ? item.fields?.status == null || item.fields.status === "" ? "open" : item.fields.status : item.status;
  return {
    judgedStatus: label.stateP >= threshold ? judgedStatusFor(recorded, label.state) : null,
    nextField: label.nextField && label.nextP >= threshold ? label.nextField : null,
    resultField: label.resultField && label.resultP >= threshold ? label.resultField : null,
    label
  };
}
function judgedStatusFor(recordedStatus, judgedState) {
  const recorded = String(recordedStatus ?? "unknown").toLowerCase();
  if (recorded === "todo" ? !TODO_REPLACEMENTS.has(judgedState) : !REPLACEABLE_STATUSES.has(recorded)) return null;
  const status = JUDGED_WORK_STATES[judgedState]?.recordedStatus;
  if (!status) throw new TypeError(`"${judgedState}" is not a judged work state.`);
  return status === recorded ? null : status;
}

// src/shared/platform-source.ts
var GROK_BUILD_PLATFORM_SOURCE = "grok-build";

// src/services/work-view/agent-view.mjs
var PROJECT_KEY = (value) => String(value ?? "").replace(/[A-Z]/g, (c) => c.toLowerCase());
var PLATFORMS = { codex: "Codex", claude: "Claude Code", gemini: "Gemini CLI", "gemini-cli": "Gemini CLI", "antigravity-cli": "Antigravity CLI", [GROK_BUILD_PLATFORM_SOURCE]: "Grok Build", kimi: "Kimi", "hermes-cli": "Hermes", "pi-agent": "Pi" };
var platformLabel = (platform) => PLATFORMS[platform] ?? compactText(platform, 48) ?? "Unassigned";
var stamp = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value)).toISOString() : null;
var fingerprint = (value) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
var callKey = (project, list2, fields) => JSON.stringify([PROJECT_KEY(project), list2, fingerprint(fields)]);
var agentKey = (platform, session, agent) => JSON.stringify(["session", platform ?? "unknown", String(session ?? ""), agent ?? "unidentified"]);
var lifecycleKey = (platform, session, agent) => JSON.stringify([platform ?? null, session, agent]);
function compactText(value, max = 260) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const text5 = String(value).replace(/\s+/g, " ").trim();
  return text5 ? text5.length > max ? `${text5.slice(0, max - 1).trimEnd()}…` : text5 : null;
}
function fieldText(fields, names, max = 260) {
  for (const name of names) {
    if (typeof fields?.[name] !== "string") continue;
    const text5 = compactText(fields?.[name], max);
    if (text5 && /^(?:true|false|null|undefined|[-+]?\d+(?:\.\d+)?)$/i.test(text5)) continue;
    if (text5) return { text: text5, source: "work-state-field", field: name };
  }
  return null;
}
function readableRequest(value) {
  if (typeof value !== "string") return null;
  const text5 = value.replace(/<(environment_context|instructions|system-reminder|turn_aborted|permissions|collaboration_mode|skills_instructions)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/^\s*#\s*AGENTS\.md instructions[^\n]*(?:\n|$)/gim, " ").trim();
  if (!text5 || /^\s*(?:<\/?(?:environment_context|instructions|system-reminder)\b|You are (?:Codex|an AI)\b)/i.test(text5)) return null;
  return compactText(text5, 500);
}
function confirmedRequestKey(session, number) {
  if (!session || !Number.isInteger(Number(number)) || Number(number) < 0 || number == null) return null;
  return JSON.stringify(["request", session.platform_source ?? "unknown", String(session.id), Number(number)]);
}
function safeRead(database, sql, params = []) {
  try {
    return database.prepare(sql).all(...params);
  } catch (error) {
    if (/no such (table|column)/i.test(String(error.message))) return [];
    throw error;
  }
}
var REQUEST_WINDOW_MS = 14 * 864e5;
function readAgentLaunches(rows) {
  const launches = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const agentId = typeof row.agent_id === "string" && row.agent_id ? row.agent_id : null;
    if (!agentId || !row.content_session_id) continue;
    const key = lifecycleKey(row.platform_source, row.content_session_id, agentId);
    if (launches.has(key)) continue;
    const isAsync = row.is_async === 1 || row.is_async === true || row.status === "async_launched";
    launches.set(key, {
      toolUseId: row.id,
      promptNumber: row.prompt_number ?? null,
      launchedAtEpoch: row.created_at_epoch,
      shared: row.shared === true,
      isAsync,
      returnedAtEpoch: !isAsync && row.status === "completed" ? row.created_at_epoch : null,
      description: compactText(row.description, 160),
      prompt: compactText(row.prompt, 500)
    });
  }
  return launches;
}
function launchRequest(launch) {
  if (!launch) return null;
  const text5 = launch.description ?? launch.prompt;
  return text5 ? { text: text5, source: "agent-launch", sourceId: launch.shared ? null : launch.toolUseId, url: launch.shared ? null : `/api/work-view/evidence/tool-use/${launch.toolUseId}` } : null;
}
var DEFAULT_RECENT_ACTIVITY_MS = 15 * 60 * 1e3;
function buildAgentView(state, records, { now = Date.now(), workLimit = 240, activityLimit = 160, recentMs = DEFAULT_RECENT_ACTIVITY_MS, titleCache = {}, ledger = null, onProductFile = null, workStateLabels = null, localFiles = true, getProjectRoot } = {}) {
  const { calls = [], observations = [], summaries = [], sessions = [], prompts = [], agentLaunches = [], agentToolActivity = [] } = records;
  const launches = readAgentLaunches(agentLaunches);
  const lastToolEpochs = new Map(agentToolActivity.map((row) => [lifecycleKey(row.platform_source, row.content_session_id, row.agent_id), Number(row.last_epoch) || 0]));
  const stops = readAgentStops(state);
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const sessionsByMemory = new Map(sessions.filter((session) => session.memory_session_id).map((session) => [session.memory_session_id, session]));
  const scopes = new Set(state.currentProjectScope.map(PROJECT_KEY));
  const eventsById = new Map(state.events.map((event) => [event.id, event]));
  const fieldEvents = /* @__PURE__ */ new Map();
  for (const event of state.events) for (const field of Object.keys(event.fields)) {
    const key = JSON.stringify([event.taskId ?? event.listId, field]);
    if (!fieldEvents.has(key)) fieldEvents.set(key, event);
  }
  function recordedField(item, names, accept = (value) => typeof value === "string" && value.trim()) {
    const found = [];
    for (const field of names) {
      const own = Object.hasOwn(item.fields, field);
      const value = own ? item.fields[field] : item.list.fields[field];
      if (!accept(value)) continue;
      const event = fieldEvents.get(JSON.stringify([own ? item.id : item.list.id, field]));
      found.push({ value, field, atEpoch: event?.atEpoch ?? item.updatedAtEpoch ?? null, sourceOrder: event?.sourceOrder ?? null, sourceRef: event ? { kind: "work-state", id: event.id } : null });
    }
    return found.sort((a, b) => (b.atEpoch ?? 0) - (a.atEpoch ?? 0));
  }
  function metadataFor(item) {
    const requester = recordedField(item, ["requested_by", "requester", "human_requester"])[0] ?? null;
    const estimate = recordedField(item, ["ship_estimate", "eta", "target_ship_at", "due_at"])[0] ?? null;
    const stage = recordedField(item, ["stage", "phase"])[0] ?? null;
    const resources = [];
    for (const field of ["docs_url", "documentation_url", "promo_url", "announcement_url"]) for (const record of recordedField(item, [field])) {
      try {
        const url = new URL(record.value.trim());
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
        resources.push({ kind: ["docs_url", "documentation_url"].includes(field) ? "documentation" : "promotion", url: record.value.trim(), field, atEpoch: record.atEpoch, sourceRefs: record.sourceRef ? [record.sourceRef] : [] });
      } catch {
      }
    }
    const describe = (fields) => fields.flatMap((field) => recordedField(item, [field]).map((record) => ({ text: compactText(record.value, 600), field, atEpoch: record.atEpoch, sourceRefs: record.sourceRef ? [record.sourceRef] : [] })));
    const classifications = describe(["classification", "category", "tags"]);
    const notes = describe(["post_ship", "after_ship"]);
    const status = recordedField(item, ["request_status"])[0] ?? null;
    const complete = recordedField(item, ["request_complete"], (value) => typeof value === "boolean")[0] ?? null;
    const workProduct = Object.keys({ ...item.list.fields, ...item.fields }).filter(isWorkProductField).flatMap((field) => {
      const event = fieldEvents.get(JSON.stringify([Object.hasOwn(item.fields, field) ? item.id : item.list.id, field]));
      return event ? productsFromFields(event.fields, { atEpoch: event.atEpoch, sourceRef: { kind: "work-state", id: event.id } }).filter((product) => product.field === field) : [];
    });
    return {
      workProduct,
      requestedBy: requester?.value.trim() ?? null,
      requestedBySource: requester,
      shipEstimate: estimate?.value ?? null,
      shipEstimateSource: estimate,
      stageSourceText: stage?.value ?? null,
      stageSource: stage,
      requestStatusSource: status,
      requestCompleteSource: complete,
      afterShip: resources.length || classifications.length || notes.length ? { resources, classifications, notes } : null
    };
  }
  const promptsByKey = /* @__PURE__ */ new Map();
  for (const prompt of prompts) {
    const key = JSON.stringify([prompt.session_db_id, prompt.prompt_number]);
    if (!promptsByKey.has(key)) promptsByKey.set(key, prompt);
  }
  const summaryByKey = /* @__PURE__ */ new Map();
  for (const summary of summaries) {
    const key = JSON.stringify([summary.memory_session_id, summary.prompt_number]);
    if (!summaryByKey.has(key)) summaryByKey.set(key, summary);
  }
  const callsByKey = /* @__PURE__ */ new Map();
  for (const call of calls) {
    let input;
    try {
      input = JSON.parse(call.tool_input);
    } catch {
      continue;
    }
    if (!input?.list || !input.fields || typeof input.fields !== "object" || Array.isArray(input.fields)) continue;
    const key = callKey(call.project, input.list, input.fields);
    if (!callsByKey.has(key)) callsByKey.set(key, []);
    callsByKey.get(key).push(call);
  }
  const groups = /* @__PURE__ */ new Map();
  const activity = [];
  let linkedWork = 0, ownerWork = 0, unattributedWork = 0;
  function getGroup({ session, agentId = null, agentType = null, owner = null, project }) {
    const platform = session?.platform_source ?? null;
    const id = session ? agentKey(platform, session.id, agentId) : JSON.stringify([owner ? "owner" : "unassigned", PROJECT_KEY(project), owner, agentId]);
    if (!groups.has(id)) {
      const label = platformLabel(platform);
      groups.set(id, {
        id,
        kind: session ? "session" : owner ? "recorded-owner" : "unassigned",
        label: session ? label : owner ? compactText(owner, 70) : "Unassigned work",
        platformSource: platform,
        agentId,
        agentType,
        sessionId: session?.id ?? null,
        contentSessionId: session?.content_session_id ?? null,
        sessionTitle: compactText(session?.custom_title, 120),
        recordedSessionStatus: session?.status ?? null,
        project,
        projects: [project],
        inCurrentScope: scopes.has(PROJECT_KEY(project)),
        identityEvidence: session ? "captured-session" : owner ? "explicit-owner-field" : agentId ? "recorded-agent-id" : "no-attribution",
        presence: { status: "unknown", isLive: null, evidence: "recorded-activity-only", lastActivityAt: null },
        // A subagent works inside its parent's conversation; only its own
        // captured tool calls and observations are credited to it. Claude Code
        // sets agent_id only inside a subagent; other hosts (Codex) also tag
        // the main thread, so their groups keep the per-prompt layout.
        isSubagent: Boolean(session && agentId && platform === "claude"),
        launch: session && agentId ? launches.get(lifecycleKey(platform, session.content_session_id, agentId)) ?? null : null,
        work: [],
        activity: [],
        lastActivityEpoch: 0
      });
    }
    const group = groups.get(id);
    if (!group.projects.includes(project)) group.projects.push(project);
    group.inCurrentScope ||= scopes.has(PROJECT_KEY(project));
    return group;
  }
  function requestFor(session, number) {
    if (!session) return null;
    const key = confirmedRequestKey(session, number);
    const prompt = promptsByKey.get(JSON.stringify([session.id, number]));
    const summary = summaryByKey.get(JSON.stringify([session.memory_session_id, number]));
    const original = prompt ? { source: "user-prompt", sourceId: prompt.id, url: `/api/work-view/evidence/prompt/${prompt.id}` } : null;
    if (summary && readableRequest(summary.request)) return { key, text: readableRequest(summary.request), source: "session-summary-request", sourceId: summary.id, url: `/api/work-view/evidence/summary/${summary.id}`, original };
    if (prompt && readableRequest(prompt.prompt_text)) return { key, text: readableRequest(prompt.prompt_text), ...original };
    const opening = readableRequest(Object.hasOwn(session, "sharedOpeningPrompt") ? session.sharedOpeningPrompt : session.user_prompt);
    if ((number == null || number <= 1) && opening) return { key, text: opening, source: "session-initial-request", sourceId: session.sharedOnly ? null : session.id, url: session.sharedOnly ? null : `/api/work-view/evidence/session/${session.id}` };
    return null;
  }
  function addActivity(group, entry) {
    group.lastActivityEpoch = Math.max(group.lastActivityEpoch, entry.atEpoch ?? 0);
    group.activity.push(entry);
    activity.push({ ...entry, agentGroupId: group.id });
  }
  const candidates = workStateItems(state).sort((a, b) => b.updatedAtEpoch - a.updatedAtEpoch).slice(0, workLimit);
  function uniqueCall(event) {
    const matches = (callsByKey.get(callKey(event.originProject ?? event.project, event.listName, event.fields)) ?? []).filter((call) => Math.abs(call.created_at_epoch - event.atEpoch) <= 5e3);
    return matches.length === 1 ? matches[0] : records.sharedAttributions?.get(event.id) ?? null;
  }
  const eventsByItem = /* @__PURE__ */ new Map();
  for (const event of state.events) {
    const itemId = event.taskId ?? (event.task === null ? event.listId : null);
    if (itemId === null) continue;
    if (!eventsByItem.has(itemId)) eventsByItem.set(itemId, []);
    eventsByItem.get(itemId).push(event);
  }
  for (const item of candidates) {
    const event = eventsById.get(item.latestEntryId);
    let call = null, linkedEvent = null;
    for (const candidate of eventsByItem.get(item.id) ?? (event ? [event] : [])) {
      call = uniqueCall(candidate);
      if (call) {
        linkedEvent = candidate;
        break;
      }
    }
    const session = call ? sessionsById.get(call.session_db_id) ?? sessionsByMemory.get(call.memory_session_id) : null;
    const owner = compactText(item.fields.owner, 100);
    const group = getGroup({ session, agentId: call?.agent_id ?? null, agentType: call?.agent_type ?? null, owner, project: item.list.project });
    if (session) linkedWork++;
    else if (owner) ownerWork++;
    else unattributedWork++;
    const explicitRequest = fieldText(item.fields, ["request", "human_request", "user_request"], 500);
    const requestKey = confirmedRequestKey(session, call?.prompt_number);
    const request = { ...explicitRequest ?? requestFor(session, call?.prompt_number) ?? { text: compactText(item.name, 500), source: item.recordKind === "task" ? "task-label" : "list-label", sourceId: item.id, url: null }, key: requestKey };
    const labeled = appliedLabel(item, workStateLabels?.labels);
    const jevField = (name) => {
      const found = name ? fieldText(item.fields, [name]) : null;
      return found ? { ...found, pickedBy: "jev" } : null;
    };
    const next = fieldText(item.fields, ["next_step", "nextStep", "next", "next_action", "remaining", "pending", "then_run"]) ?? jevField(labeled.nextField);
    const outcome2 = fieldText(item.fields, ["outcome", "result", "completed", "verified", "verification"]) ?? jevField(labeled.resultField);
    const progress = fieldText(item.fields, ["human_summary", "summary", "progress", "phase", "stage", "status_note"]);
    const entry = {
      id: item.id,
      kind: "work-state",
      recordKind: item.recordKind,
      title: compactText(item.name, 160),
      project: item.list.project,
      listId: item.list.id,
      listName: item.list.name,
      taskId: item.recordKind === "task" ? item.id : null,
      status: item.status,
      statusExplicit: Object.hasOwn(item.fields, "status"),
      isOpen: item.isOpen,
      request,
      nextStep: next,
      outcome: outcome2,
      progress,
      owner,
      judgedStatus: labeled.judgedStatus,
      judgment: labeled.label ? { state: labeled.label.state, probability: labeled.label.stateP, model: labeled.label.model, at: labeled.label.at } : null,
      requestId: ["string", "number"].includes(typeof (item.fields.request_id ?? item.list.fields.request_id)) ? String(item.fields.request_id ?? item.list.fields.request_id).trim() || null : null,
      requestText: fieldText(item.fields, ["human_request", "request", "user_request"], 1200)?.text ?? fieldText(item.list.fields, ["human_request", "request", "user_request"], 1200)?.text ?? null,
      requestStatus: typeof (item.fields.request_status ?? item.list.fields.request_status) === "string" ? item.fields.request_status ?? item.list.fields.request_status : null,
      requestComplete: typeof (item.fields.request_complete ?? item.list.fields.request_complete) === "boolean" ? item.fields.request_complete ?? item.list.fields.request_complete : null,
      ...metadataFor(item),
      lastUpdateAt: stamp(item.updatedAtEpoch),
      lastUpdateEpoch: item.updatedAtEpoch,
      attribution: session ? { source: call.shared ? "synced-work-state-provenance" : "captured-work-state-call", toolUseId: call.shared ? null : call.id, sessionId: session.id, agentId: call.agent_id ?? null, meaning: linkedEvent.id === event?.id ? "update-author" : "latest-linked-update-author", linkedEntryId: linkedEvent.id, match: call.shared ? "stable-origin-entry" : "unique-project-list-fields-within-5s" } : { source: owner ? "explicit-owner-field" : "unavailable", meaning: owner ? "recorded-assignee" : "unknown" },
      sourceRefs: [{ kind: "work-state", id: event?.id ?? item.latestEntryId }, ...call && !call.shared ? [{ kind: "tool-use", id: call.id }] : []],
      url: `/api/work-view/evidence/work-state/${event?.id ?? item.latestEntryId}`
    };
    group.work.push(entry);
    addActivity(group, { id: `work-state:${event?.id ?? item.latestEntryId}`, requestKey, kind: "work-state", title: entry.title, detail: outcome2?.text ?? progress?.text ?? next?.text ?? null, project: entry.project, at: entry.lastUpdateAt, atEpoch: entry.lastUpdateEpoch, sourceRef: entry.sourceRefs[0], url: entry.url });
  }
  const observationBuckets = /* @__PURE__ */ new Map();
  function observationBucket(group, observation, session, request, requestKey, key, { withSummary }) {
    if (observationBuckets.has(key)) return observationBuckets.get(key);
    const summary = withSummary ? summaryByKey.get(JSON.stringify([observation.memory_session_id, observation.prompt_number])) : null;
    const row = {
      id: `session-request:${key}`,
      kind: "session-request",
      recordKind: "session",
      title: request?.text ?? compactText(observation.title, 160) ?? "Recorded observation",
      project: observation.project,
      listId: null,
      taskId: null,
      status: "unknown",
      statusExplicit: false,
      isOpen: true,
      request: { ...request ?? { text: compactText(observation.title, 500) ?? "Recorded observation", source: "observation-title", sourceId: observation.id, url: `/api/work-view/evidence/observation/${observation.id}` }, key: requestKey },
      nextStep: summary?.next_steps ? { text: compactText(summary.next_steps), source: "session-summary", sourceId: summary.id } : null,
      outcome: summary?.completed ? { text: compactText(summary.completed), source: "session-summary", sourceId: summary.id } : null,
      progress: { text: compactText(observation.title), source: "observation", sourceId: observation.id },
      owner: null,
      lastUpdateAt: stamp(observation.created_at_epoch),
      lastUpdateEpoch: observation.created_at_epoch,
      attribution: { source: session ? "observation-session-link" : "unavailable", meaning: group.isSubagent ? "recorded-subagent" : "recorded-session", agentId: group.agentId ?? null },
      sourceRefs: [{ kind: "observation", id: observation.id }],
      url: `/api/work-view/evidence/observation/${observation.id}`
    };
    observationBuckets.set(key, row);
    group.work.push(row);
    return row;
  }
  const mainKey = (group, observation) => JSON.stringify([group.id, observation.memory_session_id ?? null, observation.content_session_id ?? null, observation.prompt_number ?? null]);
  for (const observation of observations) {
    const session = sessionsByMemory.get(observation.memory_session_id);
    const group = getGroup({ session, agentId: observation.agent_id, agentType: observation.agent_type, project: observation.project });
    const media = observation.media;
    const observationActivity = { id: `observation:${observation.id}`, kind: "observation", title: compactText(observation.title, 160) ?? "Recorded observation", detail: compactText(observation.subtitle), project: observation.project, at: stamp(observation.created_at_epoch), atEpoch: observation.created_at_epoch, sourceRef: { kind: "observation", id: observation.id }, url: `/api/work-view/evidence/observation/${observation.id}`, ...media ? { media } : {} };
    if (!group.isSubagent) {
      const requestKey = confirmedRequestKey(session, observation.prompt_number);
      observationBucket(group, observation, session, requestFor(session, observation.prompt_number), requestKey, mainKey(group, observation), { withSummary: true });
      addActivity(group, { ...observationActivity, requestKey });
      continue;
    }
    const launch = group.launch;
    const launchKey = launch ? confirmedRequestKey(session, launch.promptNumber) : null;
    observationBucket(group, observation, session, launchRequest(launch), launchKey, JSON.stringify([group.id]), { withSummary: false });
    addActivity(group, { ...observationActivity, requestKey: launchKey });
    const parentRequest = requestFor(session, observation.prompt_number);
    if (session && parentRequest) {
      const main = getGroup({ session, agentId: null, agentType: null, project: observation.project });
      const parentKey = confirmedRequestKey(session, observation.prompt_number);
      const row = observationBucket(main, observation, session, parentRequest, parentKey, mainKey(main, observation), { withSummary: true });
      if (!row.sourceRefs.some((ref) => ref.kind === "observation" && ref.id === observation.id)) row.sourceRefs.push({ kind: "observation", id: observation.id });
    }
  }
  function subagentFinish(group) {
    const lastToolEpoch = lastToolEpochs.get(lifecycleKey(group.platformSource, group.contentSessionId, group.agentId)) ?? 0;
    const lastActive = Math.max(group.lastActivityEpoch, lastToolEpoch);
    const evidence2 = [];
    const stop = agentStopFor(stops, group.platformSource, group.contentSessionId, group.agentId);
    if (stop) evidence2.push({ evidence: stop.source, atEpoch: stop.stoppedAtEpoch, sourceRef: { kind: "work-state", id: stop.entryId } });
    if (group.launch?.returnedAtEpoch) evidence2.push({ evidence: "agent-call-returned", atEpoch: group.launch.returnedAtEpoch, sourceRef: group.launch.shared ? null : { kind: "tool-use", id: group.launch.toolUseId } });
    return evidence2.filter((entry) => entry.atEpoch >= lastActive).sort((a, b) => b.atEpoch - a.atEpoch)[0] ?? null;
  }
  const agents = [...groups.values()].map((group) => {
    const { lastActivityEpoch, ...publicGroup } = group;
    const age = Math.max(0, now - lastActivityEpoch);
    const finished = group.isSubagent ? subagentFinish(group) : null;
    if (finished) {
      for (const item of group.work) if (item.kind === "session-request") {
        item.status = "finished";
        item.isOpen = false;
      }
    }
    return {
      ...publicGroup,
      presence: finished ? { ...group.presence, status: "finished", evidence: finished.evidence, finishedAt: stamp(finished.atEpoch), sourceRef: finished.sourceRef, lastActivityAt: stamp(lastActivityEpoch) } : { ...group.presence, status: lastActivityEpoch ? age <= recentMs ? "recent" : "quiet" : "unknown", lastActivityAt: stamp(lastActivityEpoch) },
      // The owner may record a stop for a subagent no recorded evidence covers.
      canMarkFinished: group.isSubagent && !finished,
      work: group.work.sort((a, b) => b.lastUpdateEpoch - a.lastUpdateEpoch),
      activity: group.activity.sort((a, b) => b.atEpoch - a.atEpoch).slice(0, 8),
      counts: { work: group.work.length, open: group.work.filter((item) => item.isOpen).length, done: group.work.filter((item) => item.status === "done").length }
    };
  }).sort((a, b) => String(b.presence.lastActivityAt ?? "").localeCompare(String(a.presence.lastActivityAt ?? "")));
  const recentActivity = activity.sort((a, b) => b.atEpoch - a.atEpoch).slice(0, activityLimit);
  const requestProjection = buildHumanRequests({ agents, recentActivity }, records, { titleCache, ledger, onProductFile, localFiles, getProjectRoot });
  const { focusAreas, focusAreaIdByAnchor } = buildFocusAreas(state);
  return {
    version: 1,
    generatedAt: stamp(now),
    currentProject: state.currentProject,
    currentProjectScope: state.currentProjectScope,
    agents,
    recentActivity,
    goals: buildOwnerGoals(state),
    goalHistory: buildOwnerGoalHistory(state),
    ...buildRules(state, ledger),
    ...requestProjection,
    focusAreas,
    humanRequests: placeRequests(requestProjection.humanRequests, focusAreaIdByAnchor, ledger),
    coverage: { workRows: candidates.length, workLimit, linkedWork, ownerWork, unattributedWork, observations: observations.length, observationLimit: 300, summaries: summaries.length, livePresenceAvailable: false, summaryMethod: "bounded-recorded-text", fullHistoryUrl: "/viewer" }
  };
}
function goalEvidence(value, structuredValue = null) {
  if (structuredValue !== null) {
    const evidence2 = JSON.parse(structuredValue);
    if (!Array.isArray(evidence2) || !evidence2.every((item) => item && typeof item.at === "string" && typeof item.quote === "string")) {
      throw new TypeError("Hosted goal evidence must contain dated quote objects.");
    }
    return evidence2;
  }
  if (typeof value !== "string") return [];
  return value.split("\n").flatMap((line) => {
    const match = /^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s*\|\s*(.+)$/.exec(line.trim());
    if (match) return [{ at: match[1], quote: compactText(match[2], 400) }];
    return compactText(line, 400) ? [{ at: null, quote: compactText(line, 400) }] : [];
  });
}
function goalsFromList(list2, history) {
  const count2 = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
  const hosted = list2.fields.source === "hosted-intent" && list2.fields.hosted_generated_at === list2.fields.generated_at;
  const originalText = (value) => typeof value === "string" ? value : null;
  const listText = (value, max) => hosted ? originalText(value) : compactText(value, max);
  const items = list2.tasks.filter((task) => history ? task.status !== "dropped" : task.isOpen).map((task) => {
    const hostedTask = task.fields.source === "hosted-intent" && task.fields.hosted_snapshot === task.fields.snapshot;
    const taskText = (value, max) => hostedTask ? originalText(value) : compactText(value, max);
    return {
      id: task.id,
      task: task.name,
      kind: goalKindOf(task.fields).kind,
      rank: count2(task.fields.rank),
      title: taskText(task.fields.title ?? task.name, 240),
      // A focus area's one-sentence goal; an ask's focus area (the name it was mined with) and that area's id.
      // 300 and 80 are the bounds they are written with: an area's goal and name (MAX_AREA_GOAL_CHARS and
      // MAX_AREA_NAME_CHARS in save_goals.py, the same as focusBody / ownerGoalsFocusBody in WorkViewRoutes.ts).
      goal: taskText(task.fields.goal, 300),
      focusArea: taskText(task.fields.focus_area, 80),
      focusAreaId: typeof task.fields.focus_area_id === "string" ? task.fields.focus_area_id : null,
      // Rows saved before the three tests (2026-10-27) name a product instead of a focus area.
      product: taskText(task.fields.product, 60),
      latestAt: taskText(task.fields.latest_at, 20),
      timesAsked: count2(task.fields.times_asked),
      status: task.status,
      evidence: goalEvidence(task.fields.evidence, hostedTask ? task.fields.evidence_json ?? null : null)
    };
  }).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.title.localeCompare(b.title));
  const day = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? String(value) : null;
  return {
    listId: list2.id,
    listName: list2.name,
    history,
    project: list2.project,
    updatedAt: list2.updatedAt,
    periodStart: day(list2.fields.period_start) ?? (history ? day(list2.name.slice(OWNER_GOALS_LIST.length + 1)) : null),
    periodEnd: day(list2.fields.period_end),
    summary: listText(list2.fields.human_summary, 1600),
    generatedAt: listText(list2.fields.generated_at, 40),
    windowDays: count2(list2.fields.window_days),
    sourcePromptCount: count2(list2.fields.source_prompt_count),
    mapPath: listText(list2.fields.map_path, 400),
    areas: items.filter((item) => item.kind === "focus-area"),
    asks: items.filter((item) => item.kind === "ask")
  };
}
function buildOwnerGoals(state) {
  const list2 = state.lists.find((item) => item.name === OWNER_GOALS_LIST);
  return list2 && list2.isOpen ? goalsFromList(list2, false) : null;
}
function buildOwnerGoalHistory(state) {
  return state.lists.filter((list2) => list2.name !== OWNER_GOALS_LIST && isOwnerGoalsList(list2.name) && list2.status !== "dropped").map((list2) => goalsFromList(list2, true)).filter((goals) => goals.areas.length || goals.asks.length).sort((a, b) => String(b.periodStart ?? b.listName).localeCompare(String(a.periodStart ?? a.listName)));
}
function readEvidence(database, kind, id) {
  if (!Number.isSafeInteger(id) || id < 1) return null;
  if (database.readEvidence) return database.readEvidence(kind, id);
  const queries = {
    "work-state": "SELECT id, project, list_name, fields, created_at_epoch FROM work_state_entries WHERE id = ?",
    observation: "SELECT id, project, title, subtitle, narrative, created_at_epoch FROM observations WHERE id = ?",
    prompt: "SELECT id, session_db_id, prompt_number, prompt_text, created_at_epoch FROM user_prompts WHERE id = ?",
    summary: "SELECT id, project, request, completed, next_steps, created_at_epoch FROM session_summaries WHERE id = ?",
    session: "SELECT id, project, platform_source, user_prompt, custom_title, status, started_at_epoch FROM sdk_sessions WHERE id = ?",
    "tool-use": "SELECT id, project, tool_name, substr(tool_input, 1, 4000) AS tool_input, substr(tool_response, 1, 4000) AS tool_response, created_at_epoch FROM tool_uses WHERE id = ?"
  };
  if (!queries[kind]) return null;
  const row = safeRead(database, queries[kind], [id])[0];
  return row ? { kind, ...row } : null;
}

// src/services/work-view/overview.ts
import { createHash as createHash7 } from "node:crypto";

// src/ui/my-work/src/components/observation-media/sample-media.ts
var SAMPLE_MEDIA_IDS = Array.from({ length: 6 }, (_, i) => `0000000${i}-aaaa-4aaa-8aaa-00000000000${i}`);
var BROKEN_ID = SAMPLE_MEDIA_IDS[4];
var SAMPLE_MEDIA_REFS = SAMPLE_MEDIA_IDS.map((id, i) => ({
  id,
  label: `event1_image${i % 4 + 1}`,
  inspection: i === 1 ? "uninspected" : "inspected"
}));

// src/ui/my-work/src/live/measured-estimate.ts
var ESTIMATE_PREFIX = "at this pace, about ";
var MONTH_DAY = (epoch2) => new Date(epoch2).toLocaleDateString("en-US", { month: "short", day: "numeric" });
var sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
var startOfDay = (epoch2) => new Date(new Date(epoch2).toDateString()).getTime();
function measuredEstimate(readings, shipped, now) {
  if (shipped) return null;
  const dated = readings.map((reading) => ({ at: Date.parse(reading.at), percent: reading.percent })).filter((reading) => Number.isFinite(reading.at) && Number.isFinite(reading.percent)).sort((a, b) => a.at - b.at);
  if (dated.length < 2) return null;
  const [first, last] = dated.slice(-2);
  if (last.percent <= first.percent || last.at <= first.at || last.percent >= 100) return null;
  if (sameDay(first.at, last.at)) return null;
  const percentPerMs = (last.percent - first.percent) / (last.at - first.at);
  const finish = last.at + (100 - last.percent) / percentPerMs;
  if (startOfDay(finish) < startOfDay(now)) return null;
  return `${ESTIMATE_PREFIX}${MONTH_DAY(finish)}`;
}

// src/ui/my-work/src/data.ts
var EVIDENCE_KINDS = ["prompt", "work-state", "observation", "summary", "session", "record"];
var OTHER_FOCUS_AREA_ID2 = "other";
var PULL_REQUEST = "https://example.com/pull/";
var emptyRequest = { activityWord: "", workstreams: [], granular: [], conversations: [], prompts: [], workProduct: [], followUps: [], story: [], evidence: [], terminal: [] };
var SAMPLE_REQUESTS = [
  {
    ...emptyRequest,
    id: "r1",
    title: "Spec and wireframe the new work viewer",
    summary: "Turn your prompts into a spec, then a React wireframe that traces every element back to it.",
    focusAreaId: "fa-viewer",
    askedBy: "Alex",
    agentId: "claude",
    startedAt: "Oct 20, 1:16 pm",
    startedAtIso: "2026-10-20T13:16:00-07:00",
    runningForMs: 42 * 6e4,
    stage: "Building",
    state: "working",
    progress: { percent: 70, readings: 3, reviewedAt: "1:50 pm", history: [30, 55, 70], coverage: { reviewed: 2, total: 2 } },
    estimate: "at this pace, about Oct 21",
    next: { who: "bot", text: "Finish the My Rules screens" },
    activityWord: "Editing",
    workstreams: [
      { title: "Spec", tasks: [{ name: "Derive from 466 prompts", done: true }, { name: "Decide open questions", done: true }] },
      { title: "Wireframe", tasks: [{ name: "Requirement ledger", done: true }, { name: "My Work screens", done: true }, { name: "My Rules screens", done: false }] }
    ],
    // Six sample images (sample-media.ts): one record holds all six, a second shares the first and says more stayed on its event.
    media: { count: SAMPLE_MEDIA_REFS.length, preview: SAMPLE_MEDIA_REFS.slice(0, 4) },
    granular: [
      { kind: "work", text: "Wireframe: My Work screens done", at: "1:56 pm", media: { version: 1, attachments: SAMPLE_MEDIA_REFS } },
      { kind: "work", text: "Wireframe: requirement ledger done", at: "1:51 pm" },
      { kind: "memory", text: "Card animation redesigned: terminal output that becomes human text", at: "1:45 pm", media: { version: 1, attachments: SAMPLE_MEDIA_REFS.slice(0, 1), overflow: true } },
      { kind: "work", text: "Spec: open questions decided", at: "1:41 pm" },
      { kind: "memory", text: "My Rules named, replacing “Manual”", at: "1:33 pm" },
      { kind: "work", text: "Spec: home and on the go section written", at: "1:28 pm" },
      { kind: "memory", text: "Spec derived from 466 owner prompts", at: "1:20 pm" }
    ],
    // The session ids are not UUIDs, so sample data never offers to continue a conversation.
    conversations: [
      { tool: "Claude Code", at: "Oct 20, 1:16 pm", title: "Work state spec from prompts", platform: "claude", conversationSessionId: "sample-conversation-1" },
      { tool: "Claude Code", at: "Oct 20, 1:24 pm", title: "Home and on the go (after /clear)", platform: "claude", conversationSessionId: "sample-conversation-2" }
    ],
    prompts: [{ at: "10-20 13:24", quote: "it should work the same at my desk and on my phone" }, { at: "10-20 13:27", quote: "rules could read as simple when-then blocks" }],
    workProduct: [{ kind: "Page", label: "My Work LIVE spec", href: "#" }],
    story: [
      { label: "Spec written from your prompts", description: "466 prompts, 15 sections", status: "complete" },
      { label: "Open questions decided", description: "Six decided, one set by you", status: "complete" },
      { label: "Wireframe in React", description: "shadcn and AI Elements", status: "active" }
    ],
    evidence: [{ title: "Observation: spec published", href: "#" }, { title: "Work state: my-work-wireframe", href: "#" }]
  },
  {
    ...emptyRequest,
    id: "r2",
    title: null,
    summary: null,
    askedBy: "Alex",
    agentId: "codex",
    startedAt: "Oct 20, 1:58 pm",
    startedAtIso: "2026-10-20T13:58:00-07:00",
    runningForMs: 3 * 6e4,
    stage: "Planning",
    state: "working",
    progress: { percent: 0, readings: 0, reviewedAt: "—", history: [] },
    estimate: null,
    next: { who: "bot", text: "Read the current usage rollup" },
    activityWord: "Searching",
    resolvesTo: { title: "Show real usage on the price forecast page", summary: "Lead with what you spend today, then what it costs as usage grows." },
    terminal: ["$ work_state_write list=usage-forecast", '  task: "read current usage rollup" status=doing', '$ rg "forecast" src/app/admin', "  12 matches in 4 files"]
  },
  {
    ...emptyRequest,
    id: "r3",
    title: "Move embeddings into their own table",
    summary: "Stops write stalls by keeping vector indexes off the main content table.",
    focusAreaId: "fa-sync",
    askedBy: "Alex",
    agentId: "claude-sync",
    startedAt: "Oct 17, 7:55 am",
    startedAtIso: "2026-10-17T07:55:00-07:00",
    runningForMs: 3 * 864e5,
    stage: "Reviewing",
    state: "needs-check",
    progress: { percent: 100, readings: 4, reviewedAt: "Oct 20, 9:10 am", history: [40, 70, 90, 100], coverage: { reviewed: 2, total: 2 } },
    estimate: null,
    next: { who: "human", text: "Check the remap queue drained" },
    workstreams: [
      { title: "Vectors table", tasks: [{ name: "Migration for the new table", done: true }, { name: "Write path moved", done: true }] },
      { title: "Remap", tasks: [{ name: "Remap target selection", done: true }, { name: "Embedding job rate recorded", done: true }] }
    ],
    workProduct: [{ kind: "PR", label: "#343 store vectors in their own table", href: `${PULL_REQUEST}343` }, { kind: "PR", label: "#344 record the embedding job rate", href: `${PULL_REQUEST}344` }],
    granular: [{ kind: "work", text: "Embedding job rate recorded", at: "Oct 20" }, { kind: "work", text: "Remap target selection fixed", at: "Oct 19" }]
  },
  {
    ...emptyRequest,
    id: "r4",
    title: "Live request monitor with cards and list",
    summary: "The first live version of My Work, with sortable list.",
    focusAreaId: "fa-viewer",
    askedBy: "Sam",
    agentId: "codex",
    startedAt: "Oct 16, 9:39 am",
    startedAtIso: "2026-10-16T09:39:00-07:00",
    runningForMs: 2 * 864e5,
    stage: "Shipped",
    state: "shipped",
    progress: { percent: 100, readings: 5, reviewedAt: "Oct 19", completedAt: "Oct 18", history: [20, 45, 70, 90, 100], coverage: { reviewed: 3, total: 3 } },
    estimate: null,
    next: { who: "human", text: "Write the release notes" },
    workProduct: [{ kind: "PR", label: "#330 live human-request monitor", href: `${PULL_REQUEST}330` }, { kind: "Deck", label: "Launch walkthrough", href: "#", deliverable: true }],
    followUps: [{ tag: "Docs", text: "Write the release notes", done: false }, { tag: "Promo", text: "Launch post with walkthrough", done: false }, { tag: "Other", text: "Telemetry dashboard", done: true }]
  },
  {
    ...emptyRequest,
    id: "r5",
    title: "Fix the admin model price page",
    summary: "Show current usage first, with scaling estimates below.",
    focusAreaId: OTHER_FOCUS_AREA_ID2,
    askedBy: "Priya",
    agentId: "gemini",
    startedAt: "Oct 20, 12:40 pm",
    startedAtIso: "2026-10-20T12:40:00-07:00",
    runningForMs: 60 * 6e4,
    stage: "Building",
    state: "your-move",
    progress: { percent: 30, readings: 1, reviewedAt: "1:30 pm", history: [30], coverage: { reviewed: 1, total: 2 } },
    estimate: null,
    next: { who: "human", text: "Pick which forecast to keep" },
    workstreams: [
      { title: "Usage first", tasks: [{ name: "Current usage table", done: true }] },
      { title: "Forecasts", tasks: [{ name: "Two forecast drafts", done: true }, { name: "Keep one, remove the other", done: false }] }
    ]
  }
];
function assertConsistentRequest(request) {
  const problem = (() => {
    const { state, stage, progress, next } = request;
    if (state === "shipped" !== (stage === "Shipped")) return "only shipped requests are in the Shipped stage";
    if (state === "shipped" && (progress.percent !== 100 || !progress.completedAt)) return "shipped requests are 100% with a completion date";
    if (state === "needs-check" && (stage !== "Reviewing" || next.who !== "human")) return "a request done but not checked is in Reviewing and waits on a person";
    if (state === "your-move" && next.who !== "human") return "Your move means the next step is a person’s";
    if (state === "working" && (next.who !== "bot" || (progress.percent ?? 0) >= 100 || stage === "Reviewing")) return "a working request has an agent next step and is not finished";
    if (!next.missing && next.kind !== "ship" && !next.text?.trim()) return "every request says what happens next, or why nothing is recorded";
    if (progress.history && progress.history.length !== progress.readings) return "reading count matches the readings";
    if (progress.history?.length && progress.history.at(-1) !== progress.percent) return "percent is the latest reading";
    return null;
  })();
  if (problem) throw new Error(`Request ${request.id} is inconsistent: ${problem}`);
  return request;
}
SAMPLE_REQUESTS.forEach(assertConsistentRequest);

// src/ui/my-work/src/live/to-focus-model.ts
var byFocusPriority = (a, b) => (a.ownerRank ?? Infinity) - (b.ownerRank ?? Infinity) || (a.priorityRank ?? Infinity) - (b.priorityRank ?? Infinity) || a.name.localeCompare(b.name);
function createFocusAreaResolver(areas) {
  const byId = new Map(areas.map((area) => [area.id, area]));
  const resolved = /* @__PURE__ */ new Map();
  return (focusAreaId) => {
    if (!focusAreaId) return null;
    if (focusAreaId === OTHER_FOCUS_AREA_ID2) return OTHER_FOCUS_AREA_ID2;
    if (resolved.has(focusAreaId)) return resolved.get(focusAreaId);
    const seen = /* @__PURE__ */ new Set();
    let id = focusAreaId;
    let result = null;
    while (!seen.has(id)) {
      if (resolved.has(id)) {
        result = resolved.get(id);
        break;
      }
      seen.add(id);
      const area = byId.get(id);
      if (!area) break;
      if (!area.mergedInto) {
        result = area.status !== "dismissed" ? area.id : null;
        break;
      }
      id = area.mergedInto;
    }
    for (const visited of seen) resolved.set(visited, result);
    return result;
  };
}
var toAsk = (item) => ({ id: item.id, title: item.title, timesAsked: item.timesAsked, latestAt: item.latestAt, quotes: item.quotes });
var newerStamp = (a, b) => a > b ? a : b;
function toFocusModel(raw, minedAreas, minedAsks) {
  const areas = (raw ?? []).map((area) => ({
    id: area.focusAreaId,
    name: area.name,
    goal: area.goal,
    about: area.about ?? null,
    status: area.status,
    ownerRank: area.ownerRank,
    priorityRank: area.priorityRank,
    source: area.source,
    mergedInto: area.mergedInto,
    evidence: area.evidence,
    doneAt: area.doneAt ?? null,
    timesAsked: null,
    latestAt: null,
    quotes: [],
    asks: []
  })).sort(byFocusPriority);
  const resolveArea = createFocusAreaResolver(areas);
  const byId = new Map(areas.map((area) => [area.id, area]));
  const liveArea = (focusAreaId) => {
    const placed = resolveArea(focusAreaId);
    return placed && placed !== OTHER_FOCUS_AREA_ID2 ? byId.get(placed) : void 0;
  };
  for (const item of minedAreas) {
    const area = liveArea(item.focusAreaId);
    if (!area) continue;
    area.timesAsked = (area.timesAsked ?? 0) + item.timesAsked;
    area.latestAt = area.latestAt === null ? item.latestAt : newerStamp(area.latestAt, item.latestAt);
    const seen = new Set(area.quotes.map((quote2) => `${quote2.at}\0${quote2.quote}`));
    area.quotes = [...area.quotes, ...item.quotes.filter((quote2) => !seen.has(`${quote2.at}\0${quote2.quote}`))].sort((a, b) => b.at.localeCompare(a.at));
  }
  const otherAsks = [];
  for (const ask of minedAsks) {
    const area = liveArea(ask.focusAreaId);
    if (area) area.asks.push(toAsk(ask));
    else otherAsks.push(toAsk(ask));
  }
  return { focusAreas: areas, otherAsks };
}

// src/ui/my-work/src/live/status-normalization.ts
var STALE_AFTER_MS = 6 * 60 * 60 * 1e3;
var NEEDS_YOU_VALUES = ["needs-you", "needs-input", "waiting-on-user", "awaiting-approval", "needs-approval"];
var NEEDS_REVIEW_VALUES = ["needs-review", "review", "in-review", "awaiting-review", "ready-for-review"];
var COMPLETE_LIFECYCLE_VALUES = ["done", "completed", "complete"];
var SHIPPED_LIFECYCLE_VALUES = ["shipped", "delivered"];
function normalizeRecordedStatus(value) {
  const status = String(value ?? "").trim().toLowerCase().replace(/[_ ]/g, "-");
  if (NEEDS_YOU_VALUES.includes(status)) return "needs-you";
  if (NEEDS_REVIEW_VALUES.includes(status)) return "needs-review";
  return status;
}
function statusFor(rawItems, now) {
  const items = rawItems.map((item) => item.judgedStatus ? { ...item, status: item.judgedStatus } : item);
  const states = items.map((item) => normalizeRecordedStatus(item.status));
  if (states.includes("needs-you")) return "needs-you";
  if (states.includes("needs-review")) return "needs-review";
  if (states.some((state) => ["blocked", "failed"].includes(state))) return "blocked";
  if (items.length && items.every((item) => item.kind === "work-state" && ["done", "completed"].includes(item.status))) return "done";
  if (items.length && items.every((item) => item.kind === "work-state" && item.status === "dropped")) return "closed";
  const updated = Math.max(0, ...items.map((item) => item.lastUpdateEpoch || 0));
  if (now - updated > STALE_AFTER_MS) return "quiet";
  if (states.some((state) => ["doing", "in-progress", "active", "running", "open"].includes(state))) return "in-progress";
  if (states.some((state) => ["todo", "planned", "queued"].includes(state))) return "todo";
  return "unknown";
}
var STATUS = {
  "needs-you": { label: "Needs you", rank: 0 },
  "needs-review": { label: "Done, not checked", rank: 1 },
  blocked: { label: "Blocked", rank: 1 },
  "in-progress": { label: "In progress", rank: 2 },
  quiet: { label: "No recent update", rank: 1 },
  done: { label: "Done", rank: 5 },
  checked: { label: "Checked", rank: 5 },
  shipped: { label: "Shipped", rank: 6 },
  todo: { label: "To do", rank: 3 },
  unknown: { label: "Update recorded", rank: 4 },
  closed: { label: "Closed", rank: 6 }
};
function normalizeRequestStatus({ items, lifecycle, checked, progressState, progressPercent }, now) {
  let status = statusFor(items, now);
  const recordedStatus = lifecycle?.explicit ? normalizeRecordedStatus(lifecycle.status) : null;
  const lifecycleStatus = !lifecycle?.explicit ? null : SHIPPED_LIFECYCLE_VALUES.includes(recordedStatus) ? "shipped" : lifecycle.complete === true || COMPLETE_LIFECYCLE_VALUES.includes(recordedStatus) ? "done" : recordedStatus;
  if (status === "done" && !["done", "shipped"].includes(lifecycleStatus ?? "")) status = "unknown";
  if (lifecycleStatus && lifecycleStatus in STATUS) status = lifecycleStatus;
  if (progressState === "shipped") status = "shipped";
  else if (progressPercent === 100 && ["in-progress", "todo", "unknown", "quiet"].includes(status)) status = "needs-review";
  if (checked && (status === "done" || status === "needs-review")) status = "checked";
  return status;
}
function presentStatus(status, recent) {
  switch (status) {
    case "needs-you":
      return { state: "your-move", stage: "Building", who: "human" };
    case "needs-review":
      return { state: "needs-check", stage: "Reviewing", who: "human" };
    case "blocked":
      return { state: "your-move", stage: "Building", who: "human" };
    case "shipped":
      return { state: "shipped", stage: "Shipped", who: "bot" };
    case "done":
      return { state: "needs-check", stage: "Reviewing", who: "human" };
    case "checked":
      return { state: "your-move", stage: "Reviewing", who: "human" };
    case "closed":
      return { state: "idle", stage: "Building", who: "bot" };
    case "quiet":
      return { state: "idle", stage: "Building", who: "bot" };
    case "in-progress":
      return { state: "working", stage: "Building", who: "bot" };
    case "todo":
      return { state: "working", stage: "Planning", who: "bot" };
    case "unknown":
      return { state: recent ? "working" : "idle", stage: "Building", who: "bot" };
  }
}

// src/ui/my-work/src/live/prompt-echo.ts
var plain = (text5) => text5.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function repeatsOwnerWords(text5, words) {
  const wanted = plain(text5.replace(/…$/, ""));
  return !!wanted && words.some((said) => plain(said).includes(wanted));
}

// src/ui/my-work/src/live/work-view-overview.ts
var SOLO_REQUESTER = "You";

// src/ui/my-work/src/live/to-work-model.ts
var THIS_COMPUTER = { id: "this-computer", name: "This computer", syncedMinutesAgo: 0, online: true };
var UNRECORDED_AGENT = { id: "agent-not-recorded", tool: "other", name: "Agent not recorded", role: "Recorded work", deviceId: THIS_COMPUTER.id };
var RECORDED_SESSION_ROLE = "Recorded session";
var NEXT_STEP_NOT_RECORDED = "Next step not recorded";
var NO_WORK_YET = "No agent work recorded yet";
var TIME_NOT_RECORDED = "Time not recorded";
var LEGACY_UNBLOCK_PREFIX = "Unblock: ";
var LEGACY_MISSING_NEXT_STEP = /* @__PURE__ */ new Map([
  [NEXT_STEP_NOT_RECORDED, "not-recorded"],
  [`${LEGACY_UNBLOCK_PREFIX}${NEXT_STEP_NOT_RECORDED}`, "not-recorded"],
  [NO_WORK_YET, "no-agent-work"],
  [`${LEGACY_UNBLOCK_PREFIX}${NO_WORK_YET}`, "no-agent-work"]
]);
var KNOWN_TOOLS = ["claude", "codex", "gemini"];
var PLATFORM_LABEL = { claude: "Claude Code", codex: "Codex", gemini: "Gemini" };
var UNNAMED_TOOL = "Agent";
var EVIDENCE_URL = /^\/api\/work-view\/evidence\/([\w-]+)\/\d+$/;
var EVIDENCE_ROUTE_KINDS = EVIDENCE_KINDS.filter((kind) => kind !== "record");
var WORK_PRODUCT_KIND = {
  "pull-request": "PR",
  commit: "Commit",
  branch: "Branch",
  artifact: "Page",
  page: "Page",
  deployment: "Page",
  deck: "Deck",
  document: "Doc",
  documentation: "Doc",
  image: "File",
  video: "File",
  spreadsheet: "File",
  file: "File"
};
function mapWorkProduct(products) {
  return (products ?? []).filter((product) => product.available !== false || product.availability === "origin-only").map((product) => ({
    kind: WORK_PRODUCT_KIND[product.kind] ?? "Link",
    label: cleanText(product.title, 140) || product.kind,
    href: product.availability === "origin-only" ? void 0 : product.url ?? product.fileUrl ?? void 0,
    ...product.deliverable === true ? { deliverable: true } : {},
    ...product.availability === "origin-only" ? { availability: "origin-only" } : {}
  }));
}
function evidenceKindOf(href) {
  if (!EVIDENCE_URL.test(href)) return null;
  const kind = routeKindOf(href);
  if (!kind) throw new Error(`A source record links to an evidence kind this page does not know: ${href}`);
  return kind;
}
function routeKindOf(href) {
  const named = EVIDENCE_URL.exec(href)?.[1];
  return EVIDENCE_ROUTE_KINDS.find((known) => known === named);
}
var meaningful = (value) => typeof value === "string" && !!value.trim() && !/^(true|false|null|undefined|\d+)$/i.test(value.trim());
function cleanText(value, max = 150) {
  if (!meaningful(value)) return "";
  const text5 = value.replace(/<(environment_context|instructions|system-reminder|INSTRUCTIONS|AGENTS)[\s\S]*?<\/\1>/gi, " ").replace(/```[\s\S]*?```/g, " ").replace(/<[^>]*>/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (/^(?:AGENTS\.md instructions|You are (?:Codex|an AI)|[/{]["']?\w+["']?\s*:)/i.test(text5)) return "";
  if (text5.length <= max) return text5;
  const cut = text5.slice(0, max - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > max * 0.65 ? boundary : max - 1).replace(/[,:;\-\s]+$/, "")}…`;
}
var isoOf = (epoch2) => new Date(epoch2).toISOString();
var lowercaseMeridiem = (text5) => text5.replace(/\s?(AM|PM)$/, (_, meridiem) => ` ${meridiem.toLowerCase()}`);
var formatDateTime = (epoch2) => lowercaseMeridiem(new Date(epoch2).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
function formatRecordTime(epoch2, now) {
  const sameDay2 = new Date(epoch2).toDateString() === new Date(now).toDateString();
  return sameDay2 ? lowercaseMeridiem(new Date(epoch2).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })) : new Date(epoch2).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function formatPromptStamp(epoch2) {
  const date2 = new Date(epoch2);
  const two = (value) => String(value).padStart(2, "0");
  return `${two(date2.getMonth() + 1)}-${two(date2.getDate())} ${two(date2.getHours())}:${two(date2.getMinutes())}`;
}
var lastPathSegment = (path) => path?.split("/").filter(Boolean).at(-1) ?? null;
function parseRecordKey(key) {
  const parsed = JSON.parse(key);
  if (!Array.isArray(parsed)) throw new Error(`Record key is not an array: ${key}`);
  return parsed.map(String);
}
function toAgent(agent, parentId) {
  const tool = KNOWN_TOOLS.includes(agent.platformSource) ? agent.platformSource : "other";
  const mapped = { id: agent.id, tool, name: agent.label, role: agent.sessionTitle ?? lastPathSegment(agent.project) ?? RECORDED_SESSION_ROLE, deviceId: THIS_COMPUTER.id };
  if (!agent.isSubagent) return mapped;
  const finished = agent.presence?.status === "finished";
  const finishedAt = finished && agent.presence?.finishedAt ? Date.parse(agent.presence.finishedAt) : NaN;
  const launchDescription = cleanText(agent.launch?.description, 160);
  return {
    ...mapped,
    status: finished ? "finished" : agent.presence?.status === "recent" ? "working" : "quiet",
    ...Number.isFinite(finishedAt) ? { finishedAt: formatDateTime(finishedAt), finishedAtIso: new Date(finishedAt).toISOString() } : {},
    canMarkFinished: agent.canMarkFinished === true,
    ...parentId ? { parentId } : {},
    ...launchDescription ? { launchDescription } : {}
  };
}
var SESSION_SHORT_ID_CHARS = 8;
function sessionsThatTellAgentsApart(raw, mapped) {
  const headerOf = (agent) => JSON.stringify([agent.name, agent.role, agent.deviceId]);
  const mains = mapped.filter((agent) => agent.status === void 0);
  const counts = /* @__PURE__ */ new Map();
  for (const agent of mains) counts.set(headerOf(agent), (counts.get(headerOf(agent)) ?? 0) + 1);
  const sessions = new Map(raw.map((agent) => [agent.id, agent.contentSessionId]));
  const shortIds = /* @__PURE__ */ new Map();
  for (const agent of mains) {
    const session = sessions.get(agent.id);
    if (counts.get(headerOf(agent)) > 1 && session) shortIds.set(agent.id, session.slice(0, SESSION_SHORT_ID_CHARS));
  }
  return shortIds;
}
function subagentParents(agents) {
  const sessionKey = (agent) => JSON.stringify([agent.platformSource, agent.contentSessionId]);
  const mainsBySession = /* @__PURE__ */ new Map();
  for (const agent of agents) {
    if (agent.isSubagent || !agent.contentSessionId) continue;
    mainsBySession.set(sessionKey(agent), [...mainsBySession.get(sessionKey(agent)) ?? [], agent.id]);
  }
  const parents = /* @__PURE__ */ new Map();
  for (const agent of agents) {
    if (!agent.isSubagent || !agent.contentSessionId) continue;
    const mains = mainsBySession.get(sessionKey(agent)) ?? [];
    if (mains.length === 1) parents.set(agent.id, mains[0]);
  }
  return parents;
}
function nextStepFor(status, who, recordedNext, missing) {
  if (status === "checked") return { who, kind: "ship" };
  const kind = status === "blocked" ? { kind: "unblock" } : {};
  return recordedNext === null ? { who, ...kind, missing } : { who, ...kind, text: recordedNext };
}
function storySteps(progress, now) {
  return [...progress.milestones ?? []].sort((a, b) => (Date.parse(a.at ?? "") || 0) - (Date.parse(b.at ?? "") || 0)).map((milestone) => {
    const at = Date.parse(milestone.at ?? "");
    return { label: cleanText(milestone.text, 200), at: Number.isFinite(at) ? formatRecordTime(at, now) : null, ...Number.isFinite(at) ? { atIso: isoOf(at) } : {}, status: "complete" };
  }).filter((step) => step.label);
}
function reviewIsNewerThanLifecycle(review, lifecycle) {
  if (!lifecycle?.explicit || !lifecycle.atEpoch) return true;
  const reviewedAt = Date.parse(review.checkedAt ?? "");
  return Number.isFinite(reviewedAt) && reviewedAt >= lifecycle.atEpoch;
}
function toRequest(raw, agents, now, resolveArea) {
  const copy = raw.humanCopy;
  const copyReady = !!copy && ["current", "outdated"].includes(copy.state);
  const generatedTitle = raw.titleSource === "request-group" || raw.titleSource === "title-cache";
  const updatedAt = raw.updatedAtEpoch ?? Math.max(0, ...raw.items.map((item) => item.lastUpdateEpoch || 0));
  const recordedReview = raw.progress ?? null;
  const reviewCounts = !!recordedReview && reviewIsNewerThanLifecycle(recordedReview, raw.lifecycle);
  const review = reviewCounts || recordedReview && recordedReview.percent < 100 ? recordedReview : null;
  const statusItems = raw.items.length ? raw.items : [{ kind: "prompt", status: "", lastUpdateEpoch: updatedAt }];
  const status = normalizeRequestStatus({ items: statusItems, lifecycle: raw.lifecycle, checked: raw.review?.checked === true, progressState: reviewCounts ? review?.state : null, progressPercent: reviewCounts ? review?.percent : null }, now);
  const shippedAt = review?.state === "shipped" && review.shippedAt ? Date.parse(review.shippedAt) : NaN;
  const completedEpoch = raw.completedAtEpoch ?? (Number.isFinite(shippedAt) ? shippedAt : null);
  const { state, stage, who } = presentStatus(status, now - updatedAt <= STALE_AFTER_MS);
  const recordedNext = copyReady && cleanText(copy.next, 240) || cleanText(raw.items.find((item) => item.nextStep?.text)?.nextStep?.text, 140) || null;
  const missingNext = raw.items.length || raw.activity.length || recordedReview ? "not-recorded" : "no-agent-work";
  const agentId = agents.some((agent) => agent.id === raw.agentIds[0]) ? raw.agentIds[0] : UNRECORDED_AGENT.id;
  const started = raw.startedAtEpoch;
  const reviewedAt = review ? Date.parse(review.checkedAt ?? "") : NaN;
  const readings = review?.readings ?? [];
  const readingsStopShort = status === "shipped" && !!review && review.percent < 100;
  const evidence2 = [
    ...raw.original.url && evidenceKindOf(raw.original.url) ? [{ kind: "prompt", title: cleanText(raw.original.text, 80), href: raw.original.url }] : [],
    ...raw.items.flatMap((item) => {
      const kind = evidenceKindOf(item.url);
      return kind ? [{ kind, title: cleanText(item.title, 80), href: item.url }] : [];
    })
  ].filter((source, index, all) => all.findIndex((other) => other.href === source.href) === index);
  const focusAreaId = resolveArea(raw.focusAreaId);
  const title = generatedTitle ? raw.title.trim() || null : copyReady && copy.title?.trim() ? copy.title.trim() : null;
  const ownerWords = [raw.original, ...raw.scopeUpdates].map((prompt) => prompt.text ?? "");
  const titleRepeatsPrompt = !!title && repeatsOwnerWords(title, ownerWords);
  const summary = raw.groupId && recordedReview ? reviewCounts ? recordedReview.summary?.trim() || null : null : copyReady && copy.summary?.trim() ? copy.summary.trim() : null;
  const summaryRepeatsPrompt = !!summary && repeatsOwnerWords(summary, ownerWords);
  const nextRepeatsPrompt = status !== "checked" && recordedNext !== null && repeatsOwnerWords(recordedNext, ownerWords);
  return assertConsistentRequest({
    id: raw.id,
    contentFingerprint: raw.contentFingerprint,
    // Group reviews already contain display copy; their source is independent of the optional human-copy writer.
    title,
    ...titleRepeatsPrompt ? { titleRepeatsPrompt } : {},
    summary,
    ...summaryRepeatsPrompt ? { summaryRepeatsPrompt } : {},
    ...nextRepeatsPrompt ? { nextRepeatsPrompt } : {},
    stageNote: copy?.stage?.trim() || void 0,
    ...focusAreaId ? { focusAreaId } : {},
    canMoveFocus: !!raw.anchorConversationKey,
    askedBy: raw.requestedBy ?? SOLO_REQUESTER,
    agentId,
    // Not recorded is null, which the screens word (never English text as data).
    startedAt: started ? formatDateTime(started) : null,
    startedAtIso: started ? new Date(started).toISOString() : void 0,
    runningForMs: started ? (completedEpoch ?? now) - started : null,
    // Counts up only while the request is open: not closed, and not completed by a recorded time or a lifecycle that
    // says complete (the projection's own rule, even when the lifecycle carries no time).
    runningLive: started && completedEpoch === null && status !== "closed" && raw.lifecycle?.complete !== true ? true : void 0,
    stage,
    state,
    closed: status === "closed" || void 0,
    // The percent comes only from a memory review. An explicit shipped lifecycle is complete by definition.
    progress: {
      percent: status === "shipped" ? 100 : review ? review.percent : null,
      readings: review ? Math.max(1, readings.length) : 0,
      reviewedAt: Number.isFinite(reviewedAt) ? formatRecordTime(reviewedAt, now) : "Not reviewed yet",
      ...Number.isFinite(reviewedAt) ? { reviewedAtIso: isoOf(reviewedAt) } : {},
      // A current progress record is one assessment, not an invented historical reading.
      history: readingsStopShort || review && readings.length === 0 ? void 0 : readings.map((reading) => reading.percent),
      completedAt: status === "shipped" && completedEpoch ? formatDateTime(completedEpoch) : void 0,
      ...status === "shipped" && completedEpoch ? { completedAtIso: isoOf(completedEpoch) } : {}
    },
    estimate: measuredEstimate(readings, status === "shipped", now),
    next: nextStepFor(status, who, recordedNext, missingNext),
    // No agent activity yet: the card shows the human's own asks instead.
    terminal: raw.activity.length ? raw.activity.slice(0, 4).reverse().map((activity) => cleanText(`${activity.kind} ${activity.title}${activity.detail ? `: ${activity.detail}` : ""}`, 160)).filter(Boolean) : [raw.original, ...raw.scopeUpdates].slice(-4).map((prompt) => cleanText(`ask ${prompt.text}`, 160)).filter(Boolean),
    activityWord: copyReady ? "Working" : "Translating",
    // A title or name that is not recorded is null, which the drawer words (never English text as data).
    workstreams: raw.workstreams.map((stream) => ({
      title: cleanText(copy?.workstreams?.find((entry) => entry.id === stream.id)?.title, 115) || null,
      tasks: stream.items.filter((item) => item.kind === "work-state").map((item) => ({ name: cleanText(item.title, 160) || null, done: ["done", "completed"].includes(item.status) }))
    })),
    granular: raw.activity.map((activity) => ({
      kind: activity.kind === "observation" ? "memory" : "work",
      text: cleanText(activity.detail ? `${activity.title}: ${activity.detail}` : activity.title, 200),
      at: formatRecordTime(activity.atEpoch, now),
      atIso: isoOf(activity.atEpoch),
      ...activity.media ? { media: activity.media } : {}
    })).filter((record) => record.text),
    conversations: raw.conversationKeys.map((key) => {
      const [, platform, sessionId] = parseRecordKey(key);
      const session = agents.find((agent) => agent.platformSource === platform && agent.contentSessionId === sessionId && agent.sessionTitle);
      return {
        tool: PLATFORM_LABEL[platform] ?? UNNAMED_TOOL,
        at: key === raw.id && raw.original.atEpoch ? formatDateTime(raw.original.atEpoch) : TIME_NOT_RECORDED,
        ...key === raw.id && raw.original.atEpoch ? { atIso: isoOf(raw.original.atEpoch) } : {},
        // Its session's own title, or null when none is recorded: the screens word that ("{tool} conversation", R2).
        title: session?.sessionTitle ?? null,
        platform,
        conversationSessionId: sessionId
      };
    }),
    prompts: [raw.original, ...raw.scopeUpdates].map((prompt) => ({ at: prompt.atEpoch ? formatPromptStamp(prompt.atEpoch) : TIME_NOT_RECORDED, quote: cleanText(prompt.text, 400) })).filter((prompt) => prompt.quote),
    workProduct: mapWorkProduct(raw.workProduct),
    ...raw.media ? { media: raw.media } : {},
    followUps: [],
    story: review ? storySteps(review, now) : [],
    storyNarrative: review?.narrative?.trim() || void 0,
    evidence: evidence2,
    checkedAt: raw.review?.checked && raw.review.checkedAtEpoch ? formatDateTime(raw.review.checkedAtEpoch) : void 0,
    ...raw.review?.checked && raw.review.checkedAtEpoch ? { checkedAtIso: isoOf(raw.review.checkedAtEpoch) } : {},
    ...raw.review?.mode ? { review: {
      mode: raw.review.mode,
      hash: raw.review.hash ?? null,
      available: raw.review.available,
      version: raw.review.version,
      conflict: raw.review.conflict,
      legacy: raw.review.legacy,
      pending: raw.review.pending,
      message: raw.review.message
    } } : {},
    ...raw.suggestion ? { suggestion: {
      conversationKey: raw.suggestion.conversationKey,
      requestId: raw.suggestion.requestId,
      requestTitle: cleanText(raw.suggestion.requestTitle, 200),
      evidence: cleanText(raw.suggestion.evidence, 500),
      ...Number.isFinite(raw.suggestion.confidence) ? { confidence: raw.suggestion.confidence } : {},
      expectedSuggestionHash: raw.suggestion.expectedSuggestionHash,
      sharedConflict: raw.suggestion.sharedConflict
    } } : {}
  });
}
var GOAL_KINDS2 = ["focus-area", "ask"];
var OWNER_GOALS_SKILL = "owner-goals";
var RECORDED_PROMPT_TIME = /^\d{4}-(\d{2}-\d{2})(?: (\d{2}:\d{2}))?$/;
var RECORDED_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
var MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function toGoalPromptStamp(recordedAt, whatIsDated) {
  if (recordedAt === null || recordedAt === "") return "";
  const match = RECORDED_PROMPT_TIME.exec(recordedAt);
  if (!match) throw new Error(`${whatIsDated} has an unreadable time: ${recordedAt}`);
  return match[2] ? `${match[1]} ${match[2]}` : match[1];
}
function requireRecordedCount(value, whatIsCounted) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${whatIsCounted} is not recorded`);
  return value;
}
function toGoalItem(item) {
  if (!GOAL_KINDS2.includes(item.kind)) throw new Error(`Owner-goals item "${item.title}" has an unknown kind: ${item.kind}`);
  const what = `${item.kind === "ask" ? "ask" : "focus area"} "${item.title}"`;
  requireRecordedCount(item.rank, `The rank of the ${what}`);
  return {
    id: item.id,
    title: item.title,
    focusAreaId: item.focusAreaId,
    label: item.focusArea ?? item.product ?? (item.kind === "focus-area" ? "Focus area" : "Area not recorded"),
    latestAt: toGoalPromptStamp(item.latestAt, `The ${what}`),
    timesAsked: requireRecordedCount(item.timesAsked, `How often the ${what} was asked`),
    quotes: item.evidence.map((evidence2) => ({ at: toGoalPromptStamp(evidence2.at, `A quote under the ${what}`), quote: evidence2.quote }))
  };
}
function periodLabel(periodStart, periodEndExclusive, currentYear) {
  const start = RECORDED_DAY.exec(periodStart);
  if (!start) throw new Error(`A saved owner-goals month has an unreadable start day: ${periodStart}`);
  const startText = `${MONTH_LABELS[Number(start[2]) - 1]} ${Number(start[3])}`;
  if (!periodEndExclusive) return Number(start[1]) === currentYear ? `From ${startText}` : `From ${startText}, ${start[1]}`;
  if (!RECORDED_DAY.test(periodEndExclusive)) throw new Error(`A saved owner-goals month has an unreadable end day: ${periodEndExclusive}`);
  const lastDay = /* @__PURE__ */ new Date(`${periodEndExclusive}T12:00:00Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const endText = `${MONTH_LABELS[lastDay.getUTCMonth()]} ${lastDay.getUTCDate()}`;
  const startYear = Number(start[1]);
  const endYear = lastDay.getUTCFullYear();
  if (startYear === currentYear && endYear === currentYear) return `${startText} – ${endText}`;
  return startYear === endYear ? `${startText} – ${endText}, ${endYear}` : `${startText}, ${startYear} – ${endText}, ${endYear}`;
}
function toPastPeriod(list2, currentYear) {
  const periodStart = list2.periodStart ?? list2.listName;
  return {
    id: list2.listName,
    label: periodLabel(periodStart, list2.periodEnd, currentYear),
    promptCount: requireRecordedCount(list2.sourcePromptCount, `The prompt count for ${list2.listName}`),
    headline: list2.summary ?? "No summary recorded for this month.",
    areas: list2.areas.map(toGoalItem).map((goal) => ({ title: goal.title, label: goal.label, timesAsked: goal.timesAsked, quote: goal.quotes[0] ?? null }))
  };
}
function recordedDayLabel(generatedAt) {
  const day = RECORDED_DAY.exec(generatedAt.slice(0, 10));
  if (!day) throw new Error(`The ${OWNER_GOALS_SKILL} run has no readable day in generated_at (${generatedAt})`);
  return `${MONTH_LABELS[Number(day[2]) - 1]} ${Number(day[3])}`;
}
function generatedAtEpoch(list2) {
  const epoch2 = Date.parse(list2.generatedAt ?? "");
  if (!Number.isFinite(epoch2)) throw new Error(`The ${OWNER_GOALS_SKILL} run has no readable generated_at (${list2.generatedAt ?? "missing"})`);
  return epoch2;
}
var NO_GOALS = { minedAreas: [], minedAsks: [], currentPeriod: null, pastPeriods: [], goalsReadError: null, goalsRun: null };
function toGoalsModel(goals, goalHistory) {
  if (!goals) return NO_GOALS;
  try {
    const generatedAt = generatedAtEpoch(goals);
    const windowDays = requireRecordedCount(goals.windowDays, `The ${OWNER_GOALS_SKILL} window`);
    const generatedYear = new Date(generatedAt).getFullYear();
    const currentPeriod = {
      label: goals.periodStart ? periodLabel(goals.periodStart, goals.periodEnd, generatedYear) : `${windowDays} days to ${recordedDayLabel(goals.generatedAt)}`,
      windowDays,
      promptCount: requireRecordedCount(goals.sourcePromptCount, `The ${OWNER_GOALS_SKILL} prompt count`)
    };
    return {
      minedAreas: goals.areas.map(toGoalItem),
      minedAsks: goals.asks.map(toGoalItem),
      currentPeriod,
      pastPeriods: (goalHistory ?? []).map((list2) => toPastPeriod(list2, generatedYear)),
      goalsReadError: null,
      goalsRun: { label: OWNER_GOALS_SKILL, lastRunAt: formatDateTime(generatedAt), lastRunAtIso: isoOf(generatedAt), deviceName: THIS_COMPUTER.name.toLowerCase() }
    };
  } catch (error) {
    return { ...NO_GOALS, goalsReadError: error instanceof Error ? error.message : String(error) };
  }
}
var REQUEST_PROGRESS_SKILL = "request-progress";
var RULE_SOURCES = { "request-progress": "request-progress", "owner-goals": "owner-goals", you: "you" };
var QUOTE_KINDS = ["directive", "correction", "praise", "frustration"];
var DAY_MS = 864e5;
function toOwnerRule(rule, now) {
  const source = RULE_SOURCES[rule.source];
  if (!source) throw new Error(`Rule "${rule.then}" has an unknown source: ${rule.source}`);
  const latest = Date.parse(rule.latestAt ?? "");
  const quotes = rule.quotes.map((quote2) => {
    const at = Date.parse(quote2.at ?? "");
    return { at: Number.isFinite(at) ? formatDateTime(at) : null, ...Number.isFinite(at) ? { atIso: isoOf(at) } : {}, quote: quote2.quote, kind: QUOTE_KINDS.includes(quote2.kind) ? quote2.kind : "directive", where: "prompt" };
  });
  const savedAt = Date.parse(rule.savedAt ?? "");
  const records = [
    ...quotes.map((quote2) => ({ kind: "Prompt", label: `Your prompt: “${cleanText(quote2.quote, 60)}”`, at: quote2.at, ...quote2.atIso ? { atIso: quote2.atIso } : {}, fact: "your-prompt", said: quote2.quote })),
    ...source === "request-progress" ? [{ kind: "Review", label: "request-progress · build story", at: Number.isFinite(latest) ? formatDateTime(latest) : null, ...Number.isFinite(latest) ? { atIso: isoOf(latest) } : {}, fact: "build-story" }] : [],
    ...Number.isFinite(savedAt) ? [{ kind: "Instructions", label: source === "you" ? "Written in My Rules on this computer" : "Saved in My Rules on this computer", at: formatDateTime(savedAt), atIso: isoOf(savedAt), fact: source === "you" ? "written-here" : "saved-here" }] : []
  ];
  const replacedAt = Date.parse(rule.replacedAt ?? "");
  return {
    id: rule.ruleId,
    scopeId: rule.scopeId,
    setBy: rule.setBy,
    when: rule.when,
    then: rule.then,
    quotes,
    quotesOmitted: rule.quotesOmitted ?? 0,
    timesSeen: rule.timesSeen,
    latestAt: Number.isFinite(latest) ? formatRecordTime(latest, now) : null,
    ...Number.isFinite(latest) ? { latestAtIso: isoOf(latest) } : {},
    // Only orders rules by strength; an unrecorded date counts as a year old rather than as recent.
    latestDaysAgo: Number.isFinite(latest) ? Math.max(0, (now - latest) / DAY_MS) : 365,
    source,
    status: rule.status,
    replacedBy: rule.replacedBy ? { ruleId: rule.replacedBy, at: Number.isFinite(replacedAt) ? formatRecordTime(replacedAt, now) : null, ...Number.isFinite(replacedAt) ? { atIso: isoOf(replacedAt) } : {} } : void 0,
    records
  };
}
function toRulesModel(snapshot, now) {
  const learning = snapshot.rulesLearning ?? null;
  const writtenAt = Date.parse(learning?.writtenAt ?? "");
  const progressRun = Number.isFinite(writtenAt) ? { label: REQUEST_PROGRESS_SKILL, lastRunAt: formatDateTime(writtenAt), lastRunAtIso: isoOf(writtenAt), deviceName: THIS_COMPUTER.name.toLowerCase() } : null;
  const base = {
    ruleScopes: snapshot.ruleScopes ?? [],
    rulesLearning: learning ? { preferencesFound: learning.preferencesFound, newSuggestions: learning.newSuggestions, reviewsRead: learning.reviewsRead } : null,
    rulesFile: snapshot.rulesFile ?? null,
    progressRun
  };
  try {
    const rules = (snapshot.rules ?? []).map((rule) => toOwnerRule(rule, now));
    const missingScope = rules.find((rule) => !base.ruleScopes.some((scope) => scope.id === rule.scopeId));
    if (missingScope) throw new Error(`Rule "${missingScope.then}" is in a scope the worker did not list: ${missingScope.scopeId}`);
    return { ...base, rules, rulesReadError: null };
  } catch (error) {
    return { ...base, rules: [], rulesReadError: error instanceof Error ? error.message : String(error) };
  }
}
function toAutoRefresh(raw) {
  if (!raw) return null;
  const finished = Date.parse(raw.finishedAt ?? "");
  return {
    state: raw.state,
    finishedAt: Number.isFinite(finished) ? formatDateTime(finished) : null,
    error: raw.state === "failed" || raw.state === "waiting-for-agent" ? raw.error?.trim() || null : null,
    ...Number.isFinite(finished) ? { finishedAtIso: new Date(finished).toISOString() } : {}
  };
}
function toBuildStory(story, now) {
  const blocks = (story?.narrative ?? "").split(/\n\s*\n/).map((block) => block.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim()).filter(Boolean);
  const recap = blocks.find((block) => !block.startsWith("#"));
  if (!recap) return null;
  const paragraphs = blocks.map((block) => block.replace(/^#+\s*/, ""));
  const chapters = [];
  for (const block of blocks) {
    if (block.startsWith("#")) chapters.push({ heading: block.replace(/^#+\s*/, ""), paragraphs: [] });
    else if (chapters.length) chapters[chapters.length - 1].paragraphs.push(block);
    else chapters.push({ heading: null, paragraphs: [block] });
  }
  const writtenAt = Date.parse(story?.writtenAt ?? "");
  const written = Number.isFinite(writtenAt);
  return { recap, paragraphs, writtenAt: written ? formatRecordTime(writtenAt, now) : null, ...written ? { writtenAtIso: new Date(writtenAt).toISOString() } : {}, chapters };
}
function toWorkModel(snapshot, now) {
  if (!Array.isArray(snapshot?.humanRequests) || typeof snapshot.source?.connected !== "boolean") {
    throw new Error("The work view has no humanRequests list or no source health");
  }
  const requests = [];
  const requestReadErrors = [];
  const { goalsRun, minedAreas, minedAsks, ...goalsModel } = toGoalsModel(snapshot.goals, snapshot.goalHistory);
  const { focusAreas, otherAsks } = toFocusModel(snapshot.focusAreas, minedAreas, minedAsks);
  const resolveArea = createFocusAreaResolver(focusAreas);
  for (const raw of snapshot.humanRequests) {
    try {
      requests.push(toRequest(raw, snapshot.agents, now, resolveArea));
    } catch (error) {
      requestReadErrors.push({
        requestId: raw.id,
        title: raw.humanCopy?.title?.trim() || null,
        reason: error instanceof Error ? error.message : String(error),
        // Linked only to a record the evidence route serves (one of its kinds), so the card never links a route that is not there.
        evidenceHref: raw.original?.url && routeKindOf(raw.original.url) ? raw.original.url : null
      });
    }
  }
  const { progressRun, ...rulesModel } = toRulesModel(snapshot, now);
  const parents = subagentParents(snapshot.agents);
  const mappedAgents = snapshot.agents.map((agent) => toAgent(agent, parents.get(agent.id)));
  const sessionShortIds = sessionsThatTellAgentsApart(snapshot.agents, mappedAgents);
  const agents = mappedAgents.map((agent) => sessionShortIds.has(agent.id) ? { ...agent, sessionShortId: sessionShortIds.get(agent.id) } : agent);
  if (requests.some((request) => request.agentId === UNRECORDED_AGENT.id)) agents.push(UNRECORDED_AGENT);
  return {
    sourceKind: "local",
    requests,
    requestReadErrors,
    agents,
    devices: [THIS_COMPUTER],
    people: [...new Set(requests.map((request) => request.askedBy))],
    unlinkedWorkCount: Array.isArray(snapshot.unlinkedWork) ? snapshot.unlinkedWork.length : 0,
    sourceHealth: { connected: snapshot.source.connected, error: snapshot.source.error },
    ...snapshot.sharedState ? { sharedState: snapshot.sharedState } : {},
    ...goalsModel,
    focusAreas,
    otherAsks,
    ...rulesModel,
    buildStory: toBuildStory(snapshot.story?.story ?? null, now),
    lastRuns: { goals: goalsRun, progress: progressRun },
    refresh: toAutoRefresh(snapshot.refresh ?? null)
  };
}

// src/ui/my-work/src/lib/deliverables.ts
function isCardDeliverable(product) {
  return product.deliverable === true || !["Commit", "Branch"].includes(product.kind);
}

// src/services/work-view/overview.ts
var DETAIL_REVISION_HEX_LENGTH = 24;
function detailRevision(request, raw) {
  return createHash7("sha256").update(JSON.stringify([
    request.contentFingerprint,
    request.conversations,
    raw?.humanCopy,
    raw?.progress,
    raw?.activity,
    raw?.workstreams,
    raw?.workProduct
  ])).digest("hex").slice(0, DETAIL_REVISION_HEX_LENGTH);
}
function cardSuggestion(suggestion) {
  if (!suggestion) return void 0;
  const { confidence: _confidence, ...onTheCard } = suggestion;
  return onTheCard;
}
function compactRequest(request, raw) {
  const products = request.workProduct.filter(isCardDeliverable);
  const {
    workstreams: _workstreams,
    granular: _granular,
    conversations: _conversations,
    prompts: _prompts,
    story: _story,
    evidence: _evidence,
    storyNarrative: _storyNarrative,
    terminal: _terminal,
    followUps: _followUps,
    review: _review,
    suggestion,
    canMoveFocus,
    askedBy,
    ...card
  } = request;
  const terminal = request.title ? [] : request.terminal.slice(-4);
  const { history, ...progress } = request.progress;
  const review = request.review && (() => {
    const { conflict, pending, legacy, ...state } = request.review;
    return { ...state, ...conflict ? { conflict } : {}, ...pending ? { pending } : {}, ...legacy ? { legacy } : {} };
  })();
  return {
    ...card,
    // Readers restore these two defaults (expandWorkViewOverview).
    ...canMoveFocus === false ? {} : { canMoveFocus },
    ...askedBy === SOLO_REQUESTER ? {} : { askedBy },
    // No readings has no chart history. The field is already optional on the
    // wire; readers restore the empty array for the complete UI model.
    progress: history?.length ? request.progress : progress,
    ...review ? { review } : {},
    ...suggestion ? { suggestion: cardSuggestion(suggestion) } : {},
    detailLoaded: false,
    detailRevision: detailRevision(request, raw),
    detailCounts: { workProduct: products.length },
    ...terminal.length ? { terminal } : {},
    ...request.followUps.length ? { followUps: request.followUps } : {},
    workProduct: products.slice(0, 3)
  };
}
function overviewFromModel(snapshot, now, model, rawRequests) {
  return {
    version: 1,
    ...snapshot.sync ? { sync: snapshot.sync } : {},
    revision: String(snapshot.revision),
    generatedAt: new Date(now).toISOString(),
    source: {
      ...snapshot.source,
      kind: typeof snapshot.source.kind === "string" ? snapshot.source.kind : "claude-mem-recorded-agent-activity",
      error: typeof snapshot.source.error === "string" ? snapshot.source.error : null,
      lastCheckedAt: typeof snapshot.source.lastCheckedAt === "string" ? snapshot.source.lastCheckedAt : null
    },
    model: { ...model, requests: model.requests.map((request) => compactRequest(request, rawRequests.get(request.id))) }
  };
}
function projectWorkView(snapshot, now) {
  const raw = snapshot;
  const model = toWorkModel(raw, now);
  const requests = new Map(raw.humanRequests.map((r) => [r.id, r]));
  return {
    overview: overviewFromModel(snapshot, now, model, requests),
    details: model.requests.map((request) => ({
      id: request.id,
      detail: {
        version: 1,
        revision: String(snapshot.revision),
        request: {
          ...request,
          detailLoaded: true,
          detailRevision: detailRevision(request, requests.get(request.id))
        }
      }
    }))
  };
}

// src/services/work-view/cloud-renderer-core.mjs
init_work_state_reduce();

// src/services/work-view/review-fingerprint.ts
import { createHash as createHash8 } from "node:crypto";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}
var priorFingerprintFields = ["id", "original", "explicitRequestText", "scopeUpdates", "title", "projects", "agentIds", "items", "lifecycle", "afterShip", "shipEstimate", "stageSourceText", "sourceContentHashes"];
var fingerprintFields = [...priorFingerprintFields, "sourceProductHash"];
function fingerprintOf(request, fields) {
  const content = Object.fromEntries(fields.map((key) => [key, request[key]]));
  return createHash8("sha256").update(JSON.stringify(canonical(content))).digest("hex");
}
function contentFingerprint(request) {
  return fingerprintOf(request, fingerprintFields);
}

// src/services/work-view/review-readiness.ts
var READY_FOR_CHECK_LIFECYCLE_STATUSES = [
  "done",
  "completed",
  "complete",
  "shipped",
  "delivered",
  "needs-review",
  "review",
  "in-review",
  "awaiting-review",
  "ready-for-review"
];
function reviewIsNewerThanLifecycle2(review, lifecycle) {
  if (!lifecycle?.explicit || !lifecycle.atEpoch) return true;
  const reviewedAt = Date.parse(review.checkedAt ?? "");
  return Number.isFinite(reviewedAt) && reviewedAt >= lifecycle.atEpoch;
}
function isReportedReadyForCheck(request, now = Date.now()) {
  const { lifecycle, progress } = request;
  if (progress?.percent === 100 && reviewIsNewerThanLifecycle2(progress, lifecycle)) return true;
  if (request.items?.length) {
    const itemStatus = normalizeRequestStatus({
      items: request.items,
      checked: false,
      lifecycle: lifecycle?.explicit ? { status: lifecycle.status ?? null, explicit: true, complete: lifecycle.complete } : null
    }, now);
    if (itemStatus === "needs-review" || itemStatus === "done") return true;
  }
  if (!lifecycle?.explicit) return false;
  const status = String(lifecycle.status ?? "").trim().toLowerCase().replace(/[_ ]/g, "-");
  return lifecycle.complete === true || READY_FOR_CHECK_LIFECYCLE_STATUSES.includes(status);
}

// src/services/work-view/cloud-renderer-core.mjs
init_request_projection();
init_request_groups();
init_session_project();

// src/services/work-view/shared-projection.mjs
init_request_projection();
init_work_product();

// src/services/work-view/human-copy.mjs
import { createHash as createHash9 } from "node:crypto";
var HUMAN_COPY_MAX_CHARS = 18e3;
function text4(value, max) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…` : clean;
}
function sourceRef(value) {
  if (!value || typeof value !== "object") return null;
  if (Object.hasOwn(value, "stableIdentity")) return value.stableIdentity;
  if (value.sourceIdentity) return value.sourceIdentity;
  if (value.identity) return value.identity;
  const kind = typeof (value.kind ?? value.source) === "string" ? value.kind ?? value.source : null;
  const id = value.id ?? value.sourceId;
  if (!kind || !["string", "number"].includes(typeof id)) return null;
  return { kind: text4(kind, 60), id };
}
function refsFor(stream) {
  const refs = /* @__PURE__ */ new Map();
  for (const item of stream.items ?? []) for (const value of item.sourceRefs ?? []) {
    const ref = sourceRef(value);
    if (ref) refs.set(JSON.stringify(ref), ref);
    if (refs.size === 6) return [...refs.values()];
  }
  return [...refs.values()];
}
function itemContent(item, caps) {
  return {
    status: text4(item.status, 40),
    title: text4(item.title, caps.title),
    progress: text4(item.progress?.text, caps.detail),
    next: text4(item.nextStep?.text, caps.detail),
    outcome: text4(item.outcome?.text, caps.detail)
  };
}
function createHumanCopyInput(request) {
  if (!request || typeof request !== "object" || !request.original || typeof request.original.text !== "string") throw new TypeError("A recorded original request is required.");
  const streams = (request.workstreams ?? []).map((stream) => ({ ...stream, id: stream.stableId ?? stream.id }));
  if (streams.some((stream) => typeof stream?.id !== "string" || !stream.id) || new Set(streams.map((stream) => stream.id)).size !== streams.length) throw new TypeError("Workstreams require unique nonempty string ids.");
  streams.sort((a, b) => a.id.localeCompare(b.id));
  let itemLimit = 8, observationLimit = 3, detailCap = 240, titleCap = 160, originalCap = 1600, scopeCap = 320, refLimit = 6;
  const build = () => ({
    version: 1,
    original: { text: text4(request.original.text, originalCap), sourceRef: sourceRef(request.original) },
    recordedStage: text4(request.stageSourceText, 300),
    requestLifecycle: request.lifecycle?.explicit === true ? { status: text4(request.lifecycle.status, 40), field: text4(request.lifecycle.field, 40) } : null,
    scopeUpdates: (request.scopeUpdates ?? []).slice(-6).map((update) => ({ text: text4(update.text, scopeCap), sourceRef: sourceRef({ ...update, source: "user-prompt" }) })).filter((update) => update.text),
    workstreams: streams.map((stream) => ({
      id: stream.id,
      sourceRefs: refsFor(stream).slice(0, refLimit),
      currentItems: (stream.items ?? []).slice(0, itemLimit).map((item) => itemContent(item, { title: titleCap, detail: detailCap })),
      observations: (stream.activity ?? []).filter((activity) => activity.kind === "observation").slice(0, observationLimit).map((activity) => ({
        title: text4(activity.title, titleCap),
        summary: text4(activity.detail, detailCap),
        sourceRef: sourceRef(activity.sourceRef)
      }))
    }))
  });
  let input = build();
  while (JSON.stringify(input).length > HUMAN_COPY_MAX_CHARS) {
    if (detailCap > 80) {
      detailCap = Math.max(80, Math.floor(detailCap * 0.7));
      titleCap = Math.max(80, Math.floor(titleCap * 0.8));
    } else if (itemLimit > 1) itemLimit--;
    else if (observationLimit > 0) observationLimit--;
    else if (scopeCap > 80 || originalCap > 400) {
      scopeCap = 80;
      originalCap = 400;
    } else if (refLimit > 1) refLimit--;
    else throw new RangeError("Workstream identities exceed the bounded human-copy input budget.");
    input = build();
  }
  return input;
}
function humanCopyFingerprint(input) {
  const meaningful2 = {
    version: input.version,
    original: input.original.text,
    recordedStage: input.recordedStage || "",
    requestLifecycle: input.requestLifecycle ?? null,
    scopeUpdates: input.scopeUpdates.map((update) => update.text),
    workstreams: input.workstreams.map((stream) => ({
      id: stream.id,
      currentItems: [...stream.currentItems].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      observations: stream.observations.map(({ title, summary }) => ({ title, summary })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    }))
  };
  return createHash9("sha256").update(JSON.stringify(meaningful2)).digest("hex");
}
function exactKeys(object3, keys, label) {
  if (!object3 || typeof object3 !== "object" || Array.isArray(object3) || Object.keys(object3).length !== keys.length || keys.some((key) => !Object.hasOwn(object3, key))) throw new TypeError(`${label} has an invalid shape.`);
}
function copyText(value, limit, label, empty = false) {
  if (typeof value !== "string" || !empty && !value.trim() || value.length > limit) throw new TypeError(`${label} must be ${empty ? "0" : "1"}–${limit} characters.`);
  return value.trim();
}
function validateHumanCopy(output, input) {
  exactKeys(output, ["title", "summary", "next", "workstreams", ...Object.hasOwn(output || {}, "stage") ? ["stage"] : []], "Human copy");
  if (!Array.isArray(output.workstreams)) throw new TypeError("workstreams must be an array.");
  const wanted = new Set(input.workstreams.map((stream) => stream.id));
  if (output.workstreams.length !== wanted.size) throw new TypeError("Every supplied workstream must appear exactly once.");
  const seen = /* @__PURE__ */ new Set();
  const workstreams = output.workstreams.map((stream) => {
    exactKeys(stream, ["id", "title", "summary"], "Workstream copy");
    if (!wanted.has(stream.id) || seen.has(stream.id)) throw new TypeError("Unknown or duplicate workstream id.");
    seen.add(stream.id);
    return { id: stream.id, title: copyText(stream.title, 90, "Workstream title"), summary: copyText(stream.summary, 200, "Workstream summary") };
  });
  return { title: copyText(output.title, 100, "Request title"), summary: copyText(output.summary, 240, "Request summary"), next: copyText(output.next, 160, "Next step", true), ...Object.hasOwn(output, "stage") ? { stage: copyText(output.stage, 40, "Stage", true) } : {}, workstreams };
}

// src/services/work-view/shared-projection.mjs
import { isIP } from "node:net";
import { basename as basename6 } from "node:path";

// src/services/work-view/shared-review-value.mjs
var SHARED_REVIEW_VERSION = 2;
var SHARED_REVIEW_KIND = "review";
var isSharedReviewKey = (value) => typeof value === "string" && /^sr2_[a-f0-9]{64}$/.test(value);
function isSharedReviewValue(kind, key, value, deleted = false) {
  if (kind !== SHARED_REVIEW_KIND || !isSharedReviewKey(key)) return false;
  if (deleted) return true;
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 5 && value.version === SHARED_REVIEW_VERSION && value.requestId === key && /^[a-f0-9]{64}$/.test(value.fingerprint ?? "") && typeof value.checked === "boolean" && Number.isSafeInteger(value.checkedAtEpoch) && value.checkedAtEpoch >= 0 && Number.isFinite(new Date(value.checkedAtEpoch).getTime()));
}

// src/services/work-view/shared-projection.mjs
var TABLES = { observation: "observations", summary: "session_summaries", prompt: "user_prompts", "work-state": "work_state_entries" };
var SOURCE_KINDS = { "user-prompt": "prompt", "session-summary-request": "summary", "session-summary": "summary", "session-initial-request": "session", "work-state": "work-state", observation: "observation" };
var values = (shared) => [...shared?.records?.values?.() ?? []];
var binaryOrder = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var pick = (value, names) => Object.fromEntries(names.filter((key) => value?.[key] !== void 0).map((key) => [key, value[key]]));
var object2 = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
var conversation = (value) => {
  try {
    const key = JSON.parse(value);
    return Array.isArray(key) && key.length === 3 && key[0] === "conversation" && key.slice(1).every((part) => typeof part === "string" && part.length > 0);
  } catch {
    return false;
  }
};
var originRef = (ref) => object2(ref) && Object.hasOwn(TABLES, ref.kind) && typeof ref.device === "string" && ref.device.length > 0 && /^\d+$/.test(ref.row ?? "");
function sharedPublishedUrl(value) {
  const normalized = safeWebUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host) || !host.includes(".") || /(?:^|\.)(?:localhost|local|lan|internal|home|test|invalid)$/.test(host)) return null;
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (/(?:^|\/)(?:api\/(?:media|work-view|deliverables)|private)(?:\/|$)/i.test(path) || /\/storage\/v1\/object\/(?:sign|authenticated)(?:\/|$)/i.test(path)) return null;
  const credentialName = (name) => {
    const words = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const compact = words.replace(/_/g, "");
    return /(?:^|_)(?:token|signature|sig|credential|secret|password|key|auth|authorization|policy|expires|expiry|expiration)(?:$|_)/.test(words) || /^(?:xamz|xgoog|awsaccesskeyid$|googleaccessid$|accesskeyid$)/.test(compact) || /(?:token|signature|credential|secret|password|authorization|policy|expires|expiry|expiration|(?:api|access|private|signing|client|service|account|session)key)$/.test(compact);
  };
  const fragments = new URLSearchParams(url.hash.slice(1));
  for (const params of [url.searchParams, fragments]) for (const [name, parameter] of params) {
    if (credentialName(name) || /^(?:path|file|filename|source)$/i.test(name) && sharedProjectKey(parameter) === null) return null;
  }
  return normalized;
}
function sharedProjectKey(value) {
  if (typeof value !== "string" || value.length > 2e3) return null;
  if (/^(?:[\\/]|~(?:[\\/]|$)|[a-z]:|\.{1,2}[\\/]|file:|\$(?:HOME|USERPROFILE)(?:[\\/]|$)|\$\{(?:HOME|USERPROFILE)\}|%(?:HOME|USERPROFILE)%)/i.test(value.trim()) || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return null;
  return value;
}
var forbiddenKeys = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype", "path", "bucketPath", "sourcePath", "bucket_path", "source_path", "pid", "lock", "objectKey", "object_key", "tool_input", "tool_response", "toolInput", "toolResponse", "raw", "token", "apiKey", "api_key", "authorization"]);
var string = (value, max = 12e3) => typeof value === "string" && value.length <= max;
var optional = (value, check) => value == null || check(value);
var date = (value) => string(value, 40) && Number.isFinite(Date.parse(value));
var epoch = (value) => typeof value === "number" && value >= 0 && Number.isFinite(new Date(value).getTime());
var list = (value, check, max = 512) => Array.isArray(value) && value.length <= max && value.every(check);
var preferenceKinds = ["directive", "correction", "praise", "frustration"];
var quote = (value) => object2(value) && string(value.quote, 4e3) && optional(value.at, date);
var preference = (value) => object2(value) && string(value.preference, 2e3) && optional(value.kind, (kind) => preferenceKinds.includes(kind)) && optional(value.quotes, (quotes) => list(quotes, quote, 100)) && optional(value.quote, (quote2) => string(quote2, 4e3)) && optional(value.at, date);
function safeTree(value, depth = 0) {
  if (depth > 16) return false;
  if (value == null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => safeTree(item, depth + 1));
  return object2(value) && Object.entries(value).every(([key, item]) => !forbiddenKeys.has(key) && safeTree(item, depth + 1) && (!["url", "fileUrl"].includes(key) || optional(item, (url) => Boolean(sharedPublishedUrl(url)))) && (!["project", "projectRoot"].includes(key) || optional(item, (project) => sharedProjectKey(project) !== null)));
}
var evidence = (value) => list(value, (item) => typeof item === "string" || object2(item), 100);
var outcome = (value) => object2(value) && ["landed", "usage", "value"].every((key) => optional(value[key], (item) => object2(item) && string(item.text, 4e3) && optional(item.evidence, evidence))) && ["regressions", "changes"].every((key) => optional(value[key], (items) => list(items, (item) => object2(item) && optional(item.text, (text5) => string(text5, 4e3)) && optional(item.what, (text5) => string(text5, 4e3)) && optional(item.why, (text5) => string(text5, 4e3)), 100)));
var gitSha = (value) => typeof value === "string" && /^[a-f0-9]{7,64}$/i.test(value);
var gitBranch = (value) => string(value, 1024) && value.length > 0 && !value.startsWith("/") && !/[\s\\\x00-\x1f\x7f~^:?*\[]|\.\.|@\{/.test(value);
var gitRepo = (value) => string(value, 256) && /^[\w.-]+\/[\w.-]+$/.test(value) && !value.split("/").some((part) => part === "." || part === "..");
var sharedProduct = (value) => object2(value) && string(value.kind, 80) && string(value.title, 2e3) && optional(value.atEpoch, epoch) && optional(value.sha, gitSha) && optional(value.branch, gitBranch) && optional(value.repo, gitRepo) && optional(value.heads, (heads) => list(heads, gitSha, 100)) && (value.availability === "origin-only" ? /^local_[a-f0-9]{64}$/.test(value.productId ?? "") && string(value.originDeviceId, 2e3) && value.originDeviceId.length > 0 && value.url == null && value.fileUrl == null : value.availability == null && Boolean(sharedPublishedUrl(value.url)));
function isSharedProjectionValue(kind, key, value, deleted = false, writer = void 0) {
  if (kind === "review") return isSharedReviewValue(kind, key, value, deleted);
  const groupKey = /^g_[a-f0-9]{12}$/.test(key);
  const knownKey = kind === "group" || kind === "progress" ? groupKey : kind === "story" ? key === "current" : ["ignored", "provenance"].includes(kind) ? conversation(key) : ["refresh", "copy", "exclusion"].includes(kind);
  if (!knownKey) return false;
  if (writer !== void 0 && kind === "refresh" && key !== writer) return false;
  if (writer !== void 0 && kind === "exclusion") {
    let identity;
    try {
      identity = JSON.parse(key);
    } catch {
      return false;
    }
    if (!originRef(identity) || identity.kind !== "prompt" || identity.device !== writer) return false;
  }
  if (deleted) return true;
  if (!safeTree(value)) return false;
  if (kind === "ignored") return string(value, 48e3);
  if (!object2(value)) return false;
  if (kind === "group") return object2(value.group) && string(value.group.title, 120) && value.group.title.trim().length > 0 && conversation(value.group.anchor) && list(value.members, conversation) && value.members.length > 0 && new Set(value.members).size === value.members.length && value.members.includes(value.group.anchor) && optional(value.group.projectRoot, (root) => string(root, 2e3)) && optional(value.group.rootNamed, (root) => typeof root === "boolean") && optional(value.group.product, (product) => string(product, 48e3)) && optional(value.group.anchorAsk, (ask) => object2(ask) && string(ask.text, 2e3) && optional(ask.atEpoch, epoch)) && optional(value.group.links, (links) => list(links, (link) => object2(link) && string(link.kind, 80) && string(link.evidence, 48e3) && list(link.conversations, conversation))) && optional(value.suggestions, (suggestions) => object2(suggestions) && Object.entries(suggestions).every(([candidate, suggestion]) => conversation(candidate) && object2(suggestion) && suggestion.requestId === key && optional(suggestion.confidence, (score) => typeof score === "number" && score >= 0 && score <= 1) && optional(suggestion.evidence, (evidence2) => string(evidence2, 4e3)) && optional(suggestion.status, (status) => ["open", "joined", "declined", "dismissed"].includes(status))));
  if (kind === "progress") return value.groupId === key && ["shipped", "in-progress", "stalled", "abandoned", "unknown"].includes(value.state) && Number.isInteger(value.percent) && value.percent >= 0 && value.percent <= 100 && ["summary", "narrative", "title"].every((key2) => optional(value[key2], (text5) => string(text5, 12e3))) && ["startedAt", "shippedAt", "lastActivityAt", "reviewedThrough", "checkedAt", "changedAt"].every((key2) => optional(value[key2], date)) && optional(value.milestones, (milestones) => list(milestones, (item) => object2(item) && string(item.text, 4e3) && optional(item.at, date) && optional(item.evidence, evidence), 100)) && optional(value.preferences, (preferences) => list(preferences, preference, 100)) && optional(value.readings, (readings) => list(readings, (item) => object2(item) && date(item.at) && Number.isInteger(item.percent) && item.percent >= 0 && item.percent <= 100, 100)) && optional(value.reviewedConversations, (keys) => list(keys, conversation)) && optional(value.coercedFields, (fields) => list(fields, (field) => string(field, 200))) && optional(value.evidence, evidence) && optional(value.outcome, outcome);
  if (kind === "story") return optional(value.narrative, (narrative) => string(narrative, 48e3)) && list(value.preferences, preference, 100) && optional(value.writtenAt, date) && optional(value.generatedAt, (at) => date(at) || epoch(at)) && optional(value.source, (source) => string(source, 80));
  if (kind === "refresh") return value.originDeviceId === key && ["idle", "running", "ok", "failed", "waiting-for-agent"].includes(value.state) && ["reason", "agent", "result"].every((key2) => optional(value[key2], (text5) => string(text5, 12e3))) && ["startedAt", "finishedAt", "checkedAt"].every((key2) => optional(value[key2], date));
  if (kind === "exclusion") {
    let identity;
    try {
      identity = JSON.parse(key);
    } catch {
      return false;
    }
    return originRef(value.ref) && value.ref.kind === "prompt" && ["kind", "device", "row"].every((field) => identity?.[field] === value.ref[field]) && (value.conversation == null || conversation(value.conversation)) && (value.opening == null || typeof value.opening === "boolean");
  }
  if (kind === "provenance") return conversationKey(value.session) === key && object2(value.session) && ["project", "platform_source", "content_session_id", "memory_session_id", "custom_title", "status"].every((key2) => optional(value.session[key2], (text5) => string(text5, 2e3))) && optional(value.session.user_prompt, (prompt) => string(prompt, 1200)) && ["started_at_epoch", "completed_at_epoch"].every((key2) => optional(value.session[key2], epoch)) && list(value.attributions, (item) => object2(item) && originRef(item.work) && item.work.kind === "work-state" && optional(item.agentId, (id) => string(id, 256)) && optional(item.agentType, (type) => string(type, 256)) && optional(item.promptNumber, (number) => Number.isInteger(number) && number >= 0) && optional(item.atEpoch, epoch)) && list(value.products, (item) => sharedProduct(item) && (item.availability !== "origin-only" || writer === void 0 || item.originDeviceId === writer)) && list(value.launches, (item) => object2(item) && string(item.agent_id, 256) && optional(item.status, (status) => string(status, 80)) && optional(item.is_async, (flag) => typeof flag === "boolean" || flag === 0 || flag === 1) && optional(item.description, (text5) => string(text5, 160)) && optional(item.created_at_epoch, epoch)) && list(value.activity, (item) => object2(item) && optional(item.agent_id, (id) => string(id, 256)) && optional(item.last_epoch, epoch));
  if (kind === "copy") {
    if (!/^[a-f0-9]{64}$/.test(value.fingerprint ?? "") || !object2(value.copy) || !optional(value.generatedAt, epoch)) return false;
    try {
      validateHumanCopy(value.copy, { workstreams: value.copy.workstreams });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
function get(database, sql, args) {
  try {
    return database.prepare(sql).get(...args);
  } catch (error) {
    if (/no such (table|column)/i.test(String(error.message))) return null;
    throw error;
  }
}
function stableEvidenceRef(database, kind, id, deviceId) {
  if (id == null) return null;
  if (database.stableEvidenceRef) return database.stableEvidenceRef(kind, id);
  if (kind === "session") {
    const row2 = get(database, "SELECT platform_source, content_session_id FROM sdk_sessions WHERE id = ?", [id]);
    const key = conversationKey(row2);
    return key ? { kind, conversation: key } : null;
  }
  const table = TABLES[kind];
  if (!table) return null;
  let row;
  try {
    row = database.prepare(`SELECT origin_device_id, origin_local_id FROM ${table} WHERE id = ?`).get(id);
  } catch (error) {
    if (!/no such (table|column)/i.test(String(error.message))) throw error;
    row = get(database, `SELECT id FROM ${table} WHERE id = ?`, [id]);
  }
  if (!row) return null;
  const origin = row.origin_device_id ?? deviceId;
  return origin ? { kind, device: origin, row: String(row.origin_local_id ?? id) } : null;
}
function resolveEvidenceRef(database, ref, deviceId) {
  if (!ref || typeof ref !== "object") return null;
  if (database.resolveEvidenceRef) return database.resolveEvidenceRef(ref);
  if (ref.kind === "session") {
    let tuple;
    try {
      tuple = JSON.parse(ref.conversation);
    } catch {
      return null;
    }
    if (!Array.isArray(tuple) || tuple[0] !== "conversation" || tuple.length !== 3) return null;
    return get(database, "SELECT id FROM sdk_sessions WHERE platform_source = ? AND content_session_id = ? ORDER BY id LIMIT 1", tuple.slice(1))?.id ?? null;
  }
  const table = TABLES[ref.kind];
  if (!table || typeof ref.device !== "string" || !/^\d+$/.test(ref.row ?? "")) return null;
  if (ref.device === deviceId) {
    const local = get(database, `SELECT id FROM ${table} WHERE id = ? AND origin_device_id IS NULL`, [ref.row]);
    if (local) return local.id;
  }
  return get(database, `SELECT id FROM ${table} WHERE origin_device_id = ? AND origin_local_id = ?`, [ref.device, ref.row])?.id ?? null;
}
function fileProductIdentity(database, product, deviceId) {
  if (!database) return null;
  const source = product.sourceRef;
  if (!source || !Number.isSafeInteger(source.id) || source.id < 1) return null;
  const ref = source.kind === "deliverable" ? { kind: source.kind, device: deviceId, row: String(source.id) } : stableEvidenceRef(database, source.kind, source.id, deviceId);
  const productId = ref && localProductId({ ...ref, index: source.index ?? 0 });
  return productId ? { productId, originDeviceId: ref.device } : null;
}
function localFileMetadata(database, product, deviceId) {
  if (!product.path && !product.bucketPath) return null;
  const identity = fileProductIdentity(database, product, deviceId);
  if (!identity) return null;
  return {
    kind: product.kind,
    title: basename6(product.path ?? product.bucketPath),
    ...identity,
    availability: "origin-only",
    atEpoch: product.atEpoch ?? null
  };
}
function localWorkValue(database, value, deviceId) {
  if (Array.isArray(value)) return value.map((item) => localWorkValue(database, item, deviceId));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "sourceIdentity") {
      result.sourceId = resolveEvidenceRef(database, item, deviceId);
      result.sourceIdentity = item;
    } else if (key === "identity") {
      result.id = resolveEvidenceRef(database, item, deviceId);
      result.identity = item;
    } else if (key === "urlRef" || key === "fileUrlRef") {
      const id = resolveEvidenceRef(database, item, deviceId);
      result[key === "urlRef" ? "url" : "fileUrl"] = id == null ? null : `/api/work-view/evidence/${item.kind}/${id}`;
    } else result[key] = localWorkValue(database, item, deviceId);
  }
  return result;
}
var emptyLedger = () => ({ groups: { version: 1, updatedAt: null, conversations: {}, groups: {}, ignored: {}, suggestions: {} }, progress: {}, story: null, refresh: null, agentWrittenPromptIds: /* @__PURE__ */ new Set() });
var sessionFields = ["project", "platform_source", "content_session_id", "memory_session_id", "user_prompt", "custom_title", "status", "started_at_epoch", "completed_at_epoch"];
function applySharedProjection(database, shared, { ledger = null, records = {}, deviceId = "" } = {}) {
  const next = {
    ...emptyLedger(),
    ...ledger,
    groups: { ...emptyLedger().groups, ...ledger?.groups, groups: { ...ledger?.groups?.groups }, conversations: { ...ledger?.groups?.conversations }, ignored: { ...ledger?.groups?.ignored }, suggestions: { ...ledger?.groups?.suggestions } },
    progress: { ...ledger?.progress },
    agentWrittenPromptIds: new Set(ledger?.agentWrittenPromptIds ?? [])
  };
  const copyEntries = /* @__PURE__ */ new Map();
  const excludedOpenings = /* @__PURE__ */ new Set();
  const merged = { ...records, sessions: [...records.sessions ?? []], sharedAttributions: /* @__PURE__ */ new Map(), sharedProducts: [], agentLaunches: [...records.agentLaunches ?? []], agentToolActivity: [...records.agentToolActivity ?? []] };
  const ordered = values(shared).sort((a, b) => {
    const left = BigInt(a.revision ?? "0"), right = BigInt(b.revision ?? "0");
    return left < right ? -1 : left > right ? 1 : binaryOrder(String(a.writer), String(b.writer)) || binaryOrder(a.kind, b.kind) || binaryOrder(a.key, b.key);
  });
  const claims = /* @__PURE__ */ new Map();
  for (const record of ordered) if (record.kind === "group" && !record.deleted && Array.isArray(record.value?.members)) {
    for (const member of record.value.members) {
      if (!claims.has(member)) claims.set(member, []);
      claims.get(member).push(record);
    }
  }
  const membershipConflicts = [...claims].filter(([, records2]) => records2.length > 1).map(([key, records2]) => ({
    kind: "group-membership",
    key,
    revision: records2.at(-1).revision,
    writers: [...new Set(records2.map((record) => record.writer))].sort(binaryOrder),
    groups: records2.map((record) => record.key).sort(binaryOrder),
    selectedGroup: records2.at(-1).key
  })).sort((left, right) => binaryOrder(left.key, right.key));
  const diagnostics = {
    ...shared?.diagnostics ?? { pending: 0, invalid: 0, unsupported: 0, conflicts: [] },
    conflicts: [...shared?.diagnostics?.conflicts ?? [], ...membershipConflicts],
    membershipConflicts
  };
  for (const record of ordered) {
    const value = localWorkValue(database, record.value, deviceId);
    if (record.kind === "group") {
      for (const [key, group] of Object.entries(next.groups.conversations)) if (group === record.key) delete next.groups.conversations[key];
      for (const [key, suggestion] of Object.entries(next.groups.suggestions)) if (suggestion.requestId === record.key) delete next.groups.suggestions[key];
      if (record.deleted) delete next.groups.groups[record.key];
      else if (value?.group && Array.isArray(value.members)) {
        next.groups.groups[record.key] = value.group;
        for (const key of value.members) {
          next.groups.conversations[key] = record.key;
          delete next.groups.ignored[key];
        }
        Object.assign(next.groups.suggestions, value.suggestions ?? {});
      }
    } else if (record.kind === "progress") {
      if (record.deleted) delete next.progress[record.key];
      else next.progress[record.key] = value;
    } else if (record.kind === "ignored") {
      if (record.deleted) delete next.groups.ignored[record.key];
      else next.groups.ignored[record.key] = value;
    } else if (record.kind === "story" && record.key === "current") next.story = record.deleted ? null : value;
    else if (record.kind === "refresh" && record.writer !== deviceId) {
      if (record.deleted) {
        if (next.refresh?.originDeviceId === record.key) next.refresh = null;
      } else if (!next.refresh || !Number.isFinite(Date.parse(next.refresh.startedAt ?? next.refresh.checkedAt ?? "")) || Date.parse(value.finishedAt ?? value.checkedAt ?? value.startedAt ?? "") > Date.parse(next.refresh.finishedAt ?? next.refresh.checkedAt ?? next.refresh.startedAt ?? "")) next.refresh = value;
    } else if (record.kind === "exclusion") {
      let ref = value?.ref;
      if (!ref) {
        try {
          ref = JSON.parse(record.key);
        } catch {
        }
      }
      const id = resolveEvidenceRef(database, ref, deviceId);
      if (id != null) {
        if (record.deleted) next.agentWrittenPromptIds.delete(id);
        else next.agentWrittenPromptIds.add(id);
      }
      if (!record.deleted && value?.opening && value.conversation) excludedOpenings.add(value.conversation);
    } else if (record.kind === "copy") copyEntries.set(record.key, record.deleted ? { deleted: true } : value);
    else if (record.kind === "provenance" && !record.deleted && value?.session) {
      const key = conversationKey(value.session);
      if (key !== record.key) continue;
      const facts = pick(value.session, sessionFields);
      let session = merged.sessions.find((row) => conversationKey(row) === key);
      if (session) session = record.writer === deviceId ? { ...facts, ...session } : { ...session, ...facts };
      else session = { ...facts, id: `shared:${key}`, sharedOnly: true };
      session.sharedOpeningPrompt = facts.user_prompt ?? null;
      merged.sessions = merged.sessions.filter((row) => conversationKey(row) !== key);
      merged.sessions.push(session);
      for (const attribution of value.attributions ?? []) {
        const id = resolveEvidenceRef(database, attribution.work, deviceId);
        if (id != null) merged.sharedAttributions.set(id, { ...attribution, session_db_id: session.id, memory_session_id: session.memory_session_id, content_session_id: session.content_session_id, agent_id: attribution.agentId, agent_type: attribution.agentType, prompt_number: attribution.promptNumber, created_at_epoch: attribution.atEpoch, shared: true });
      }
      merged.sharedProducts.push({ conversationKey: key, products: (value.products ?? []).filter((product) => sharedProduct(product) && (product.availability !== "origin-only" || product.originDeviceId === record.writer)) });
      for (const launch of value.launches ?? []) if (!merged.agentLaunches.some((row) => conversationKey(row) === key && row.agent_id === launch.agent_id)) merged.agentLaunches.push({ ...launch, platform_source: session.platform_source, content_session_id: session.content_session_id, shared: true });
      for (const activity of value.activity ?? []) if (!merged.agentToolActivity.some((row) => conversationKey(row) === key && row.agent_id === activity.agent_id)) merged.agentToolActivity.push({ ...activity, platform_source: session.platform_source, content_session_id: session.content_session_id });
    }
  }
  const referencedGroups = new Set(Object.values(next.groups.conversations));
  for (const groupId of Object.keys(next.groups.groups)) if (!referencedGroups.has(groupId)) delete next.groups.groups[groupId];
  for (const session of merged.sessions) if ((merged.prompts ?? []).some((prompt) => prompt.session_db_id === session.id && next.agentWrittenPromptIds.has(prompt.id) && (prompt.prompt_number === 1 || prompt.prompt_text === session.user_prompt))) excludedOpenings.add(conversationKey(session));
  merged.sessions = merged.sessions.map((session) => excludedOpenings.has(conversationKey(session)) ? { ...session, user_prompt: null, sharedOpeningPrompt: null } : session);
  merged.prompts = (merged.prompts ?? []).filter((prompt) => !next.agentWrittenPromptIds.has(prompt.id));
  return { ledger: next, records: merged, copyEntries, diagnostics };
}
function decorateSharedView(view, { database = null, deviceId = "", records = {}, copyEntries = /* @__PURE__ */ new Map() } = {}) {
  const agents = new Map((view.agents ?? []).map((agent) => [agent.id, agent]));
  const identity = (value) => {
    if (!value || !database) return;
    const kind = SOURCE_KINDS[value.source] ?? value.kind;
    value.stableIdentity = value.sourceIdentity ?? value.identity ?? stableEvidenceRef(database, kind, value.sourceId ?? value.id, deviceId);
  };
  for (const request of view.humanRequests ?? []) {
    const products = /* @__PURE__ */ new Map();
    for (const product of request.workProduct ?? []) {
      let next = product;
      if (product.path || product.bucketPath) {
        const metadata = localFileMetadata(database, product, deviceId);
        if (metadata) next = metadata.originDeviceId === deviceId ? { ...product, productId: metadata.productId, originDeviceId: deviceId } : { ...metadata, available: false };
      } else if (product.availability === "origin-only") next = { ...product, url: void 0, fileUrl: void 0, available: false };
      const key = next.productId ?? next.url ?? next.path ?? `${next.kind}:${next.title}`;
      const previous = products.get(key);
      if (!previous || previous.availability === "origin-only" && next.availability !== "origin-only") products.set(key, next);
    }
    request.workProduct = [...products.values()];
    identity(request.original);
    for (const update of request.scopeUpdates ?? []) identity(Object.assign(update, { source: "user-prompt" }));
    for (const stream of request.workstreams ?? []) {
      if (stream.id === stream.items?.[0]?.listId) stream.stableId = stream.id;
      else {
        const agent = agents.get(stream.agentIds?.[0]);
        stream.stableId = JSON.stringify(["agent-session", agent?.platformSource ?? "", agent?.contentSessionId ?? "", agent?.agentId ?? ""]);
      }
      for (const item of stream.items ?? []) for (const ref of item.sourceRefs ?? []) identity(ref);
      for (const activity of stream.activity ?? []) identity(activity.sourceRef);
    }
    const copy = copyEntries.get(request.id);
    if (copy?.deleted) request.sharedHumanCopyDisabled = true;
    else if (copy) request.sharedHumanCopy = copy;
  }
  return view;
}

// src/services/work-view/shared-record-store.mjs
init_CanonicalContent();
init_shared_records();

// src/services/work-view/shared-redaction.mjs
init_CanonicalContent();
init_redaction();
init_shared_records();
var TABLE = "local_shared_work_redactions";
function readSharedRedactionReceipts(db) {
  try {
    return new Map(db.prepare(`SELECT * FROM ${TABLE}`).all().map((row) => [String(row.row_id), row]));
  } catch (error) {
    if (/no such table/i.test(String(error.message))) return /* @__PURE__ */ new Map();
    throw error;
  }
}

// src/services/work-view/shared-record-store.mjs
init_logger();
var compareText = (a, b) => a === b ? 0 : a < b ? -1 : 1;
var INVALID_ROW = /* @__PURE__ */ Symbol("invalid shared row");
var SKIPPED_ROW = /* @__PURE__ */ Symbol("not a shared row");
var UNSUPPORTED_ROW = /* @__PURE__ */ Symbol("unsupported shared row");
var SHARED_ROW_SUMMARY_BYTES = 604;
var SHARED_ROW_CACHE_CEILING = 24424 + Math.floor(663 * 2 ** 20 / (3 * SHARED_ROW_SUMMARY_BYTES));
var StaleRowSummaryError = class extends Error {
  constructor(rowId) {
    super("Shared My Work: a shared row changed while it was being read");
    this.rowId = rowId;
  }
};
function foldPortableSharedRows(rows, validateValue) {
  const context = {
    deviceId: "",
    validateValue,
    reread: (row) => row,
    redactionReceipts: /* @__PURE__ */ new Map(),
    // Persist the verified source, even when a bad sibling makes the same identity/hash claims.
    sourceId: (summary) => summary.source.id
  };
  return foldSharedRows(rows.map((row) => summarizeRow(context, row, row)), context, false, /* @__PURE__ */ new Map());
}
function parseRow(context, row) {
  try {
    return parseSharedRow(row, context.deviceId);
  } catch {
    context.redactionReceipts ??= readSharedRedactionReceipts(context.db);
    const receipt = context.redactionReceipts.get(String(row.id));
    if (!receipt) return INVALID_ROW;
    try {
      return parseSharedRow(row, context.deviceId, { redactionReceipt: receipt });
    } catch {
      return INVALID_ROW;
    }
  }
}
function summarizeRow(context, row, source) {
  if (!isSharedWorkList(row.list_name)) return SKIPPED_ROW;
  const parsed = parseRow(context, row);
  if (parsed === INVALID_ROW) return INVALID_ROW;
  if (!parsed) return SKIPPED_ROW;
  if (parsed.unsupported) return UNSUPPORTED_ROW;
  if (parsed.record === "entry") return entrySummary(parsed, source, context.validateValue);
  if (parsed.record === "manifest") {
    return {
      record: "manifest",
      batch: parsed.batch,
      writer: parsed.writer,
      part: parsed.part,
      hash: parsed.hash,
      refs: parsed.refs.map((ref) => canonicalJson(ref))
    };
  }
  return { record: "commit", batch: parsed.batch, writer: parsed.writer, count: parsed.count, hash: parsed.hash, parts: parsed.parts };
}
function foldSharedRows(items, context, includeHistory, values2, previousValues = /* @__PURE__ */ new Map()) {
  const records = /* @__PURE__ */ new Map();
  const heads = /* @__PURE__ */ new Map();
  const history = includeHistory ? /* @__PURE__ */ new Map() : void 0;
  const diagnostics = { pending: 0, invalid: 0, unsupported: 0, conflicts: [] };
  const full = (entry) => {
    let record = values2.get(entry) ?? previousValues.get(entry);
    if (!record) {
      const row = context.reread(entry.source);
      record = row ? parseRow(context, row) : INVALID_ROW;
      if (record === INVALID_ROW || record?.record !== "entry" || record.hash !== entry.hash || record.revision !== entry.revision || record.batch !== entry.batch || record.writer !== entry.writer || record.kind !== entry.kind || record.key !== entry.key) {
        throw new StaleRowSummaryError(entry.source);
      }
    }
    values2.set(entry, record);
    return record;
  };
  const batches = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (item === SKIPPED_ROW) continue;
    if (item === INVALID_ROW) {
      diagnostics.invalid++;
      continue;
    }
    if (item === UNSUPPORTED_ROW) {
      diagnostics.unsupported++;
      continue;
    }
    const id = canonicalJson([item.writer, item.batch]);
    let batch = batches.get(id);
    if (!batch) {
      batch = { entries: /* @__PURE__ */ new Map(), manifests: /* @__PURE__ */ new Map(), commits: /* @__PURE__ */ new Map(), invalid: false };
      batches.set(id, batch);
    }
    const map = item.record === "entry" ? batch.entries : item.record === "manifest" ? batch.manifests : batch.commits;
    const key = item.record === "entry" ? sharedRecordKey(item.kind, item.key) : item.record === "manifest" ? item.part : item.hash;
    const previous = map.get(key);
    const comparable = (record) => canonicalJson(record.record === "entry" ? full(record) : record);
    if (previous && comparable(previous) !== comparable(item)) batch.invalid = true;
    map.set(key, item);
  }
  const candidates = /* @__PURE__ */ new Map();
  for (const batch of batches.values()) {
    if (batch.invalid || batch.commits.size > 1) {
      diagnostics.invalid++;
      continue;
    }
    const commit = [...batch.commits.values()][0];
    if (!commit) {
      diagnostics.pending++;
      continue;
    }
    const entries = [];
    let incomplete = false, invalid = false, byRef;
    for (let index = 0; index < commit.parts.length; index++) {
      const manifest = batch.manifests.get(index);
      if (!manifest) {
        incomplete = true;
        break;
      }
      if (manifest.hash !== commit.parts[index]) {
        invalid = true;
        break;
      }
      for (const ref of manifest.refs) {
        byRef ??= new Map([...batch.entries.values()].map((entry2) => [entry2.ref, entry2]));
        const entry = byRef.get(ref);
        if (!entry) {
          const { kind, key } = JSON.parse(ref);
          if (batch.entries.has(sharedRecordKey(kind, key))) invalid = true;
          else incomplete = true;
          break;
        }
        entries.push(entry);
      }
    }
    if (invalid) {
      diagnostics.invalid++;
      continue;
    }
    if (incomplete) {
      diagnostics.pending++;
      continue;
    }
    if (entries.length !== commit.count || batch.entries.size !== commit.count || batch.manifests.size !== commit.parts.length || new Set(entries.map((entry) => sharedRecordKey(entry.kind, entry.key))).size !== entries.length) {
      diagnostics.invalid++;
      continue;
    }
    if (context.validateValue && !entries.every((entry) => entry.valid)) {
      diagnostics.invalid++;
      continue;
    }
    for (const entry of entries) {
      const identity = sharedRecordKey(entry.kind, entry.key);
      if (!candidates.has(identity)) candidates.set(identity, []);
      candidates.get(identity).push(entry);
    }
  }
  for (const [identity, entries] of [...candidates].sort(([a], [b]) => compareText(a, b))) {
    entries.sort((a, b) => compareCanonicalDecimals(a.revision, b.revision) || compareText(a.writer, b.writer) || compareText(a.batch, b.batch));
    const latest = entries.at(-1);
    const sameRevision = entries.filter((entry) => entry.revision === latest.revision);
    const recordOf = (summary) => {
      const entry = full(summary);
      return {
        ...context.sourceId ? { sourceId: context.sourceId(summary) } : {},
        kind: entry.kind,
        key: entry.key,
        value: entry.value,
        deleted: entry.deleted,
        revision: entry.revision,
        writer: entry.writer,
        hash: entry.hash,
        batchId: entry.batch,
        base: entry.base,
        valueHash: sharedValueHash(entry.kind, entry.key, entry.value, entry.deleted)
      };
    };
    const current = recordOf(latest);
    heads.set(identity, sameRevision.map(recordOf));
    if (history && latest.kind === "group") history.set(identity, entries.map(recordOf));
    if (new Set(sameRevision.map((entry) => entry.hash)).size > 1) {
      diagnostics.conflicts.push({
        kind: latest.kind,
        key: latest.key,
        revision: latest.revision,
        writers: [...new Set(sameRevision.map((entry) => entry.writer))].sort()
      });
    }
    records.set(identity, current);
  }
  diagnostics.conflicts.sort((a, b) => compareText(sharedRecordKey(a.kind, a.key), sharedRecordKey(b.kind, b.key)));
  const revision = sha256Base64Url(canonicalJson([...records].sort(([a], [b]) => compareText(a, b)).map(([key, record]) => [
    key,
    record.revision,
    record.writer,
    record.hash,
    record.valueHash,
    heads.get(key).map((head) => [head.hash, head.valueHash]).sort((a, b) => compareText(canonicalJson(a), canonicalJson(b)))
  ])));
  return { records, heads, ...history ? { history } : {}, revision, diagnostics };
}
function entrySummary(entry, source, validateValue) {
  let valid = true;
  if (validateValue) {
    try {
      valid = validateValue(entry.kind, entry.key, entry.value, entry.deleted, entry.writer) === true;
    } catch {
      valid = false;
    }
  }
  return {
    record: "entry",
    kind: entry.kind,
    key: entry.key,
    revision: entry.revision,
    writer: entry.writer,
    batch: entry.batch,
    hash: entry.hash,
    ref: canonicalJson(sharedEntryRef(entry)),
    valid,
    source
  };
}

// src/services/work-view/cloud-renderer-core.mjs
init_shared_records();

// src/services/work-view/request-evidence-refs.mjs
function requestEvidenceRefs(request) {
  const refs = /* @__PURE__ */ new Map();
  const add = (ref) => {
    if (ref && ["work-state", "observation", "prompt", "summary", "session"].includes(ref.kind) && Number.isSafeInteger(ref.id) && ref.id > 0) refs.set(`${ref.kind}:${ref.id}`, ref);
  };
  const addUrl = (url) => {
    const match = /^\/api\/work-view\/evidence\/([\w-]+)\/(\d+)$/.exec(url ?? "");
    if (match) add({ kind: match[1], id: Number(match[2]) });
  };
  addUrl(request.original?.url);
  for (const update of request.scopeUpdates) addUrl(update.url);
  for (const item of request.items) {
    addUrl(item.url);
    addUrl(item.request?.url);
    addUrl(item.request?.original?.url);
    for (const field of [item.nextStep, item.outcome]) {
      if (field?.source === "session-summary") add({ kind: "summary", id: field.sourceId });
    }
    for (const ref of item.sourceRefs ?? []) add(ref);
  }
  for (const activity of [...request.activity, ...request.workstreams.flatMap((stream) => stream.activity)]) add(activity.sourceRef);
  return refs;
}

// src/services/work-view/shared-reviews.mjs
init_CanonicalContent();
import { createHash as createHash10 } from "node:crypto";
init_shared_records();
init_request_groups();
init_request_projection();
var digest = (value) => createHash10("sha256").update(canonicalJson(value)).digest("hex");
var SOURCE_KINDS2 = { "user-prompt": "prompt", "session-summary-request": "summary", "session-summary": "summary", "session-initial-request": "session", "work-state": "work-state", observation: "observation" };
var REPLICATED_KINDS = /* @__PURE__ */ new Set(["prompt", "observation", "summary", "work-state", "session"]);
var ENVELOPE_OMIT = /* @__PURE__ */ new Set([
  "id",
  "sourceId",
  "sourceIdentity",
  "stableIdentity",
  "identity",
  "urlRef",
  "fileUrlRef",
  "path",
  "bucketPath",
  "sourcePath",
  "bucket_path",
  "source_path",
  "toolUseId",
  "linkedEntryId",
  "filePath",
  "file_path",
  "absolutePath",
  "cwd",
  "workingDirectory",
  "working_directory",
  "files_modified",
  "files_read",
  "files_written",
  "filesModified",
  "filesRead",
  "filesWritten",
  "sessionId",
  "session_db_id",
  "agentSessionId",
  "memory_session_id",
  "sourceContentHashes",
  "contentFingerprint",
  "review",
  "humanCopy",
  "sharedHumanCopy",
  "sharedHumanCopyDisabled",
  "shared",
  "available",
  "inCurrentScope",
  "identityEvidence",
  "match"
]);
var ENVELOPE_CHILDREN = /* @__PURE__ */ new Set([
  "original",
  "request",
  "scopeUpdates",
  "items",
  "lifecycle",
  "afterShip",
  "shipEstimate",
  "nextStep",
  "outcome",
  "progress",
  "evidence",
  "sourceRefs",
  "sourceRef",
  "activity",
  "requestedBySource",
  "shipEstimateSource",
  "stageSource",
  "requestStatusSource",
  "requestCompleteSource"
]);
var compare = (left, right) => {
  const a = canonicalJson(left), b = canonicalJson(right);
  return a === b ? 0 : a < b ? -1 : 1;
};
function sessionIdentity(database, id) {
  if (database.stableEvidenceRef) return database.stableEvidenceRef("session", id)?.conversation ?? null;
  try {
    const row = database.prepare("SELECT platform_source, content_session_id FROM sdk_sessions WHERE id = ?").get(id);
    return row?.platform_source && row?.content_session_id ? JSON.stringify(["conversation", row.platform_source, row.content_session_id]) : null;
  } catch (error) {
    if (/no such (table|column)/i.test(String(error.message))) return null;
    throw error;
  }
}
function matchesSessionDisclosure(native, shared) {
  if (!native?.user_prompt) return true;
  return (shared.user_prompt == null || requestText(native.user_prompt) === shared.user_prompt) && sharedProjectKey(native.project) === (shared.project ?? null) && (native.custom_title?.slice(0, 120) ?? null) === (shared.custom_title ?? null) && ["status", "platform_source", "started_at_epoch"].every((key) => (native[key] ?? null) === (shared[key] ?? null));
}
function sharedReviewRequestId(request, originalRef = null) {
  const identity = request.groupId ? ["group", request.groupId] : request.explicitRequestId ? ["explicit", request.explicitRequestId, [...new Set((request.projects ?? []).map(sharedProjectKey).filter(Boolean))].sort()] : ["request", request.conversationKey ?? null, [...request.conversationKeys ?? []].sort(), request.original?.promptNumber ?? null, originalRef];
  return `sr2_${digest(identity)}`;
}
function sharedReviewDescriptor(database, request, { deviceId, sharedState: sharedState2 = null, evidenceRows = /* @__PURE__ */ new Map() } = {}) {
  if (!request || typeof request !== "object" || !deviceId) throw new TypeError("Shared review requires a request and device identity");
  const refs = /* @__PURE__ */ new Map(), missing = /* @__PURE__ */ new Set();
  const evidenceRow = (kind, id) => {
    const key = `${kind}:${id}`;
    if (!evidenceRows.has(key)) evidenceRows.set(key, readEvidence(database, kind, id));
    return evidenceRows.get(key);
  };
  const remember = (ref) => {
    if (ref && REPLICATED_KINDS.has(ref.kind)) refs.set(canonicalJson(ref), ref);
    return ref;
  };
  const refFor = (value) => {
    if (!value || typeof value !== "object") return null;
    const given = value.stableIdentity ?? value.sourceIdentity ?? value.identity;
    if (given?.kind && REPLICATED_KINDS.has(given.kind)) return remember(given);
    const kind = SOURCE_KINDS2[value.source] ?? value.kind;
    const id = value.sourceId ?? value.id;
    if (!REPLICATED_KINDS.has(kind) || id == null || !/^\d+$/.test(String(id))) return null;
    const ref = stableEvidenceRef(database, kind, id, deviceId);
    if (!ref) missing.add(`${kind}:unresolved`);
    return remember(ref);
  };
  const agent = (value) => {
    if (typeof value !== "string") return value ?? null;
    let parts;
    try {
      parts = JSON.parse(value);
    } catch {
      return value;
    }
    if (!Array.isArray(parts)) return value;
    if (parts[0] === "session" && parts.length >= 4) {
      const conversation2 = sessionIdentity(database, parts[2]);
      if (!conversation2) {
        missing.add("agent:unresolved");
        return null;
      }
      return ["agent", conversation2, parts[3] ?? null];
    }
    if (parts[0] === "request" && parts.length >= 4) {
      const conversation2 = sessionIdentity(database, parts[2]);
      if (!conversation2) {
        missing.add("request:unresolved");
        return null;
      }
      return ["request", conversation2, parts[3]];
    }
    return value;
  };
  const semanticJson = (value, depth = 0) => {
    if (depth > 48) {
      missing.add("evidence:unsupported-depth");
      return null;
    }
    if (value == null || typeof value !== "object") return value ?? null;
    if (Array.isArray(value)) return value.map((item) => semanticJson(item, depth + 1));
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== void 0).map(([key, item]) => [key, semanticJson(item, depth + 1)]));
  };
  const productMeaning = (product) => {
    if (!product || typeof product !== "object") return semanticJson(product);
    const url = sharedPublishedUrl(product.url);
    if ((product.path || product.bucketPath || product.availability === "origin-only") && !product.productId) missing.add("product:unresolved");
    return {
      kind: product.kind ?? null,
      title: product.title ?? null,
      url: url ?? null,
      productId: product.productId ?? null,
      originDeviceId: product.productId ? product.originDeviceId ?? null : null,
      sha: product.sha ?? null,
      branch: product.branch ?? null,
      repo: product.repo ?? null,
      heads: Array.isArray(product.heads) ? semanticJson(product.heads).sort(compare) : product.heads ?? null,
      atEpoch: product.atEpoch ?? null
    };
  };
  const normalize = (value, field = "", depth = 0) => {
    if (depth > 48) {
      missing.add("evidence:unsupported-depth");
      return null;
    }
    if (value == null) return null;
    if (typeof value !== "object") {
      if (field === "agentId" || field === "agentIds" || field === "key" || field === "requestKey" || field === "promptRequestKey") return agent(value);
      if (field === "project" || field === "projectRoot") return sharedProjectKey(value);
      return value;
    }
    if (Array.isArray(value)) {
      const result2 = value.filter((item) => item?.kind !== "tool-use").map((item) => normalize(item, field, depth + 1));
      return ["sourceRefs", "agentIds", "projects"].includes(field) ? result2.sort(compare) : result2;
    }
    const ref = refFor(value);
    const result = ref ? { ref } : {};
    for (const [key, item] of Object.entries(value)) {
      if (ENVELOPE_OMIT.has(key) || item === void 0) continue;
      if (key === "attribution") {
        result.attribution = { agentId: item?.agentId ?? null, meaning: item?.meaning ?? null };
        continue;
      }
      if (key === "url" || key === "fileUrl") {
        const match = typeof item === "string" && /^\/api\/work-view\/evidence\/([\w-]+)\/(\d+)$/.exec(item);
        if (match && REPLICATED_KINDS.has(match[1])) {
          const identity = remember(stableEvidenceRef(database, match[1], match[2], deviceId));
          if (identity) result.ref ??= identity;
          else missing.add(`${match[1]}:unresolved`);
        } else if (sharedPublishedUrl(item)) result[key] = item;
        continue;
      }
      result[key] = key === "workProduct" ? (item ?? []).map(productMeaning).sort(compare) : key === "fields" ? semanticJson(item, depth + 1) : item && typeof item === "object" && !ENVELOPE_CHILDREN.has(key) ? semanticJson(item, depth + 1) : normalize(item, key, depth + 1);
    }
    return result;
  };
  for (const ref of request.sourceContentHashes ?? []) refFor(ref);
  const selected = {};
  for (const key of ["original", "explicitRequestText", "scopeUpdates", "projects", "agentIds", "items", "lifecycle", "afterShip", "shipEstimate", "stageSourceText"]) {
    selected[key] = key === "projects" && Array.isArray(request[key]) ? [...new Set(request[key].map(sharedProjectKey).filter(Boolean))].sort(compare) : normalize(request[key], key);
  }
  selected.workProduct = (request.workProduct ?? []).map(productMeaning).sort(compare);
  selected.items?.sort(compare);
  const originalRef = refFor(request.original);
  const evidence2 = [];
  for (const [identity, ref] of [...refs].sort(([a], [b]) => a === b ? 0 : a < b ? -1 : 1)) {
    const id = resolveEvidenceRef(database, ref, deviceId);
    if (id == null) {
      missing.add(identity);
      continue;
    }
    let row;
    if (ref.kind === "session") {
      const record = sharedState2?.records?.get(sharedRecordKey("provenance", ref.conversation));
      if (!record || record.deleted || !record.value?.session) {
        missing.add(identity);
        continue;
      }
      row = { kind: "session", ...record.value.session };
      const isOriginal = originalRef?.kind === "session" && originalRef.conversation === ref.conversation;
      if (!matchesSessionDisclosure(evidenceRow("session", id), row) || isOriginal && request.original?.text && requestText(request.original.text) !== row.user_prompt) {
        missing.add(identity);
        continue;
      }
    } else {
      row = evidenceRow(ref.kind, id);
      if (!row) {
        missing.add(identity);
        continue;
      }
      if (ref.kind === "work-state" && typeof row.fields === "string") {
        try {
          row = { ...row, fields: JSON.parse(row.fields) };
        } catch {
          missing.add(identity);
          continue;
        }
      }
      if (ref.kind === "prompt") row = { ...row, conversation: sessionIdentity(database, row.session_db_id) };
    }
    const { id: _id, session_db_id: _sessionId, kind: _kind, ...content } = row;
    if (Object.hasOwn(content, "project")) content.project = sharedProjectKey(content.project);
    evidence2.push({ ref, hash: digest(semanticJson(content)) });
  }
  if (!request.groupId && !request.explicitRequestId && request.original?.promptNumber == null && !originalRef) missing.add("request:unresolved");
  const requestId = sharedReviewRequestId(request, originalRef);
  return {
    version: SHARED_REVIEW_VERSION,
    requestId,
    fingerprint: digest({ version: SHARED_REVIEW_VERSION, requestId, content: selected, evidence: evidence2 }),
    complete: missing.size === 0,
    missingEvidence: [...missing].sort()
  };
}
function readSharedReview(sharedState2, descriptor) {
  const key = sharedRecordKey(SHARED_REVIEW_KIND, descriptor.requestId);
  const record = sharedState2?.records?.get(key);
  const heads = sharedState2?.heads?.get(key) ?? (record ? [record] : []);
  const token = record ? digest({
    version: 1,
    requestId: descriptor.requestId,
    heads: heads.map((head) => [head.hash, head.valueHash ?? null]).sort(compare)
  }) : null;
  const conflict = Boolean(sharedState2?.diagnostics?.conflicts?.some((value2) => value2.kind === SHARED_REVIEW_KIND && value2.key === descriptor.requestId));
  const value = record && !record.deleted && isSharedReviewValue(record.kind, record.key, record.value) ? record.value : null;
  const matches = Boolean(value && value.fingerprint === descriptor.fingerprint);
  return {
    checked: Boolean(descriptor.complete && !conflict && matches && value.checked),
    checkedAtEpoch: descriptor.complete && !conflict && matches && value.checked ? value.checkedAtEpoch : null,
    actor: descriptor.complete && !conflict && matches && value.checked ? "shared-user" : null,
    available: descriptor.complete,
    mode: "shared",
    conflict,
    matches,
    hash: token,
    recordHash: record?.hash ?? null,
    version: SHARED_REVIEW_VERSION,
    writer: record?.writer ?? null,
    ...!descriptor.complete ? { message: "Some recorded evidence has not arrived on this viewer. Sync it before sharing a review." } : conflict ? { message: "Two devices saved different review decisions. Read the latest evidence and choose again." } : value && !matches ? { message: "The recorded evidence changed since the shared review. Review this version again." } : {}
  };
}
function sharedSuggestionDescriptor(sharedState2, conversationKey2) {
  const records = [...sharedState2?.records?.values() ?? []].filter((record) => ["group", "ignored"].includes(record.kind));
  const heads = records.flatMap((record) => sharedState2?.heads?.get(sharedRecordKey(record.kind, record.key)) ?? [record]);
  const candidates = heads.filter((record) => !record.deleted && record.kind === "group" && record.value?.suggestions?.[conversationKey2]);
  if (!candidates.length) return { hash: null, conflict: false, groupKeys: [] };
  const selected = records.find((record) => !record.deleted && record.kind === "group" && record.value?.suggestions?.[conversationKey2]);
  const target = selected ?? [...candidates].sort((a, b) => compare([a.key, a.hash], [b.key, b.hash]))[0];
  const groupKeys = new Set(candidates.map((record) => record.key));
  groupKeys.add(groupIdFor(conversationKey2));
  const members = /* @__PURE__ */ new Set([conversationKey2]);
  for (const record of candidates) for (const member of record.value.members ?? []) members.add(member);
  for (const record of heads) if (!record.deleted && record.kind === "group" && record.value?.group?.anchor === conversationKey2) {
    groupKeys.add(record.key);
    for (const member of record.value.members ?? []) members.add(member);
  }
  for (const record of heads) if (!record.deleted && record.kind === "group" && record.value?.members?.some((member) => members.has(member))) groupKeys.add(record.key);
  const claims = /* @__PURE__ */ new Map();
  let membershipConflict = false;
  for (const record of heads) if (!record.deleted && record.kind === "group" && groupKeys.has(record.key)) for (const member of record.value?.members ?? []) {
    if (claims.has(member) && claims.get(member) !== record.key) membershipConflict = true;
    claims.set(member, record.key);
  }
  const conflict = membershipConflict || Boolean(sharedState2?.diagnostics?.conflicts?.some((entry) => entry.kind === "group" && groupKeys.has(entry.key)));
  if (!conflict && target.value.suggestions[conversationKey2].status !== "open") return { hash: null, conflict: false, groupKeys: [] };
  const bases = heads.map((record) => [record.kind, record.key, record.hash, record.valueHash]).sort(compare);
  return {
    hash: digest({ version: 2, conversationKey: conversationKey2, bases }),
    conflict,
    groupKeys: [...groupKeys].sort(),
    targetId: target.key,
    suggestion: { ...target.value.suggestions[conversationKey2], conversationKey: conversationKey2, requestId: target.key, requestTitle: target.value.group.title }
  };
}
function sharedConflictSuggestions(sharedState2) {
  const keys = /* @__PURE__ */ new Set();
  for (const record of sharedState2?.records?.values() ?? []) {
    for (const head of sharedState2?.heads?.get(sharedRecordKey(record.kind, record.key)) ?? [record]) {
      if (head.kind === "group" && !head.deleted) for (const key of Object.keys(head.value?.suggestions ?? {})) keys.add(key);
    }
  }
  return [...keys].sort().flatMap((key) => {
    const descriptor = sharedSuggestionDescriptor(sharedState2, key);
    return descriptor.conflict && descriptor.hash ? [{ ...descriptor.suggestion, expectedSuggestionHash: descriptor.hash, sharedConflict: true }] : [];
  });
}

// src/services/work-view/cloud-renderer-core.mjs
var cloudDevice = /* @__PURE__ */ Symbol("cloud viewer");
var compareText2 = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function foldCloudBatch(rows) {
  const state = foldPortableSharedRows(rows, isSharedProjectionValue);
  return {
    members: [...state.heads.values()].flat(),
    pending: state.diagnostics.pending,
    invalid: state.diagnostics.invalid,
    unsupported: state.diagnostics.unsupported
  };
}
function sharedState(heads, diagnostics, revision) {
  const records = /* @__PURE__ */ new Map(), byKey = /* @__PURE__ */ new Map(), conflicts = [];
  for (const row of heads) {
    const identity = sharedRecordKey(row.kind, row.key);
    const group = byKey.get(identity);
    if (group) group.push(row);
    else byKey.set(identity, [row]);
  }
  for (const [key, group] of byKey) {
    group.sort((a, b) => compareCanonicalDecimals(a.revision, b.revision) || compareText2(a.writer, b.writer) || compareText2(a.batchId, b.batchId));
    const winner = group.at(-1);
    const competing = group.filter((row) => row.revision === winner.revision);
    records.set(key, winner);
    byKey.set(key, competing);
    if (new Set(competing.map((row) => row.hash)).size > 1) conflicts.push({
      kind: winner.kind,
      key: winner.key,
      revision: winner.revision,
      writers: [...new Set(competing.map((row) => row.writer))].sort()
    });
  }
  return { records, heads: byKey, revision, diagnostics: { pending: 0, invalid: 0, unsupported: 0, ...diagnostics, conflicts } };
}
var evidenceFields = {
  "work-state": ["project", "list_name", "fields", "created_at_epoch"],
  prompt: ["session_db_id", "prompt_number", "prompt_text", "created_at_epoch"],
  summary: ["project", "request", "completed", "next_steps", "created_at_epoch"],
  observation: ["project", "title", "subtitle", "narrative", "created_at_epoch"],
  session: ["project", "platform_source", "user_prompt", "custom_title", "status", "started_at_epoch"]
};
function cloudRootOf(groups) {
  const roots = new Set(Object.values(groups ?? {}).map((group) => group.projectRoot));
  return (project) => projectRoot(project, roots.has(project));
}
function applyGroupDecisions2(stored, decisions, now, options = {}) {
  return applyGroupDecisions(stored, decisions, now, { ...options, getProjectRoot: cloudRootOf(stored?.groups) });
}
var contentGroups = { observation: "observations", summary: "summaries", prompt: "prompts", work_state: "workState" };
function knownMemorySessions(documents, sessionIdentities, shared) {
  const byMemory = /* @__PURE__ */ new Map();
  for (const row of documents) if (row.kind === "prompt" && row.content_session_id && row.memory_session_id && row.session_db_id) {
    byMemory.set(row.memory_session_id, { id: row.session_db_id, platform_source: row.platform_source || "claude", content_session_id: row.content_session_id });
  }
  for (const session of sessionIdentities) {
    const provenance = shared.records.get(sharedRecordKey("provenance", conversationKey(session)));
    const memory = !provenance?.deleted && provenance?.value?.session?.memory_session_id;
    if (memory) byMemory.set(memory, session);
  }
  return byMemory;
}
function cloudInput(documents, sessionIdentities, shared) {
  const records = { observations: [], summaries: [], prompts: [], sessions: [], workState: [] };
  const sessions = /* @__PURE__ */ new Map(), origins = /* @__PURE__ */ new Map(), ids = /* @__PURE__ */ new Map(), evidence2 = /* @__PURE__ */ new Map();
  const byMemory = knownMemorySessions(documents, sessionIdentities, shared);
  let unsupported = 0;
  function register(kind, row, origin) {
    const id = row.id;
    if (!Number.isSafeInteger(id) || id <= 0) throw new TypeError("Invalid cloud evidence ID");
    const key = kind + ":" + id;
    origins.set(key, origin);
    ids.set(canonicalJson(origin), id);
    const fields = Object.fromEntries(evidenceFields[kind].map((name) => [name, row[name] ?? null]));
    evidence2.set(key, { kind, id, ...fields });
  }
  for (const document of documents) {
    if (!Object.hasOwn(contentGroups, document.kind)) continue;
    const promptNumber = document.payload.prompt_number == null ? null : Number(document.payload.prompt_number);
    if (!Number.isFinite(new Date(document.created_at_epoch).getTime()) || promptNumber !== null && (!Number.isSafeInteger(promptNumber) || promptNumber < 0)) {
      unsupported++;
      continue;
    }
    const kind = document.kind === "work_state" ? "work-state" : document.kind;
    const linked = document.content_session_id ? null : byMemory.get(document.memory_session_id);
    const orphan = kind === "prompt" && !document.memory_session_id && (!document.project || document.project === "unknown");
    const sessionId = orphan ? null : linked?.id ?? document.session_db_id;
    const platform = linked?.platform_source || document.platform_source || "claude";
    const contentId = linked?.content_session_id || document.content_session_id || document.memory_session_id;
    const row = {
      ...document.payload,
      id: document.numeric_id,
      session_db_id: sessionId,
      origin_device_id: document.origin_device_id,
      origin_local_id: document.origin_local_id,
      project: document.project,
      platform_source: platform,
      memory_session_id: document.memory_session_id,
      content_session_id: document.content_session_id || null,
      created_at_epoch: document.created_at_epoch
    };
    if (promptNumber !== null) row.prompt_number = promptNumber;
    if (kind === "observation" && row.metadata) row.media = observationMediaFromMetadata(JSON.stringify(row.metadata));
    if (kind === "work-state") {
      if (typeof row.list_name !== "string") throw new TypeError("Invalid synced work-state list");
    }
    register(kind, row, { kind, device: row.origin_device_id, row: String(row.origin_local_id) });
    if (kind === "prompt") row.prompt_text = [...row.prompt_text].slice(0, 1200).join("");
    records[contentGroups[document.kind]].push(row);
    if (sessionId != null && contentId) {
      const previous = sessions.get(sessionId);
      const session = previous ?? {
        id: sessionId,
        project: row.project,
        platform_source: platform,
        content_session_id: contentId,
        memory_session_id: null,
        status: "completed",
        user_prompt: null,
        custom_title: null,
        started_at_epoch: row.created_at_epoch,
        completed_at_epoch: null
      };
      if (session.platform_source !== platform || session.content_session_id !== contentId) throw new TypeError("Inconsistent cloud conversation identity");
      session.started_at_epoch = Math.min(session.started_at_epoch, row.created_at_epoch);
      if (row.memory_session_id) session.memory_session_id = row.memory_session_id;
      sessions.set(session.id, session);
    }
  }
  for (const session of sessionIdentities) {
    const existing = sessions.get(session.id);
    if (existing && conversationKey(existing) !== conversationKey(session)) throw new TypeError("Inconsistent cloud conversation identity");
    if (!existing) sessions.set(session.id, session);
  }
  const registerSession = (session) => register("session", session, { kind: "session", conversation: conversationKey(session) });
  for (const session of sessions.values()) {
    registerSession(session);
    records.sessions.push(session);
  }
  for (const key of ["observations", "summaries", "prompts"]) records[key].sort((a, b) => b.created_at_epoch - a.created_at_epoch || b.id - a.id);
  records.productObservations = records.observations;
  const lookup = {
    stableEvidenceRef: (kind, id) => origins.get(kind + ":" + id) ?? null,
    resolveEvidenceRef: (ref) => ids.get(canonicalJson(ref)) ?? null,
    readEvidence: (kind, id) => evidence2.get(kind + ":" + id) ?? null
  };
  return { records, lookup, evidence: evidence2, registerSession, unsupported };
}
function sharedCopyFor(request) {
  const entry = request.sharedHumanCopy;
  if (!entry || request.sharedHumanCopyDisabled) return { state: "unavailable" };
  try {
    const input = createHumanCopyInput(request);
    if (entry.fingerprint !== humanCopyFingerprint(input)) return { state: "unavailable" };
    const copy = validateHumanCopy(entry.copy, input);
    const streams = new Map(request.workstreams.map((stream) => [stream.stableId ?? stream.id, stream.id]));
    return {
      ...copy,
      state: "current",
      generatedAt: entry.generatedAt,
      workstreams: copy.workstreams.map((stream) => ({ ...stream, id: streams.get(stream.id) ?? stream.id }))
    };
  } catch {
    return { state: "unavailable" };
  }
}
function renderCloudWorkView({ now, revision, documents = [], sessions = [], sharedHeads = [], diagnostics = {} }) {
  const shared = sharedState(sharedHeads, diagnostics, String(revision));
  const { records, lookup, evidence: evidence2, registerSession, unsupported } = cloudInput(documents, sessions, shared);
  shared.diagnostics.unsupported += unsupported;
  const state = reduceWorkState(records.workState, { currentProject: "", localDeviceId: cloudDevice });
  const applied = applySharedProjection(lookup, shared, { records, deviceId: cloudDevice });
  for (const session of applied.records.sessions) if (Number.isSafeInteger(session.id)) registerSession(session);
  const view = decorateSharedView(
    buildAgentView(state, applied.records, { now, ledger: applied.ledger, localFiles: false, getProjectRoot: cloudRootOf(applied.ledger.groups.groups) }),
    { ...applied, database: lookup, deviceId: cloudDevice }
  );
  const suggestions = new Map(openSuggestions(applied.ledger).map((s) => [s.conversationKey, s]));
  for (const s of sharedConflictSuggestions(shared)) suggestions.set(s.conversationKey, s);
  const suggestionDescriptors = /* @__PURE__ */ Object.create(null);
  for (const [key, item] of suggestions) {
    const descriptor = sharedSuggestionDescriptor(shared, key);
    suggestionDescriptors[key] = descriptor;
    suggestions.set(key, { ...item, expectedSuggestionHash: descriptor.hash, sharedConflict: descriptor.conflict });
  }
  const requests = [];
  const disclosed = /* @__PURE__ */ new Map();
  for (const request of view.humanRequests) {
    request.sourceContentHashes = [...requestEvidenceRefs(request)].sort(([a], [b]) => a.localeCompare(b)).map(([key, ref]) => {
      const row = evidence2.get(key);
      if (row) disclosed.set(key, { kind: ref.kind, id: ref.id, value: row });
      return { ...ref, hash: createHash11("sha256").update(JSON.stringify(row ?? null)).digest("hex") };
    });
    const descriptor = sharedReviewDescriptor(lookup, request, { deviceId: cloudDevice, sharedState: shared, evidenceRows: evidence2 });
    const review = readSharedReview(shared, descriptor);
    request.contentFingerprint = descriptor.complete ? descriptor.fingerprint : contentFingerprint(request);
    request.review = review;
    request.humanCopy = sharedCopyFor(request);
    const suggestion = [...suggestions.values()].find((s) => (s.sharedConflict || s.requestId !== request.groupId) && request.conversationKeys.includes(s.conversationKey));
    if (suggestion) request.suggestion = suggestion;
    request.workProduct = request.workProduct.filter((p) => !p.url || sharedPublishedUrl(p.url)).map((p) => {
      const { path, bucketPath, sourcePath, fileUrl: fileUrl2, ...product } = p;
      return product;
    });
    requests.push({
      id: request.id,
      anchorConversationKey: request.anchorConversationKey,
      focusAreaId: request.focusAreaId,
      contentFingerprint: request.contentFingerprint,
      reviewDescriptor: descriptor,
      readyForCheck: isReportedReadyForCheck(request, now),
      sharedReview: {
        hash: review.hash,
        recordHash: review.recordHash,
        conflict: review.conflict,
        revision: shared.records.get(sharedRecordKey("review", descriptor.requestId))?.revision ?? "0"
      },
      originalAsk: request.original?.text ?? void 0,
      project: request.projects?.[0] ?? void 0
    });
  }
  const snapshot = {
    ...view,
    revision: String(revision),
    suggestions: [...suggestions.values()],
    sharedState: { revision: String(revision), ...applied.diagnostics, enabled: true },
    sharedPersistenceVersion: 1,
    story: { reviews: Object.values(applied.ledger.progress), story: applied.ledger.story, groups: Object.keys(applied.ledger.groups.groups).length },
    refresh: applied.ledger.refresh,
    teamMode: false,
    source: {
      kind: "claude-mem-recorded-agent-activity",
      connected: true,
      stale: false,
      lastUpdatedAt: state.lastUpdatedAt,
      lastCheckedAt: new Date(now).toISOString(),
      error: null
    }
  };
  const project = state.events.find((e) => e.listName === "my-focus" || e.listName === "my-rules")?.project ?? "My Work";
  const editContext = {
    revision: String(revision),
    project,
    requests,
    focusAreas: view.focusAreas,
    savedRules: view.rules,
    agents: view.agents.map(
      ({ id, isSubagent, canMarkFinished, agentId, agentType, platformSource, contentSessionId, project: project2 }) => ({ id, isSubagent, canMarkFinished, agentId, agentType, platformSource, contentSessionId, project: project2 })
    ),
    groupRecords: [...shared.records.values()].filter((r) => r.kind === "group" || r.kind === "ignored"),
    suggestionDescriptors
  };
  const { overview, details } = projectWorkView(snapshot, now);
  const agentQuietAt = Object.fromEntries(view.agents.filter((agent) => agent.isSubagent && agent.presence.status === "recent").map((agent) => [agent.id, Date.parse(agent.presence.lastActivityAt) + DEFAULT_RECENT_ACTIVITY_MS + 1]));
  return { overview: { ...overview, agentQuietAt }, details, editContext, evidence: [...disclosed.values()] };
}

// src/services/work-view/cloud-renderer.ts
init_shared_records();
init_my_focus();

// src/shared/focus-change-version.ts
var areaId = (area) => "id" in area ? area.id : area.focusAreaId;
function focusChangeVersion(change, areas, requests) {
  if (change.action === "reorder") {
    const kept = areas.filter((area2) => area2.status === "kept" && !area2.mergedInto).map((area2) => [areaId(area2), area2.ownerRank, area2.priorityRank]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    return JSON.stringify(kept);
  }
  if (change.action === "move-request") {
    const request = requests.find((request2) => request2.id === change.requestId);
    return request ? JSON.stringify([request.id, request.focusAreaId ?? null]) : null;
  }
  const area = areas.find((area2) => areaId(area2) === change.focusAreaId);
  return area ? JSON.stringify([
    areaId(area),
    area.name,
    area.goal,
    area.about ?? null,
    area.status,
    area.ownerRank,
    area.priorityRank,
    area.source,
    area.mergedInto
  ]) : null;
}

// src/services/work-view/cloud-renderer.ts
init_request_groups();
export {
  agentStopFields,
  applyGroupDecisions2 as applyGroupDecisions,
  createSharedBatch,
  createSharedEntry,
  focusAreaRowFields,
  focusChangeVersion,
  foldCloudBatch,
  groupIdFor,
  isSharedProjectionValue,
  isSharedReviewValue,
  navWordIn,
  placeholderTitleFromAsk,
  placementRowFields,
  renderCloudWorkView,
  ruleRowFields,
  sharedSuggestionDescriptor
};
