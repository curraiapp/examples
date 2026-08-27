#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { argument, hasFlag } from "./lib/currai.mjs";

const root = argument("dir", process.cwd());
const json = hasFlag("json");

try {
  const result = detect(root);
  print(result);
} catch (error) {
  print({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
}

function detect(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`target directory does not exist: ${dir}`);
  }

  const packageJson = readJson(join(dir, "package.json"));
  const workspaceCandidates = findWorkspaceCandidates(dir);
  if (
    packageJson &&
    isWorkspaceRoot(dir, packageJson) &&
    workspaceCandidates.length
  ) {
    throw new Error(
      `monorepo root detected; rerun with --dir <target>. candidates: ${workspaceCandidates.join(", ")}`,
    );
  }

  if (packageJson) return detectNode(dir, packageJson);
  const python = readPythonProject(dir);
  if (python) return detectPython(dir, python);
  throw new Error(
    "no supported TypeScript, JavaScript, or Python project found",
  );
}

function detectNode(dir, packageJson) {
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
  };
  const has = (...names) => names.some((name) => name in dependencies);
  const runtime = has("next")
    ? "nextjs"
    : has("express")
      ? "express"
      : has("fastify")
        ? "fastify"
        : has("hono")
          ? "hono"
          : "node";

  let framework = "node-ts";
  let reason = "Generic TypeScript or JavaScript AI application";
  if (has("@modelcontextprotocol/sdk") && !hasAppSignals(has)) {
    framework = "mcp-ts";
    reason = "Dedicated TypeScript MCP server";
  } else if (has("@mastra/core", "mastra")) {
    framework = "mastra-ts";
    reason = "Mastra agent application";
  } else if (has("langchain", "@langchain/core")) {
    framework = "langchain-ts";
    reason = "LangChain TypeScript application";
  } else if (has("ai", "@ai-sdk/openai", "@ai-sdk/anthropic")) {
    framework = "vercel-ai";
    reason = "Vercel AI SDK application";
  } else if (has("openai", "@openai/agents")) {
    framework = "openai-ts";
    reason = "OpenAI TypeScript application";
  } else if (has("@anthropic-ai/sdk", "anthropic")) {
    framework = "anthropic-ts";
    reason = "Anthropic TypeScript application";
  } else if (has("@modelcontextprotocol/sdk")) {
    framework = "mcp-ts";
    reason = "TypeScript application containing an MCP server";
  }

  const language = isTypeScript(dir, dependencies)
    ? "typescript"
    : "javascript";
  return {
    ok: true,
    framework,
    language,
    runtime,
    transport: "native-http",
    reason,
    entrypoints: findEntrypoints(dir, framework),
    env: ["CURRAI_PUBLIC_KEY", "CURRAI_SECRET_KEY", "CURRAI_BASE_URL"],
  };
}

function detectPython(dir, projectText) {
  const has = (...names) =>
    names.some((name) => pythonDependency(projectText, name));
  let framework = "python";
  let reason = "Generic Python AI application";
  if (has("fastmcp", "mcp")) {
    framework = "mcp-py";
    reason = "Python MCP server";
  } else if (has("langchain", "langgraph")) {
    framework = "langchain-py";
    reason = "LangChain or LangGraph Python application";
  } else if (has("openai", "openai-agents")) {
    framework = "openai-py";
    reason = "OpenAI Python application";
  } else if (has("anthropic")) {
    framework = "anthropic-py";
    reason = "Anthropic Python application";
  }
  return {
    ok: true,
    framework,
    language: "python",
    runtime: has("fastapi") ? "fastapi" : has("flask") ? "flask" : "python",
    transport: "native-http",
    reason,
    entrypoints: findEntrypoints(dir, framework),
    env: ["CURRAI_PUBLIC_KEY", "CURRAI_SECRET_KEY", "CURRAI_BASE_URL"],
  };
}

