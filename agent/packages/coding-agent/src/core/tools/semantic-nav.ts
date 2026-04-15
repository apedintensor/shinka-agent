/**
 * Semantic Navigation Tool — regex-based code structure analysis.
 * No external deps (no tree-sitter, no LSP). Works in Docker.
 *
 * Operations:
 * - documentSymbol: list all definitions (functions, classes, exports) in a file
 * - findDefinition: find where a symbol is defined across the workspace
 * - findReferences: find files that import/reference a symbol
 */

import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { type Static, Type } from "@sinclair/typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { resolveToCwd } from "./path-utils.js";

// --- Schema ---

const semanticNavSchema = Type.Object({
	operation: Type.Union([
		Type.Literal("documentSymbol"),
		Type.Literal("findDefinition"),
		Type.Literal("findReferences"),
	], { description: "The semantic navigation operation to perform" }),
	filePath: Type.String({ description: "File path to analyze (relative to cwd)" }),
	symbolName: Type.Optional(Type.String({ description: "Symbol name for findDefinition/findReferences" })),
});

type SemanticNavParams = Static<typeof semanticNavSchema>;

interface SymbolInfo {
	name: string;
	kind: string;
	line: number;
}

// --- Language-specific definition patterns ---

const DEFINITION_PATTERNS: Record<string, RegExp[]> = {
	ts: [
		/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
		/^(?:export\s+)?class\s+(\w+)/,
		/^(?:export\s+)?interface\s+(\w+)/,
		/^(?:export\s+)?type\s+(\w+)\s*=/,
		/^(?:export\s+)?enum\s+(\w+)/,
		/^(?:export\s+)?const\s+(\w+)\s*[:=]/,
		/^(?:export\s+)?let\s+(\w+)\s*[:=]/,
		/^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/,  // method
	],
	py: [
		/^\s*def\s+(\w+)\s*\(/,
		/^\s*class\s+(\w+)/,
		/^(\w+)\s*=\s*/,
	],
	go: [
		/^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/,
		/^type\s+(\w+)\s+(?:struct|interface)/,
		/^var\s+(\w+)\s/,
		/^const\s+(\w+)\s/,
	],
	java: [
		/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?class\s+(\w+)/,
		/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?\w+\s+(\w+)\s*\(/,
		/^\s*(?:public|private|protected)?\s*interface\s+(\w+)/,
		/^\s*(?:public|private|protected)?\s*enum\s+(\w+)/,
	],
	rb: [
		/^\s*def\s+(\w+)/,
		/^\s*class\s+(\w+)/,
		/^\s*module\s+(\w+)/,
	],
	vue: [
		/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
		/^(?:export\s+)?const\s+(\w+)\s*[:=]/,
		/name:\s*['"](\w+)['"]/,
	],
};

// Map extensions to pattern keys
const EXT_MAP: Record<string, string> = {
	".ts": "ts", ".tsx": "ts", ".js": "ts", ".jsx": "ts", ".mjs": "ts", ".cjs": "ts",
	".py": "py", ".pyi": "py",
	".go": "go",
	".java": "java", ".kt": "java",
	".rb": "rb",
	".vue": "vue", ".svelte": "vue",
};

// --- Import patterns ---

const IMPORT_PATTERNS: RegExp[] = [
	/import\s+.*\bfrom\s+['"]([^'"]+)['"]/,          // ES import
	/import\s+['"]([^'"]+)['"]/,                       // side-effect import
	/require\s*\(\s*['"]([^'"]+)['"]\s*\)/,            // CommonJS
	/from\s+(\S+)\s+import/,                            // Python
];

// --- Core functions ---

function extractSymbols(content: string, ext: string): SymbolInfo[] {
	const lang = EXT_MAP[ext];
	if (!lang) return [];
	const patterns = DEFINITION_PATTERNS[lang];
	if (!patterns) return [];

	const symbols: SymbolInfo[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		for (const pattern of patterns) {
			const match = line.match(pattern);
			if (match && match[1]) {
				const name = match[1];
				// Skip common false positives
				if (["if", "else", "for", "while", "return", "switch", "case", "try", "catch", "new", "this", "super"].includes(name)) continue;
				const kind = classifyKind(line, lang);
				symbols.push({ name, kind, line: i + 1 });
				break; // one match per line
			}
		}
	}
	return symbols;
}

function classifyKind(line: string, _lang: string): string {
	if (/\bclass\b/.test(line)) return "class";
	if (/\binterface\b/.test(line)) return "interface";
	if (/\btype\b.*=/.test(line)) return "type";
	if (/\benum\b/.test(line)) return "enum";
	if (/\bfunction\b/.test(line) || /\basync\s+function\b/.test(line)) return "function";
	if (/\bdef\b/.test(line)) return "function";
	if (/\bfunc\b/.test(line)) return "function";
	if (/\bconst\b/.test(line) || /\blet\b/.test(line) || /\bvar\b/.test(line)) return "variable";
	if (/^\s+\w+\s*\(/.test(line)) return "method";
	return "definition";
}

interface DefResult { name: string; kind: string; line: number; file: string }

function findDefinitionInWorkspace(cwd: string, symbolName: string): DefResult[] {
	const results: DefResult[] = [];
	try {
		// Use grep to find candidate files quickly
		const grepOutput = execSync(
			`grep -rn "\\b${symbolName}\\b" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.java" --include="*.kt" --include="*.rb" --include="*.vue" . 2>/dev/null | grep -v node_modules | grep -v .git | grep -v dist/ | head -50`,
			{ cwd, timeout: 5000, encoding: "utf-8" },
		).trim();

		if (!grepOutput) return results;

		// For each match, check if it's a DEFINITION (not just usage)
		const seen = new Set<string>();
		for (const line of grepOutput.split("\n")) {
			const colonIdx = line.indexOf(":");
			if (colonIdx < 0) continue;
			const filePart = line.substring(0, colonIdx).replace("./", "");
			const rest = line.substring(colonIdx + 1);
			const lineNumIdx = rest.indexOf(":");
			if (lineNumIdx < 0) continue;
			const lineNum = parseInt(rest.substring(0, lineNumIdx));
			const content = rest.substring(lineNumIdx + 1);

			if (seen.has(filePart + ":" + lineNum)) continue;
			seen.add(filePart + ":" + lineNum);

			// Check if this line is a definition
			const ext = path.extname(filePart);
			const lang = EXT_MAP[ext];
			if (!lang) continue;
			const patterns = DEFINITION_PATTERNS[lang];
			if (!patterns) continue;

			for (const pattern of patterns) {
				const match = content.match(pattern);
				if (match && match[1] === symbolName) {
					results.push({
						file: filePart,
						name: symbolName,
						kind: classifyKind(content, lang),
						line: lineNum,
					});
					break;
				}
			}
		}
	} catch {}
	return results;
}

interface RefInfo { file: string; line: number; kind: string }

function findReferencesInWorkspace(cwd: string, symbolName: string, sourceFile: string): RefInfo[] {
	const results: RefInfo[] = [];
	try {
		const grepOutput = execSync(
			`grep -rn "\\b${symbolName}\\b" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.java" --include="*.kt" --include="*.rb" --include="*.vue" . 2>/dev/null | grep -v node_modules | grep -v .git | grep -v dist/ | head -50`,
			{ cwd, timeout: 5000, encoding: "utf-8" },
		).trim();

		if (!grepOutput) return results;

		const seen = new Set<string>();
		for (const line of grepOutput.split("\n")) {
			const colonIdx = line.indexOf(":");
			if (colonIdx < 0) continue;
			const filePart = line.substring(0, colonIdx).replace("./", "");
			if (filePart === sourceFile) continue; // skip source file
			const rest = line.substring(colonIdx + 1);
			const lineNumIdx = rest.indexOf(":");
			if (lineNumIdx < 0) continue;
			const lineNum = parseInt(rest.substring(0, lineNumIdx));
			const content = rest.substring(lineNumIdx + 1);

			if (seen.has(filePart)) continue;
			seen.add(filePart);

			// Classify: import or usage
			const isImport = IMPORT_PATTERNS.some((p) => p.test(content));
			results.push({
				file: filePart,
				line: lineNum,
				kind: isImport ? "import" : "usage",
			});
		}
	} catch {}
	return results;
}

// --- Tool definition ---

export function createSemanticNavToolDefinition(cwd: string): ToolDefinition<typeof semanticNavSchema> {
	return {
		name: "semantic_nav",
		label: "Semantic Navigation",
		description:
			"Analyze code structure semantically. Operations: documentSymbol (list definitions in a file), findDefinition (find where a symbol is defined), findReferences (find files that use a symbol). Use this to understand code relationships before editing.",
		promptSnippet: "semantic_nav: Analyze code structure — list definitions, find where symbols are defined, find references",
		parameters: semanticNavSchema,
		async execute(_toolCallId, params: SemanticNavParams) {
			const resolvedPath = resolveToCwd(params.filePath, cwd);

			if (params.operation === "documentSymbol") {
				if (!existsSync(resolvedPath)) {
					return { content: [{ type: "text" as const, text: `File not found: ${params.filePath}` }], details: {} };
				}
				const content = readFileSync(resolvedPath, "utf-8");
				const ext = path.extname(resolvedPath);
				const symbols = extractSymbols(content, ext);

				if (symbols.length === 0) {
					return { content: [{ type: "text" as const, text: `No symbols found in ${params.filePath} (unsupported language or empty file)` }], details: {} };
				}

				const formatted = symbols
					.map((s) => `  L${s.line}: ${s.kind} ${s.name}`)
					.join("\n");
				return {
					content: [{ type: "text" as const, text: `Symbols in ${params.filePath} (${symbols.length}):\n${formatted}` }],
					details: {},
				};
			}

			if (params.operation === "findDefinition") {
				if (!params.symbolName) {
					return { content: [{ type: "text" as const, text: "symbolName is required for findDefinition" }], details: {} };
				}
				const results = findDefinitionInWorkspace(cwd, params.symbolName);
				if (results.length === 0) {
					return { content: [{ type: "text" as const, text: `No definition found for '${params.symbolName}'` }], details: {} };
				}
				const formatted = results
					.map((r) => `  ${r.file}:${r.line} (${r.kind})`)
					.join("\n");
				const fileCount = new Set(results.map((r) => r.file)).size;
				return {
					content: [{ type: "text" as const, text: `Definition of '${params.symbolName}' found in ${fileCount} file(s):\n${formatted}` }],
					details: {},
				};
			}

			if (params.operation === "findReferences") {
				if (!params.symbolName) {
					return { content: [{ type: "text" as const, text: "symbolName is required for findReferences" }], details: {} };
				}
				const results = findReferencesInWorkspace(cwd, params.symbolName, params.filePath);
				if (results.length === 0) {
					return { content: [{ type: "text" as const, text: `No references found for '${params.symbolName}' outside ${params.filePath}` }], details: {} };
				}
				const formatted = results
					.map((r) => `  ${r.file}:${r.line} (${r.kind})`)
					.join("\n");
				return {
					content: [{ type: "text" as const, text: `References to '${params.symbolName}' (${results.length} files):\n${formatted}` }],
					details: {},
				};
			}

			return { content: [{ type: "text" as const, text: `Unknown operation: ${params.operation}` }], details: {} };
		},
	};
}

export function createSemanticNavTool(cwd: string): AgentTool {
	return wrapToolDefinition(createSemanticNavToolDefinition(cwd));
}
