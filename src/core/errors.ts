export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ToolErrorMetadata = {
  parameter?: string;
  configKey?: string;
  setupTool?: string;
  setupParams?: Record<string, unknown>;
  availableValues?: JsonValue[];
  cause?: unknown;
};

export type SerializedToolError = {
  ok: false;
  error: {
    code: string;
    message: string;
    action: string;
    retryable: boolean;
    parameter?: string;
    config_key?: string;
    setup_tool?: string;
    setup_params?: Record<string, JsonValue>;
    available_values?: JsonValue[];
  };
};

const sensitiveKey = /(?:token|password|secret|authorization|dsn)/i;

const sanitizeValue = (value: unknown): JsonValue | undefined => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map(sanitizeValue)
      .filter((item): item is JsonValue => item !== undefined);
  }
  if (typeof value === "object" && value) {
    const sanitized = Object.entries(value).flatMap(([key, item]) => {
      if (sensitiveKey.test(key)) return [];
      const safeItem = sanitizeValue(item);
      return safeItem === undefined ? [] : [[key, safeItem] as const];
    });
    return Object.fromEntries(sanitized);
  }
  return undefined;
};

export class ToolError extends Error {
  readonly code: string;
  readonly action: string;
  readonly retryable: boolean;
  readonly parameter?: string;
  readonly configKey?: string;
  readonly setupTool?: string;
  readonly setupParams?: Record<string, unknown>;
  readonly availableValues?: JsonValue[];
  override readonly cause?: unknown;

  constructor(
    code: string,
    message: string,
    action: string,
    retryable: boolean,
    metadata: ToolErrorMetadata = {},
  ) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.action = action;
    this.retryable = retryable;
    this.parameter = metadata.parameter;
    this.configKey = metadata.configKey;
    this.setupTool = metadata.setupTool;
    this.setupParams = metadata.setupParams;
    this.availableValues = metadata.availableValues;
    this.cause = metadata.cause;
  }
}

export class MissingConfigError extends ToolError {
  constructor(
    public configKey: string,
    message: string,
    public setupTool: string,
    public setupParams: Record<string, unknown>,
  ) {
    super(
      "CONFIG_REQUIRED",
      message,
      `Call ${setupTool} with the required configuration, then retry this tool.`,
      true,
      { configKey, setupTool, setupParams },
    );
    this.name = "MissingConfigError";
  }
}

const fallbackError = (): SerializedToolError => ({
  ok: false,
  error: {
    code: "INTERNAL_ERROR",
    message: "The tool could not complete the request.",
    action:
      "Report the failure to the user; do not retry automatically or choose an unrelated fallback.",
    retryable: false,
  },
});

export const serializeToolError = (error: unknown): SerializedToolError => {
  if (!(error instanceof ToolError)) return fallbackError();

  const serialized: SerializedToolError = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      action: error.action,
      retryable: error.retryable,
    },
  };

  if (error.parameter) serialized.error.parameter = error.parameter;
  if (error.configKey) serialized.error.config_key = error.configKey;
  if (error.setupTool) serialized.error.setup_tool = error.setupTool;
  if (error.availableValues) {
    serialized.error.available_values = error.availableValues;
  }

  const setupParams = sanitizeValue(error.setupParams);
  if (
    setupParams &&
    !Array.isArray(setupParams) &&
    typeof setupParams === "object" &&
    Object.keys(setupParams).length > 0
  ) {
    serialized.error.setup_params = setupParams;
  }

  return serialized;
};

export const stringifyToolError = (error: unknown): string => {
  try {
    return JSON.stringify(serializeToolError(error));
  } catch {
    return JSON.stringify(fallbackError());
  }
};
