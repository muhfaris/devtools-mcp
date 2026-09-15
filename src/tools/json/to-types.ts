import path from "node:path";
import fs from "node:fs/promises";
import { Tool } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Type inference AST
// ---------------------------------------------------------------------------

type AstType =
  | { kind: "null" }
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "any" }
  | { kind: "array"; element: AstType }
  | { kind: "object"; properties: Map<string, ObjectProperty> }
  | { kind: "union"; alternatives: AstType[] };

type ObjectProperty = { name: string; type: AstType; optional: boolean };

function isObject(t: AstType): t is { kind: "object"; properties: Map<string, ObjectProperty> } {
  return t.kind === "object";
}

function isArray(t: AstType): t is { kind: "array"; element: AstType } {
  return t.kind === "array";
}

/** Infer an AST type from an arbitrary JSON value. */
function inferType(value: any): AstType {
  if (value === null) return { kind: "null" };
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: "array", element: { kind: "any" } };
    return { kind: "array", element: mergeTypes(value.map(inferType)) };
  }
  if (typeof value === "string") return { kind: "string" };
  if (typeof value === "number") return { kind: "number" };
  if (typeof value === "boolean") return { kind: "boolean" };
  if (typeof value === "object") {
    const properties = new Map<string, ObjectProperty>();
    for (const [key, val] of Object.entries(value)) properties.set(key, { name: key, type: inferType(val), optional: false });
    return { kind: "object", properties };
  }
  return { kind: "any" };
}

/** Merge multiple types into a single representative type (for array elements). */
function mergeTypes(types: AstType[]): AstType {
  if (types.length === 0) return { kind: "any" };
  const hasNull = types.some((t) => t.kind === "null");
  const nonNull = types.filter((t) => t.kind !== "null");
  const base = nonNull.length === 0 ? [{ kind: "any" as const }] : nonNull;

  if (base.every(isObject)) {
    const allKeys = new Set<string>();
    for (const o of base) for (const k of o.properties.keys()) allKeys.add(k);
    const properties = new Map<string, ObjectProperty>();
    for (const key of allKeys) {
      const present = base.map((o) => o.properties.get(key)).filter((p): p is ObjectProperty => Boolean(p));
      properties.set(key, { name: key, type: mergeTypes(present.map((p) => p.type)), optional: present.length < base.length });
    }
    const merged: AstType = { kind: "object", properties };
    return hasNull ? { kind: "union", alternatives: [merged, { kind: "null" }] } : merged;
  }

  if (base.every(isArray)) {
    const elements = base.map((a) => (isArray(a) ? a.element : { kind: "any" as const }));
    const merged: AstType = { kind: "array", element: mergeTypes(elements) };
    return hasNull ? { kind: "union", alternatives: [merged, { kind: "null" }] } : merged;
  }

  const distinct = dedupeUnion(base);
  const out: AstType = distinct.length === 1 ? distinct[0] : { kind: "union", alternatives: distinct };
  return hasNull ? wrapNullable(out) : out;
}

function wrapNullable(t: AstType): AstType {
  if (t.kind === "union") {
    const alts = [...t.alternatives.filter((m) => m.kind !== "null"), { kind: "null" }] as AstType[];
    return { kind: "union", alternatives: alts };
  }
  const alternatives: AstType[] = [t, { kind: "null" }];
  return { kind: "union", alternatives };
}

function dedupeUnion(types: AstType[]): AstType[] {
  const out: AstType[] = [];
  for (const t of types) {
    if (t.kind === "any") continue;
    if (!out.some((o) => sameType(o, t))) out.push(t);
  }
  return out.length ? out : [{ kind: "any" }];
}

function sameType(a: AstType, b: AstType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "null":
    case "string":
    case "number":
    case "boolean":
    case "any":
      return true;
    case "array":
      return b.kind === "array" && sameType(a.element, b.element);
    case "object": {
      if (b.kind !== "object") return false;
      if (a.properties.size !== b.properties.size) return false;
      for (const [k, v] of a.properties) {
        const other = b.properties.get(k);
        if (!other || other.optional !== v.optional || !sameType(v.type, other.type)) return false;
      }
      return true;
    }
    case "union":
      return b.kind === "union" && sameTypeList(a.alternatives, b.alternatives);
  }
}

function sameTypeList(a: AstType[], b: AstType[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => sameType(t, b[i]));
}

