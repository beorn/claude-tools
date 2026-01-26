#!/usr/bin/env bun
/**
 * ts-batch-rename.ts - Batch TypeScript symbol renaming using ts-morph
 *
 * Discovers all TypeScript symbols matching a pattern and renames them.
 * Unlike ts-rename.ts (single symbol), this handles terminology migrations.
 *
 * Usage:
 *   # Find all symbols containing "vault"
 *   bun run ts-batch-rename.ts --find vault
 *
 *   # Preview renaming vault→repo for all symbols
 *   bun run ts-batch-rename.ts --pattern vault --replace repo --dry-run
 *
 *   # Apply the renames
 *   bun run ts-batch-rename.ts --pattern vault --replace repo
 *
 *   # Use a rename map file
 *   bun run ts-batch-rename.ts --map renames.json --dry-run
 *
 * Rename map format (renames.json):
 *   {
 *     "vaultDir": "repoDir",
 *     "vaultPath": "repoPath",
 *     "Vault": "Repo"
 *   }
 */

import { Project, Node, SyntaxKind, SourceFile } from "ts-morph"
import { existsSync, readFileSync } from "fs"

interface SymbolInfo {
  name: string
  kind: string
  file: string
  line: number
  references: number
}

interface RenameResult {
  symbol: string
  newName: string
  references: number
  files: string[]
  success: boolean
  error?: string
}

function findSymbolsMatching(project: Project, pattern: RegExp): SymbolInfo[] {
  const symbols: SymbolInfo[] = []
  const seen = new Set<string>()

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()

    // Skip node_modules and other non-project files
    if (filePath.includes("node_modules")) continue

    // Find interfaces
    for (const intf of sourceFile.getInterfaces()) {
      if (pattern.test(intf.getName())) {
        const key = `interface:${intf.getName()}:${filePath}`
        if (!seen.has(key)) {
          seen.add(key)
          symbols.push({
            name: intf.getName(),
            kind: "interface",
            file: filePath.replace(process.cwd() + "/", ""),
            line: intf.getStartLineNumber(),
            references: intf.findReferencesAsNodes().length,
          })
        }
      }

      // Find properties within interfaces
      for (const prop of intf.getProperties()) {
        if (pattern.test(prop.getName())) {
          const key = `property:${prop.getName()}:${filePath}:${prop.getStartLineNumber()}`
          if (!seen.has(key)) {
            seen.add(key)
            symbols.push({
              name: prop.getName(),
              kind: "property",
              file: filePath.replace(process.cwd() + "/", ""),
              line: prop.getStartLineNumber(),
              references: prop.findReferencesAsNodes().length,
            })
          }
        }
      }
    }

    // Find type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      if (pattern.test(typeAlias.getName())) {
        const key = `type:${typeAlias.getName()}:${filePath}`
        if (!seen.has(key)) {
          seen.add(key)
          symbols.push({
            name: typeAlias.getName(),
            kind: "type",
            file: filePath.replace(process.cwd() + "/", ""),
            line: typeAlias.getStartLineNumber(),
            references: typeAlias.findReferencesAsNodes().length,
          })
        }
      }
    }

    // Find functions
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName()
      if (name && pattern.test(name)) {
        const key = `function:${name}:${filePath}`
        if (!seen.has(key)) {
          seen.add(key)
          symbols.push({
            name,
            kind: "function",
            file: filePath.replace(process.cwd() + "/", ""),
            line: func.getStartLineNumber(),
            references: func.findReferencesAsNodes().length,
          })
        }
      }
    }

    // Find variable declarations (const, let, var)
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      if (pattern.test(varDecl.getName())) {
        const key = `variable:${varDecl.getName()}:${filePath}:${varDecl.getStartLineNumber()}`
        if (!seen.has(key)) {
          seen.add(key)
          symbols.push({
            name: varDecl.getName(),
            kind: "variable",
            file: filePath.replace(process.cwd() + "/", ""),
            line: varDecl.getStartLineNumber(),
            references: varDecl.findReferencesAsNodes().length,
          })
        }
      }
    }

    // Find classes
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName()
      if (name && pattern.test(name)) {
        const key = `class:${name}:${filePath}`
        if (!seen.has(key)) {
          seen.add(key)
          symbols.push({
            name,
            kind: "class",
            file: filePath.replace(process.cwd() + "/", ""),
            line: cls.getStartLineNumber(),
            references: cls.findReferencesAsNodes().length,
          })
        }
      }
    }
  }

  // Sort by reference count (most used first)
  return symbols.sort((a, b) => b.references - a.references)
}

