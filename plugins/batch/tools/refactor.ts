#!/usr/bin/env bun
/**
 * refactor.ts - Multi-language refactoring CLI
 *
 * Editset workflow: propose → select → apply
 *
 * Backends:
 *   ts-morph  - TypeScript/JavaScript identifiers (priority 100)
 *   ast-grep  - Structural patterns for Go, Rust, Python, JSON, YAML (priority 50)
 *   ripgrep   - Text patterns for any file (priority 10)
 *
 * Commands:
 *   symbol.at <file> <line> [col]     Find symbol at location (ts-morph)
 *   refs.list <symbolKey>             List all references (ts-morph)
 *   symbols.find --pattern <regex>    Find all symbols matching pattern (ts-morph)
 *   rename.propose <symbolKey> <new>  Create rename editset (ts-morph)
 *   rename.batch --pattern <p> --replace <r>  Batch rename proposal (ts-morph)
 *   pattern.find --pattern <p>        Find structural patterns (ast-grep/ripgrep)
 *   pattern.replace --pattern <p> --replace <r>  Create pattern replace editset
 *   editset.select <file> --exclude   Filter editset
 *   editset.apply <file>              Apply editset with checksums
 *   editset.verify <file>             Verify editset can be applied
 */

// Import backends (they register themselves)
import {
  getProject,
  getSymbolAt,
  getReferences,
  findSymbols,
  createRenameProposal,
  createBatchRenameProposal,
  createBatchRenameProposalFiltered,
  checkConflicts,
} from "./lib/backends/ts-morph"
import { findPatterns as astGrepFindPatterns, createPatternReplaceProposal as astGrepReplace } from "./lib/backends/ast-grep"
import { findPatterns as rgFindPatterns, createPatternReplaceProposal as rgReplace } from "./lib/backends/ripgrep"
import { getBackendByName, getBackends } from "./lib/backend"

// Import core utilities
import { filterEditset, saveEditset, loadEditset } from "./lib/core/editset"
import { applyEditset, verifyEditset } from "./lib/core/apply"
import {
  findFilesToRename,
  checkFileConflicts,
  createFileRenameProposal,
  verifyFileEditset,
  applyFileRenames,
  saveFileEditset,
  loadFileEditset,
} from "./lib/core/file-ops"

const args = process.argv.slice(2)
const command = args[0]

function output(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}

function error(message: string): never {
  console.error(JSON.stringify({ error: message }))
  process.exit(1)
}