/** Split a type into non-null union members plus a nullable flag. */
function splitUnion(t: AstType): { members: AstType[]; nullable: boolean } {
  if (t.kind !== "union") return { members: [t], nullable: false };
  const nullable = t.alternatives.some((m) => m.kind === "null");
  const members = t.alternatives.filter((m) => m.kind !== "null");
  return { members: members.length ? members : [{ kind: "any" }], nullable };
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

function toPascalCase(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Type";
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return /^[A-Za-z]/.test(pascal) ? pascal : `Type${pascal}`;
}

function sanitizeIdentifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (!cleaned) return "_";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

// ---------------------------------------------------------------------------
// Collect named types (top-level + nested objects)
// ---------------------------------------------------------------------------

type NamedType = { name: string; props: ObjectProperty[] };
type Collection = { named: NamedType[]; nameFor: Map<object, string> };

function collectNamedTypes(root: AstType, rootName: string): Collection {
  const named: NamedType[] = [];
  const nameFor = new Map<object, string>();
  const used = new Set<string>();

  const unique = (name: string): string => {
    let final = toPascalCase(name);
    let i = 1;
    while (used.has(final)) {
      final = `${toPascalCase(name)}${i}`;
      i += 1;
    }
    used.add(final);
    return final;
  };

  const visit = (t: AstType, name: string): string => {
    if (!isObject(t)) return toPascalCase(name);
    if (nameFor.has(t.properties)) return nameFor.get(t.properties)!;
    const namedName = unique(name);
    nameFor.set(t.properties, namedName);
    const props: ObjectProperty[] = [...t.properties.values()];
    named.push({ name: namedName, props });
    for (const p of props) visitChildTypes(p.type, namedName, toPascalCase(p.name));
    return namedName;
  };

  const visitChildTypes = (t: AstType, parent: string, child: string) => {
    if (isObject(t)) visit(t, `${parent}${child}`);
    else if (isArray(t)) visitChildTypes(t.element, parent, child);
    else if (t.kind === "union")
      for (const m of t.alternatives) {
        if (isObject(m)) visit(m, `${parent}${child}`);
        else if (isArray(m)) visitChildTypes(m.element, parent, child);
      }
  };

  visit(root, rootName);
  return { named, nameFor };
}

// ---------------------------------------------------------------------------
// Generator context & field renderers
// ---------------------------------------------------------------------------

type GenCtx = {
  named: NamedType[];
  nameFor: Map<object, string>;
  rootName: string;
  rootObject: AstType;
  pythonStyle: string;
  csharpStyle: string;
};

type FieldRenderer = (t: AstType, ctx: GenCtx) => string;

const objectName = (t: AstType, ctx: GenCtx): string =>
  isObject(t) ? ctx.nameFor.get(t.properties) ?? "any" : "any";

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

const tsField: FieldRenderer = (t, ctx) => {
  const { members, nullable } = splitUnion(t);
  const names = members.map((m) => tsBase(m, ctx));
  const set = new Set(names);
  let base = set.size === 1 ? names[0] : names.join(" | ");
  if (nullable) base = base.includes("|") ? `(${base}) | null` : `${base} | null`;
  return base;
};

const tsBase = (t: AstType, ctx: GenCtx): string => {
  if (isObject(t)) return objectName(t, ctx);
  if (isArray(t)) return `${tsField(t.element, ctx)}[]`;
  switch (t.kind) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    default:
      return "any";
  }
};