function renameSymbol(
  project: Project,
  symbolInfo: SymbolInfo,
  newName: string
): RenameResult {
  const result: RenameResult = {
    symbol: symbolInfo.name,
    newName,
    references: 0,
    files: [],
    success: false,
  }

  try {
    const sourceFile = project.getSourceFile(symbolInfo.file)
    if (!sourceFile) {
      result.error = `File not found: ${symbolInfo.file}`
      return result
    }

    // Find the node at the specified line
    let targetNode: Node | undefined

    sourceFile.forEachDescendant((node) => {
      if (node.getStartLineNumber() === symbolInfo.line) {
        if (Node.isIdentifier(node) && node.getText() === symbolInfo.name) {
          targetNode = node
        }
        if (Node.isPropertySignature(node) && node.getName() === symbolInfo.name) {
          targetNode = node.getNameNode()
        }
        if (Node.isInterfaceDeclaration(node) && node.getName() === symbolInfo.name) {
          targetNode = node.getNameNode()
        }
        if (Node.isFunctionDeclaration(node) && node.getName() === symbolInfo.name) {
          targetNode = node.getNameNode()
        }
        if (Node.isVariableDeclaration(node) && node.getName() === symbolInfo.name) {
          targetNode = node.getNameNode()
        }
        if (Node.isClassDeclaration(node) && node.getName() === symbolInfo.name) {
          targetNode = node.getNameNode()
        }
        if (Node.isTypeAliasDeclaration(node) && node.getName() === symbolInfo.name) {
          targetNode = node.getNameNode()
        }
      }
    })

    if (!targetNode) {
      result.error = `Symbol not found at ${symbolInfo.file}:${symbolInfo.line}`
      return result
    }

    // Get references before rename
    const refs = targetNode.findReferencesAsNodes?.() || []
    result.references = refs.length

    // Perform rename
    if (Node.isRenameable(targetNode)) {
      targetNode.rename(newName)
      result.success = true

      // Get modified files
      const modifiedFiles = project.getSourceFiles().filter((sf) => !sf.isSaved())
      result.files = modifiedFiles.map((sf) =>
        sf.getFilePath().replace(process.cwd() + "/", "")
      )
    } else {
      result.error = "Node is not renameable"
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }

  return result
}

function computeNewName(oldName: string, pattern: RegExp, replacement: string): string {
  // Smart case-preserving replacement
  // vaultPath -> repoPath (camelCase)
  // VaultPath -> RepoPath (PascalCase)
  // VAULT_PATH -> REPO_PATH (SCREAMING_SNAKE)
  // vault-path -> repo-path (kebab-case)

  return oldName.replace(pattern, (match) => {
    // Preserve case of first character
    if (match[0] === match[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1)
    }
    return replacement
  })
}

async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  const findPattern = args.includes("--find")
    ? args[args.indexOf("--find") + 1]
    : null
  const pattern = args.includes("--pattern")
    ? args[args.indexOf("--pattern") + 1]
    : null
  const replacement = args.includes("--replace")
    ? args[args.indexOf("--replace") + 1]
    : null
  const mapFile = args.includes("--map")
    ? args[args.indexOf("--map") + 1]
    : null
  const dryRun = args.includes("--dry-run")
  const verbose = args.includes("--verbose") || args.includes("-v")

  if (!findPattern && !pattern && !mapFile) {
    console.error(`Usage:
  # Find symbols matching pattern
  ts-batch-rename.ts --find <pattern>

  # Rename with pattern/replace
  ts-batch-rename.ts --pattern <pattern> --replace <replacement> [--dry-run]

  # Rename with map file
  ts-batch-rename.ts --map <file.json> [--dry-run]

Options:
  --dry-run    Preview changes without saving
  --verbose    Show detailed output`)
    process.exit(1)
  }

  console.log("Loading TypeScript project...")
  const project = new Project({ tsConfigFilePath: "tsconfig.json" })
  console.log(`Loaded ${project.getSourceFiles().length} source files\n`)

  // Mode 1: Find symbols
  if (findPattern) {
    const regex = new RegExp(findPattern, "i")
    console.log(`Finding symbols matching /${findPattern}/i...\n`)

    const symbols = findSymbolsMatching(project, regex)

    console.log(`Found ${symbols.length} symbols:\n`)
    for (const sym of symbols) {
      console.log(`  ${sym.name} (${sym.kind})`)
      console.log(`    ${sym.file}:${sym.line}`)
      console.log(`    ${sym.references} references\n`)
    }
    return
  }

  // Mode 2: Pattern-based rename
  if (pattern && replacement) {
    const regex = new RegExp(pattern, "i")
    console.log(`Finding symbols matching /${pattern}/i...`)

    const symbols = findSymbolsMatching(project, regex)
    console.log(`Found ${symbols.length} symbols to rename\n`)

    let totalRefs = 0
    const allFiles = new Set<string>()
    const results: RenameResult[] = []

    for (const sym of symbols) {
      const newName = computeNewName(sym.name, regex, replacement)
      if (newName === sym.name) continue // Skip if no change

      if (verbose) {
        console.log(`Renaming ${sym.name} → ${newName}...`)
      }

      const result = renameSymbol(project, sym, newName)
      results.push(result)

      if (result.success) {
        totalRefs += result.references
        result.files.forEach((f) => allFiles.add(f))
      } else if (result.error) {
        console.error(`  Error: ${result.error}`)
      }
    }

    console.log(`\nSummary:`)
    console.log(`  Symbols renamed: ${results.filter((r) => r.success).length}`)
    console.log(`  Total references: ${totalRefs}`)
    console.log(`  Files modified: ${allFiles.size}`)

    if (dryRun) {
      console.log(`\n[DRY RUN - no changes saved]`)
    } else {
      project.saveSync()
      console.log(`\n✓ Changes saved!`)
    }
    return
  }

  // Mode 3: Map file rename
  if (mapFile) {
    if (!existsSync(mapFile)) {
      console.error(`Map file not found: ${mapFile}`)
      process.exit(1)
    }

    const renameMap: Record<string, string> = JSON.parse(
      readFileSync(mapFile, "utf-8")
    )
    console.log(`Loaded ${Object.keys(renameMap).length} renames from ${mapFile}\n`)

    let totalRefs = 0
    const allFiles = new Set<string>()

    for (const [oldName, newName] of Object.entries(renameMap)) {
      const regex = new RegExp(`^${oldName}$`)
      const symbols = findSymbolsMatching(project, regex)

      for (const sym of symbols) {
        if (verbose) {
          console.log(`Renaming ${sym.name} → ${newName}...`)
        }

        const result = renameSymbol(project, sym, newName)
        if (result.success) {
          totalRefs += result.references
          result.files.forEach((f) => allFiles.add(f))
        } else if (result.error) {
          console.error(`  Error renaming ${sym.name}: ${result.error}`)
        }
      }
    }

    console.log(`\nSummary:`)
    console.log(`  Total references updated: ${totalRefs}`)
    console.log(`  Files modified: ${allFiles.size}`)

    if (dryRun) {
      console.log(`\n[DRY RUN - no changes saved]`)
    } else {
      project.saveSync()
      console.log(`\n✓ Changes saved!`)
    }
  }
}

main().catch((err) => {
  console.error("Error:", err)
  process.exit(1)
})
