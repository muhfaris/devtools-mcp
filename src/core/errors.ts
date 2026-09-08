// src/core/errors.ts
export class MissingConfigError extends Error {
  constructor(
    public configKey: string,
    public message: string,
    public setupTool: string,
    public setupParams: Record<string, any>,
  ) {
    super(message);
    this.name = "MissingConfigError";
  }
}