function generateTypeScript(ctx: GenCtx): string {
  const lines: string[] = [];
  for (const { name, props } of ctx.named) {
    lines.push(`interface ${name} {`);
    for (const p of props) lines.push(`  ${sanitizeIdentifier(p.name)}${p.optional ? "?" : ""}: ${tsField(p.type, ctx)};`);
    lines.push("}", "");
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

const goField: FieldRenderer = (t, ctx) => {
  const { members, nullable } = splitUnion(t);
  const names = members.map((m) => goBase(m, ctx));
  const set = new Set(names);
  let base = set.size === 1 ? names[0] : "interface{}";
  if (nullable && base === "string") base = "*string";
  return base;
};

const goBase = (t: AstType, ctx: GenCtx): string => {
  if (isObject(t)) return objectName(t, ctx);
  if (isArray(t)) return `[]${goField(t.element, ctx)}`;
  switch (t.kind) {
    case "string":
      return "string";
    case "number":
      return "float64";
    case "boolean":
      return "bool";
    default:
      return "interface{}";
  }
};

function generateGo(ctx: GenCtx): string {
  const lines: string[] = [];
  for (const { name, props } of ctx.named) {
    lines.push(`type ${name} struct {`);
    for (const p of props) {
      const tag = `\`json:"${p.name}${p.optional ? ",omitempty" : ""}"\``;
      lines.push(`\t${toPascalCase(p.name)} ${goField(p.type, ctx)} ${tag}`);
    }
    lines.push("}", "");
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const pyField: FieldRenderer = (t, ctx) => {
  const { members, nullable } = splitUnion(t);
  const names = members.map((m) => pyBase(m, ctx));
  const set = new Set(names);
  let base = set.size === 1 ? names[0] : `Union[${names.join(", ")}]`;
  if (nullable) base = `Optional[${base}]`;
  return base;
};

const pyBase = (t: AstType, ctx: GenCtx): string => {
  if (isObject(t)) return objectName(t, ctx);
  if (isArray(t)) return `List[${pyField(t.element, ctx)}]`;
  switch (t.kind) {
    case "string":
      return "str";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    default:
      return "Any";
  }
};

function generatePython(ctx: GenCtx): string {
  const { named, pythonStyle } = ctx;
  const lines: string[] = [];
  if (pythonStyle === "typeddict") {
    lines.push("from typing import List, Optional, TypedDict, Union", "");
    for (const { name, props } of named) {
      lines.push(`class ${name}(TypedDict, total=False):`);
      if (props.length === 0) lines.push("    pass");
      else for (const p of props) lines.push(`    ${sanitizeIdentifier(p.name)}: ${pyField(p.type, ctx)}`);
      lines.push("");
    }
  } else if (pythonStyle === "dataclass") {
    lines.push("from dataclasses import dataclass", "from typing import List, Optional, Union", "");
    for (const { name, props } of named) {
      lines.push("@dataclass", `class ${name}:`);
      if (props.length === 0) lines.push("    pass");
      else for (const p of props) lines.push(`    ${sanitizeIdentifier(p.name)}: ${pyField(p.type, ctx)}${p.optional ? " = None" : ""}`);
      lines.push("");
    }
  } else {
    lines.push("from typing import List, Optional, Union", "from pydantic import BaseModel", "");
    for (const { name, props } of named) {
      lines.push(`class ${name}(BaseModel):`);
      if (props.length === 0) lines.push("    pass");
      else for (const p of props) lines.push(`    ${sanitizeIdentifier(p.name)}: ${pyField(p.type, ctx)}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------

const phpField: FieldRenderer = (t, ctx) => {
  const { members, nullable } = splitUnion(t);
  const names = [...new Set(members.map((m) => phpBase(m, ctx)))];
  let base = names.length === 1 ? names[0] : names.join("|");
  if (nullable && !base.split("|").includes("null")) base = `${base}|null`;
  if (base.split("|").includes("mixed") && base.split("|").length > 1) base = "mixed";
  return base;
};

const phpBase = (t: AstType, ctx: GenCtx): string => {
  if (isObject(t)) return objectName(t, ctx);
  if (isArray(t)) return "array";
  switch (t.kind) {
    case "string":
      return "string";
    case "number":
      return "int|float";
    case "boolean":
      return "bool";
    case "null":
      return "null";
    default:
      return "mixed";
  }
};

function generatePhp(ctx: GenCtx): string {
  const lines: string[] = ["<?php", "", "declare(strict_types=1);", ""];
  for (const { name, props } of ctx.named) {
    lines.push(`final class ${name} {`);
    lines.push("    public function __construct(");
    for (const p of props) lines.push(`        public readonly ${phpField(p.type, ctx)} $${sanitizeIdentifier(p.name)},`);
    lines.push("    ) {}", "}", "");
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

const rustField: FieldRenderer = (t, ctx) => {
  const { members, nullable } = splitUnion(t);
  const names = members.map((m) => rustBase(m, ctx));
  const set = new Set(names);
  let base = set.size === 1 ? names[0] : "serde_json::Value";
  if (nullable) base = `Option<${base}>`;
  return base;
};

const rustBase = (t: AstType, ctx: GenCtx): string => {
  if (isObject(t)) return objectName(t, ctx);
  if (isArray(t)) return `Vec<${rustField(t.element, ctx)}>`;
  switch (t.kind) {
    case "string":
      return "String";
    case "number":
      return "f64";
    case "boolean":
      return "bool";
    default:
      return "serde_json::Value";
  }
};

function generateRust(ctx: GenCtx): string {
  const lines: string[] = ["use serde::{Deserialize, Serialize};", ""];
  for (const { name, props } of ctx.named) {
    lines.push("#[derive(Debug, Clone, Serialize, Deserialize)]", `pub struct ${name} {`);
    for (const p of props) {
      const valid = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p.name) && !p.optional;
      const attr = p.optional ? "#[serde(default)]" : valid ? "" : `#[serde(rename = "${p.name}")]`;
      if (attr) lines.push(`    ${attr}`);
      lines.push(`    pub ${sanitizeIdentifier(p.name)}: ${rustField(p.type, ctx)},`);
    }
    lines.push("}", "");
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Kotlin
// ---------------------------------------------------------------------------

const ktField: FieldRenderer = (t, ctx) => {
  const { members, nullable } = splitUnion(t);
  const names = members.map((m) => ktBase(m, ctx));
  const set = new Set(names);
  let base = set.size === 1 ? names[0] : "Any";
  if (nullable) base = `${base}?`;
  return base;
};

const ktBase = (t: AstType, ctx: GenCtx): string => {
  if (isObject(t)) return objectName(t, ctx);
  if (isArray(t)) return `List<${ktField(t.element, ctx)}>`;
  switch (t.kind) {
    case "string":
      return "String";
    case "number":
      return "Double";
    case "boolean":
      return "Boolean";
    default:
      return "Any";
  }
};

function generateKotlin(ctx: GenCtx): string {
  const lines: string[] = [];
  for (const { name, props } of ctx.named) {
    lines.push(`data class ${name}(`);
    if (props.length === 0) lines.push("    // empty");
    else for (const p of props) lines.push(`    val ${sanitizeIdentifier(p.name)}: ${ktField(p.type, ctx)}${p.optional ? " = null" : ""},`);
    lines.push(`)`, "");
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------

const csField: FieldRenderer = (t, ctx) => {
  const { members, nullable } = splitUnion(t);
  const names = members.map((m) => csBase(m, ctx));
  const set = new Set(names);
  let base = set.size === 1 ? names[0] : "object";
  if (nullable && base === "string") base = "string?";
  return base;
};

const csBase = (t: AstType, ctx: GenCtx): string => {
  if (isObject(t)) return objectName(t, ctx);
  if (isArray(t)) return `List<${csField(t.element, ctx)}>`;
  switch (t.kind) {
    case "string":
      return "string";
    case "number":
      return "double";
    case "boolean":
      return "bool";
    default:
      return "object";
  }
};

function generateCSharp(ctx: GenCtx): string {
  const lines: string[] = ["using System.Text.Json.Serialization;", ""];
  const style = ctx.csharpStyle;
  for (const { name, props } of ctx.named) {
    if (style === "record") {
      lines.push(`public record ${name}(`);
      props.forEach((p, i) => {
        const comma = i < props.length - 1 ? "," : "";
        lines.push(`    [property: JsonPropertyName("${p.name}")] ${csField(p.type, ctx)} ${sanitizeIdentifier(p.name)}${comma}`);
      });
      lines.push(`);`, "");
    } else {
      lines.push(`public class ${name}`, "{");
      for (const p of props) {
        lines.push(`    [JsonPropertyName("${p.name}")]`);
        lines.push(`    public ${csField(p.type, ctx)} ${sanitizeIdentifier(p.name)} { get; set; }`);
      }
      lines.push("}", "");
    }
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

const zodField: FieldRenderer = (t, ctx) => {
  const { members, nullable } = splitUnion(t);
  const names = members.map((m) => zodBase(m, ctx));
  const set = new Set(names);
  let base = set.size === 1 ? names[0] : `z.union([${names.join(", ")}])`;
  if (nullable) base = `${base}.nullable()`;
  return base;
};

const zodBase = (t: AstType, ctx: GenCtx): string => {
  if (isObject(t)) return `${objectName(t, ctx)}Schema`;
  if (isArray(t)) return `z.array(${zodField(t.element, ctx)})`;
  switch (t.kind) {
    case "string":
      return "z.string()";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    default:
      return "z.any()";
  }
};

function generateZod(ctx: GenCtx): string {
  const lines: string[] = ['import { z } from "zod";', ""];
  for (const { name, props } of ctx.named) {
    lines.push(`export const ${name}Schema = z.object({`);
    for (const p of props) lines.push(`  ${sanitizeIdentifier(p.name)}: ${zodField(p.type, ctx)},`);
    lines.push(`});`);
    lines.push(`export type ${name} = z.infer<typeof ${name}Schema>;`, "");
  }
  return lines.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// JSON Schema
// ---------------------------------------------------------------------------

function generateJsonSchema(ctx: GenCtx): string {
  const schema = jsonSchemaType(ctx.rootObject, ctx);
  return JSON.stringify({ $schema: "http://json-schema.org/draft-07/schema#", ...schema }, null, 2);
}

const jsonSchemaType = (t: AstType, ctx: GenCtx): Record<string, any> => {
  if (isArray(t)) {
    const el = t.element;
    if (isObject(el)) return { type: "array", items: { $ref: `#/definitions/${objectName(el, ctx)}` } };
    if (el.kind === "union") {
      const { members } = splitUnion(el);
      const kinds = [...new Set(members.map(jsonSchemaKind).filter(Boolean))];
      if (kinds.length === 1 && members.every((m) => !isObject(m))) {
        const single = kinds[0];
        return { type: "array", items: single === "object" ? { $ref: "#" } : { type: single } };
      }
    }
    return { type: "array", items: jsonSchemaType(el, ctx) };
  }
  if (isObject(t)) {
    const required: string[] = [];
    const properties: Record<string, any> = {};
    for (const p of t.properties.values()) {
      properties[p.name] = jsonSchemaType(p.type, ctx);
      if (!p.optional) required.push(p.name);
    }
    const out: Record<string, any> = { type: "object", properties };
    if (required.length) out.required = required;
    return out;
  }
  if (t.kind === "union") {
    const { members, nullable } = splitUnion(t);
    const anyOf = members.map((m) => jsonSchemaType(m, ctx));
    if (nullable) anyOf.push({ type: "null" });
    return { anyOf };
  }
  return { type: jsonSchemaKind(t) };
};

const jsonSchemaKind = (t: AstType): string => {
  switch (t.kind) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    default:
      return "object";
  }
};

// ---------------------------------------------------------------------------
// Registry of generators
// ---------------------------------------------------------------------------

type Generator = (ctx: GenCtx) => string;

const generators: Record<string, Generator> = {
  typescript: generateTypeScript,
  ts: generateTypeScript,
  go: generateGo,
  golang: generateGo,
  python: generatePython,
  py: generatePython,
  php: generatePhp,
  rust: generateRust,
  rs: generateRust,
  kotlin: generateKotlin,
  kt: generateKotlin,
  csharp: generateCSharp,
  cs: generateCSharp,
  zod: generateZod,
  json_schema: generateJsonSchema,
};

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const jsonToTypesTool: Tool = {
  name: "json_to_types",
  description:
    "Convert arbitrary JSON (string or file) into strongly-typed data structures, DTOs, and schemas across TypeScript, Go, Python, PHP, Rust, Kotlin, C#, Zod, and JSON Schema.",
  params: {
    json: { type: "string", description: "Raw JSON string to convert" },
    filePath: { type: "string", description: "Path to a JSON file on disk to read" },
    targetLanguage: {
      type: "string",
      description: "Target format: typescript, go, python, php, rust, kotlin, csharp, zod, json_schema (default: typescript)",
      default: "typescript",
    },
    rootName: { type: "string", description: "Name of the root type/class (default: Root)", default: "Root" },
    pythonStyle: { type: "string", description: "Python style: pydantic, dataclass, typeddict (default: pydantic)", default: "pydantic" },
    csharpStyle: { type: "string", description: "C# style: record, class (default: record)", default: "record" },
  },
  execute: async (params) => {
    const jsonParam = params.json;
    const filePath = params.filePath;

    let raw = "";
    if (jsonParam !== undefined && String(jsonParam).trim() !== "") raw = String(jsonParam);
    else if (filePath) {
      try {
        raw = await fs.readFile(path.resolve(filePath), "utf-8");
      } catch (err: any) {
        throw new Error(`Failed to read JSON file (${filePath}): ${err.message}`);
      }
    } else throw new Error("Either 'json' or 'filePath' must be provided");

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (error: any) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }

    const rootName = String(params.rootName || "Root");
    const inferred = inferType(parsed);
    const rootObject = isObject(inferred) ? inferred : isArray(inferred) && isObject(inferred.element) ? inferred.element : inferred;

    const { named, nameFor } = collectNamedTypes(rootObject, rootName);
    const ctx: GenCtx = {
      named,
      nameFor,
      rootName,
      rootObject,
      pythonStyle: String(params.pythonStyle || "pydantic"),
      csharpStyle: String(params.csharpStyle || "record"),
    };

    const target = String(params.targetLanguage || "typescript");
    const generator = generators[target];
    if (!generator) throw new Error(`Unknown targetLanguage "${target}". Supported: ${Object.keys(generators).join(", ")}`);

    return { content: [{ type: "text", text: generator(ctx) }] };
  },
};