function usage(): never {
  console.error(`Usage: refactor.ts <command> [options]

TypeScript/JavaScript Commands (ts-morph):
  symbol.at <file> <line> [col]           Find symbol at location
  refs.list <symbolKey>                   List all references
  symbols.find --pattern <regex>          Find all symbols matching pattern

  rename.propose <symbolKey> <newName>    Create rename editset
    --output <file>                       Output file (default: editset.json)

  rename.batch                            Batch rename proposal
    --pattern <regex>                     Symbol pattern to match
    --replace <string>                    Replacement string
    --output <file>                       Output file (default: editset.json)
    --check-conflicts                     Check for naming conflicts (no editset generated)
    --skip <names>                        Comma-separated symbol names to skip

File Operations:
  file.find                               Find files to rename
    --pattern <string>                    Filename pattern to match (e.g., "vault")
    --replace <string>                    Replacement (e.g., "repo")
    --glob <glob>                         File glob filter (default: **/*.{ts,tsx})

  file.rename                             Create file rename editset
    --pattern <string>                    Filename pattern to match
    --replace <string>                    Replacement
    --glob <glob>                         File glob filter (default: **/*.{ts,tsx})
    --output <file>                       Output file (default: file-editset.json)
    --check-conflicts                     Check for naming conflicts only

  file.apply <file>                       Apply file rename editset
    --dry-run                             Preview without applying

  file.verify <file>                      Verify file editset can be applied

Multi-Language Commands (ast-grep/ripgrep):
  pattern.find                            Find structural patterns
    --pattern <pattern>                   ast-grep pattern (e.g., "fmt.Println($MSG)")
    --glob <glob>                         File glob filter (e.g., "**/*.go")
    --backend <name>                      Force backend: ast-grep, ripgrep (auto-detected)

  pattern.replace                         Create pattern replace editset
    --pattern <pattern>                   Pattern to match
    --replace <replacement>               Replacement (supports $1, $MSG metavars)
    --glob <glob>                         File glob filter
    --backend <name>                      Force backend: ast-grep, ripgrep
    --output <file>                       Output file (default: editset.json)

  backends.list                           List available backends

Editset Commands:
  editset.select <file>                   Filter editset
    --include <refIds>                    Comma-separated refIds to include
    --exclude <refIds>                    Comma-separated refIds to exclude
    --output <file>                       Output file (default: overwrites input)

  editset.apply <file>                    Apply editset with checksums
    --dry-run                             Preview without applying

  editset.verify <file>                   Verify editset can be applied

Global Options:
  --tsconfig <file>                       Path to tsconfig.json (default: tsconfig.json)

Examples:
  # TypeScript: Find symbol at location
  refactor.ts symbol.at src/types.ts 42 5

  # TypeScript: Batch rename widget → gadget
  refactor.ts rename.batch --pattern widget --replace gadget --output editset.json

  # File rename: vault*.ts → repo*.ts
  refactor.ts file.rename --pattern vault --replace repo --glob "**/*.ts" --output file-editset.json
  refactor.ts file.apply file-editset.json --dry-run
  refactor.ts file.apply file-editset.json

  # Go: Find all fmt.Println calls
  refactor.ts pattern.find --pattern "fmt.Println(\$MSG)" --glob "**/*.go"

  # Go: Replace fmt.Println with log.Info
  refactor.ts pattern.replace --pattern "fmt.Println(\$MSG)" --replace "log.Info(\$MSG)" --glob "**/*.go"

  # Markdown: Replace "widget" with "gadget" in all docs
  refactor.ts pattern.replace --pattern "widget" --replace "gadget" --glob "**/*.md" --backend ripgrep

  # Preview changes
  refactor.ts editset.apply editset.json --dry-run

  # Apply changes
  refactor.ts editset.apply editset.json
`)
  process.exit(1)
}

function getArg(name: string): string | undefined {
  const idx = args.indexOf(name)
  if (idx === -1) return undefined
  return args[idx + 1]
}