function findEntrypoints(dir, framework) {
  const patterns = [
    /\b(generateText|streamText|generateObject)\s*\(/,
    /\b(responses\.create|chat\.completions\.create|messages\.create)\s*\(/,
    /\b(agent|graph|chain|workflow)\.(invoke|stream|run|execute)\s*\(/i,
    /\b(registerTool|setRequestHandler|server\.tool|@mcp\.tool)\b/,
  ];
  const boundaryPatterns = [
    /\bexport\s+async\s+function\s+POST\b/,
    /\b@app\.(post|route)\b/,
  ];
  const candidates = [];
  for (const file of sourceFiles(dir)) {
    const text = safeRead(file);
    let score = patterns.reduce(
      (total, pattern) => total + (pattern.test(text) ? 3 : 0),
      0,
    );
    if (score === 0 && boundaryPatterns.some((pattern) => pattern.test(text)))
      score = 1;
    if (/chat|agent|server|route|main|index/i.test(file)) score += 1;
    if (/(^|[\\/])(landing|content|docs?|examples?)([\\/]|$)/i.test(file))
      score -= 4;
    if (
      framework.startsWith("mcp") &&
      /modelcontextprotocol|fastmcp|\bmcp\b/i.test(text)
    ) {
      score += 3;
    }
    if (score > 0) candidates.push({ path: relative(dir, file), score });
  }
  const minimumScore = candidates.some((candidate) => candidate.score >= 3)
    ? 3
    : 1;
  return candidates
    .filter((candidate) => candidate.score >= minimumScore)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 8)
    .map(({ path }) => path);
}

function sourceFiles(dir) {
  const files = [];
  const ignored = new Set([
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "build",
    "coverage",
    "dist",
    "generated",
    "node_modules",
    "tests",
    "test",
    "__tests__",
    "vendor",
  ]);
  const extensions = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
  ]);
  walk(dir);
  return files;

  function walk(path) {
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      if (path !== dir && ignored.has(path.split(/[\\/]/).pop())) return;
      for (const entry of readdirSync(path)) walk(join(path, entry));
      return;
    }
    if (stat.size > 1_000_000 || !extensions.has(extname(path))) return;
    if (path.endsWith(".d.ts") || path.endsWith(".min.js")) return;
    files.push(path);
  }
}

function findWorkspaceCandidates(dir) {
  const candidates = [];
  for (const base of ["apps", "packages", "services"]) {
    const basePath = join(dir, base);
    if (!existsSync(basePath)) continue;
    for (const entry of readdirSync(basePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const target = join(basePath, entry.name);
      if (
        existsSync(join(target, "package.json")) ||
        readPythonProject(target)
      ) {
        candidates.push(`${base}/${entry.name}`);
      }
    }
  }
  return candidates;
}

function isWorkspaceRoot(dir, packageJson) {
  return Boolean(
    packageJson.workspaces ||
      existsSync(join(dir, "pnpm-workspace.yaml")) ||
      existsSync(join(dir, "lerna.json")) ||
      existsSync(join(dir, "nx.json")) ||
      existsSync(join(dir, "turbo.json")),
  );
}

function isTypeScript(dir, dependencies) {
  return Boolean(
    existsSync(join(dir, "tsconfig.json")) ||
      "typescript" in dependencies ||
      sourceFiles(dir).some((file) => /\.tsx?$/.test(file)),
  );
}

function hasAppSignals(has) {
  return has(
    "next",
    "react",
    "express",
    "fastify",
    "hono",
    "ai",
    "openai",
    "@openai/agents",
    "@anthropic-ai/sdk",
    "langchain",
    "@langchain/core",
    "@mastra/core",
    "mastra",
  );
}

function readPythonProject(dir) {
  let found = false;
  let text = "";
  for (const file of [
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "Pipfile",
  ]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    found = true;
    text += `\n${safeRead(path)}`;
  }
  return found ? text.toLowerCase() : null;
}

function pythonDependency(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_.-])${escaped}([^a-z0-9_.-]|$)`, "i").test(
    text,
  );
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function print(value) {
  if (json) {
    console.log(JSON.stringify(value));
    return;
  }
  if (!value.ok) {
    console.error(`error: ${value.error}`);
    return;
  }
  console.log(`framework:  ${value.framework}`);
  console.log(`language:   ${value.language}`);
  console.log(`runtime:    ${value.runtime}`);
  console.log(`transport:  ${value.transport}`);
  console.log(`reason:     ${value.reason}`);
  for (const entrypoint of value.entrypoints)
    console.log(`entrypoint: ${entrypoint}`);
}
