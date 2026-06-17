#!/usr/bin/env node
/**
 * format-json-schemas.mjs — normalize generated JSON Schema artifacts.
 *
 * Input/output: packages/schemas-ts/src/generated/json-schema/*.json
 *
 * This is an explicit codegen formatting step after the Pydantic JSON Schema dump
 * and before TypeScript generation.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const INPUT_DIR = join(
  ROOT,
  "packages",
  "schemas-ts",
  "src",
  "generated",
  "json-schema",
);

if (!existsSync(INPUT_DIR)) {
  console.log(
    `[codegen] 缺 ${INPUT_DIR}；请先运行 \`uv run python scripts/codegen/generate-json-schemas.py\``,
  );
  process.exit(1);
}

const inputs = readdirSync(INPUT_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort((a, b) => a.localeCompare(b, "en"));

if (inputs.length === 0) {
  console.log("[codegen] 无输入 JSON Schema");
  process.exit(1);
}

for (const f of inputs) {
  const schemaPath = join(INPUT_DIR, f);
  const schemaBody = readFileSync(schemaPath, "utf8");
  const formattedSchemaBody = await prettier.format(schemaBody, {
    filepath: schemaPath,
    parser: "json",
  });
  writeFileSync(schemaPath, formattedSchemaBody, "utf8");
  console.log(`[codegen] formatted ${schemaPath}`);
}
