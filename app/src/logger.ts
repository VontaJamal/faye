export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface Logger {
  info(code: string, message: string, context?: unknown): void;
  warn(code: string, message: string, context?: unknown): void;
  error(code: string, message: string, context?: unknown): void;
}

const REDACT_PATTERNS: RegExp[] = [
  /(xi-api-key\s*[:=]\s*)([^\s"']+)/gi,
  /(token\s*[:=]\s*)([^\s"']+)/gi,
  /(authorization\s*[:=]\s*)([^\s"']+)/gi,
  /(sk-[A-Za-z0-9\-_]{16,})/g
];

function redactString(input: string): string {
  let output = input;
  for (const pattern of REDACT_PATTERNS) {
    output = output.replace(pattern, "$1[REDACTED]");
  }
  return output;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (value && typeof value === "object") {
    const safe: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (/(api.?key|token|secret|password)/i.test(key)) {
        safe[key] = "[REDACTED]";
      } else {
        safe[key] = sanitize(val);
      }
    }
    return safe;
  }

  return value;
}

function emit(level: LogLevel, code: string, message: string, context?: unknown): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    code,
    message: redactString(message),
    context: sanitize(context)
  };

  const line = JSON.stringify(payload);
  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(): Logger {
  return {
    info(code, message, context) {
      emit("INFO", code, message, context);
    },
    warn(code, message, context) {
      emit("WARN", code, message, context);
    },
    error(code, message, context) {
      emit("ERROR", code, message, context);
    }
  };
}