function hasFlag(name: string): boolean {
  return args.includes(name)
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    usage()
  }

  // Lazy project loading - only load when needed
  const tsConfigPath = getArg("--tsconfig") || "tsconfig.json"
  const lazyProject = () => getProject(tsConfigPath)

  switch (command) {
    case "symbol.at": {
      const file = args[1]
      const line = parseInt(args[2], 10)
      const col = parseInt(args[3] || "1", 10)

      if (!file || isNaN(line)) {
        error("Usage: symbol.at <file> <line> [col]")
      }

      const symbol = getSymbolAt(lazyProject(), file, line, col)
      if (!symbol) {
        error(`No symbol found at ${file}:${line}:${col}`)
      }
      output(symbol)
      break
    }

    case "refs.list": {
      const symbolKey = args[1]
      if (!symbolKey) {
        error("Usage: refs.list <symbolKey>")
      }

      const refs = getReferences(lazyProject(), symbolKey)
      output(refs)
      break
    }

    case "symbols.find": {
      const pattern = getArg("--pattern")
      if (!pattern) {
        error("Usage: symbols.find --pattern <regex>")
      }

      const regex = new RegExp(pattern, "i")
      const symbols = findSymbols(lazyProject(), regex)
      output(symbols)
      break
    }

    case "rename.propose": {
      const symbolKey = args[1]
      const newName = args[2]
      const outputFile = getArg("--output") || "editset.json"

      if (!symbolKey || !newName) {
        error("Usage: rename.propose <symbolKey> <newName> [--output file]")
      }

      const editset = createRenameProposal(lazyProject(), symbolKey, newName)
      saveEditset(editset, outputFile)
      output({
        editsetPath: outputFile,
        refCount: editset.refs.length,
        fileCount: new Set(editset.refs.map((r) => r.file)).size,
      })
      break
    }

    case "rename.batch": {
      const pattern = getArg("--pattern")
      const replacement = getArg("--replace")
      const outputFile = getArg("--output") || "editset.json"
      const checkConflictsFlag = hasFlag("--check-conflicts")
      const skipNames = getArg("--skip")?.split(",") || []

      if (!pattern || !replacement) {
        error("Usage: rename.batch --pattern <regex> --replace <string> [--output file] [--check-conflicts] [--skip names]")
      }

      const regex = new RegExp(pattern, "i")

      // Check for conflicts mode
      if (checkConflictsFlag) {
        const report = checkConflicts(lazyProject(), regex, replacement)
        output(report)
        break
      }

      // Normal batch rename (with optional skip)
      const symbols = findSymbols(lazyProject(), regex)
      const skippedCount = skipNames.length > 0 ? symbols.filter((s) => skipNames.includes(s.name)).length : 0
      console.error(`Found ${symbols.length} symbols matching /${pattern}/i`)
      if (skippedCount > 0) {
        console.error(`Skipping ${skippedCount} symbols: ${skipNames.join(", ")}`)
      }

      const editset =
        skipNames.length > 0
          ? createBatchRenameProposalFiltered(lazyProject(), regex, replacement, skipNames)
          : createBatchRenameProposal(lazyProject(), regex, replacement)
      saveEditset(editset, outputFile)

      output({
        editsetPath: outputFile,
        refCount: editset.refs.length,
        fileCount: new Set(editset.refs.map((r) => r.file)).size,
        symbolCount: symbols.length - skippedCount,
        skippedSymbols: skipNames.length > 0 ? skipNames : undefined,
      })
      break
    }

    case "editset.select": {
      const inputFile = args[1]
      const include = getArg("--include")?.split(",")
      const exclude = getArg("--exclude")?.split(",")
      const outputFile = getArg("--output") || inputFile

      if (!inputFile) {
        error("Usage: editset.select <file> [--include refIds] [--exclude refIds] [--output file]")
      }

      const editset = loadEditset(inputFile)
      const filtered = filterEditset(editset, include, exclude)
      saveEditset(filtered, outputFile)

      const selectedCount = filtered.refs.filter((r) => r.selected).length
      output({
        editsetPath: outputFile,
        selectedRefs: selectedCount,
        totalRefs: filtered.refs.length,
      })
      break
    }

    case "editset.apply": {
      const inputFile = args[1]
      const dryRun = hasFlag("--dry-run")

      if (!inputFile) {
        error("Usage: editset.apply <file> [--dry-run]")
      }

      const editset = loadEditset(inputFile)
      const result = applyEditset(editset, dryRun)

      if (dryRun) {
        console.error("[DRY RUN - no changes applied]")
      }

      output(result)
      break
    }

    case "editset.verify": {
      const inputFile = args[1]

      if (!inputFile) {
        error("Usage: editset.verify <file>")
      }

      const editset = loadEditset(inputFile)
      const result = verifyEditset(editset)
      output(result)
      break
    }

    case "pattern.find": {
      const pattern = getArg("--pattern")
      const glob = getArg("--glob")
      const backendName = getArg("--backend")

      if (!pattern) {
        error("Usage: pattern.find --pattern <pattern> [--glob <glob>] [--backend ast-grep|ripgrep]")
      }

      // Choose backend
      let refs
      if (backendName === "ast-grep") {
        refs = astGrepFindPatterns(pattern, glob)
      } else if (backendName === "ripgrep") {
        refs = rgFindPatterns(pattern, glob)
      } else {
        // Auto-detect: prefer ast-grep for structural patterns, ripgrep for text
        // Heuristic: if pattern contains $METAVAR, use ast-grep
        if (pattern.includes("$")) {
          refs = astGrepFindPatterns(pattern, glob)
        } else {
          refs = rgFindPatterns(pattern, glob)
        }
      }

      output(refs)
      break
    }

    case "pattern.replace": {
      const pattern = getArg("--pattern")
      const replacement = getArg("--replace")
      const glob = getArg("--glob")
      const backendName = getArg("--backend")
      const outputFile = getArg("--output") || "editset.json"

      if (!pattern || !replacement) {
        error("Usage: pattern.replace --pattern <pattern> --replace <replacement> [--glob <glob>] [--backend ast-grep|ripgrep] [--output file]")
      }

      // Choose backend
      let editset
      if (backendName === "ast-grep") {
        editset = astGrepReplace(pattern, replacement, glob)
      } else if (backendName === "ripgrep") {
        editset = rgReplace(pattern, replacement, glob)
      } else {
        // Auto-detect: prefer ast-grep for structural patterns
        if (pattern.includes("$")) {
          editset = astGrepReplace(pattern, replacement, glob)
        } else {
          editset = rgReplace(pattern, replacement, glob)
        }
      }

      saveEditset(editset, outputFile)
      output({
        editsetPath: outputFile,
        refCount: editset.refs.length,
        fileCount: new Set(editset.refs.map((r) => r.file)).size,
        backend: backendName || (pattern.includes("$") ? "ast-grep" : "ripgrep"),
      })
      break
    }

    case "backends.list": {
      const backends = getBackends()
      output(
        backends.map((b) => ({
          name: b.name,
          extensions: b.extensions,
          priority: b.priority,
          capabilities: {
            findPatterns: !!b.findPatterns,
            createPatternReplaceProposal: !!b.createPatternReplaceProposal,
            getSymbolAt: !!b.getSymbolAt,
            getReferences: !!b.getReferences,
            findSymbols: !!b.findSymbols,
            createRenameProposal: !!b.createRenameProposal,
            createBatchRenameProposal: !!b.createBatchRenameProposal,
          },
        }))
      )
      break
    }

    // File operations
    case "file.find": {
      const pattern = getArg("--pattern")
      const replacement = getArg("--replace")
      const glob = getArg("--glob") || "**/*.{ts,tsx,js,jsx}"

      if (!pattern || !replacement) {
        error("Usage: file.find --pattern <string> --replace <string> [--glob <glob>]")
      }

      const fileOps = await findFilesToRename(pattern, replacement, glob)
      output({
        pattern,
        replacement,
        glob,
        files: fileOps.map((op) => ({
          oldPath: op.oldPath,
          newPath: op.newPath,
        })),
        count: fileOps.length,
      })
      break
    }

    case "file.rename": {
      const pattern = getArg("--pattern")
      const replacement = getArg("--replace")
      const glob = getArg("--glob") || "**/*.{ts,tsx,js,jsx}"
      const outputFile = getArg("--output") || "file-editset.json"
      const checkConflictsFlag = hasFlag("--check-conflicts")

      if (!pattern || !replacement) {
        error("Usage: file.rename --pattern <string> --replace <string> [--glob <glob>] [--output file] [--check-conflicts]")
      }

      // Find files to rename
      const fileOps = await findFilesToRename(pattern, replacement, glob)

      if (fileOps.length === 0) {
        output({ message: "No files found matching pattern", pattern, glob })
        break
      }

      // Check conflicts mode
      if (checkConflictsFlag) {
        const report = checkFileConflicts(fileOps)
        output({
          conflicts: report.conflicts,
          safe: report.safe.map((op) => ({ oldPath: op.oldPath, newPath: op.newPath })),
          conflictCount: report.conflicts.length,
          safeCount: report.safe.length,
        })
        break
      }

      // Create editset
      const editset = await createFileRenameProposal(pattern, replacement, glob)
      saveFileEditset(editset, outputFile)

      output({
        editsetPath: outputFile,
        fileCount: editset.fileOps.length,
        importEditCount: editset.importEdits.length,
        files: editset.fileOps.map((op) => ({ oldPath: op.oldPath, newPath: op.newPath })),
      })
      break
    }

    case "file.verify": {
      const inputFile = args[1]

      if (!inputFile) {
        error("Usage: file.verify <file>")
      }

      const editset = loadFileEditset(inputFile)
      const result = verifyFileEditset(editset)
      output({
        valid: result.valid,
        drifted: result.drifted,
        fileCount: editset.fileOps.length,
      })
      break
    }

    case "file.apply": {
      const inputFile = args[1]
      const dryRun = hasFlag("--dry-run")

      if (!inputFile) {
        error("Usage: file.apply <file> [--dry-run]")
      }

      const editset = loadFileEditset(inputFile)
      const result = applyFileRenames(editset, dryRun)

      if (dryRun) {
        console.error("[DRY RUN - no files renamed]")
      }

      output({
        applied: result.applied,
        skipped: result.skipped,
        errors: result.errors,
        dryRun,
      })
      break
    }

    default:
      error(`Unknown command: ${command}`)
  }
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err))
})
