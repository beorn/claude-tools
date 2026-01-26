import { Project, Node, SourceFile } from "ts-morph"
import { createHash } from "crypto"
import type { SymbolInfo, SymbolMatch, Reference } from "./types"

let cachedProject: Project | null = null

export function getProject(tsConfigPath = "tsconfig.json"): Project {
  if (!cachedProject) {
    cachedProject = new Project({ tsConfigFilePath: tsConfigPath })
  }
  return cachedProject
}

export function resetProject(): void {
  cachedProject = null
}

/**
 * Get symbol info at a specific location
 */
export function getSymbolAt(
  project: Project,
  filePath: string,
  line: number,
  column: number
): SymbolInfo | null {
  const sourceFile = project.getSourceFile(filePath)
  if (!sourceFile) return null

  const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1)
  const node = findIdentifierAt(sourceFile, pos)
  if (!node) return null

  const name = node.getText()
  const kind = getSymbolKind(node)
  const startLine = node.getStartLineNumber()
  const startCol = node.getStart() - sourceFile.compilerNode.getPositionOfLineAndCharacter(startLine - 1, 0) + 1

  return {
    symbolKey: `${filePath}:${startLine}:${startCol}:${name}`,
    name,
    kind,
    file: filePath,
    line: startLine,
    column: startCol,
  }
}

/**
 * Find all references to a symbol
 */
export function getReferences(project: Project, symbolKey: string): Reference[] {
  const [filePath, lineStr, colStr, name] = symbolKey.split(":")
  const line = parseInt(lineStr, 10)
  const column = parseInt(colStr, 10)

  const sourceFile = project.getSourceFile(filePath)
  if (!sourceFile) return []

  const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1)
  const node = findIdentifierAt(sourceFile, pos)
  if (!node) return []

  const refs = node.findReferencesAsNodes?.() || []
  const references: Reference[] = []

  for (const ref of refs) {
    const refFile = ref.getSourceFile()
    const refFilePath = refFile.getFilePath().replace(process.cwd() + "/", "")
    const startLine = ref.getStartLineNumber()
    const endLine = ref.getEndLineNumber()
    const lineStart = refFile.compilerNode.getPositionOfLineAndCharacter(startLine - 1, 0)
    const startCol = ref.getStart() - lineStart + 1
    const endCol = ref.getEnd() - refFile.compilerNode.getPositionOfLineAndCharacter(endLine - 1, 0) + 1

    // Get preview (the line containing the reference)
    const lines = refFile.getFullText().split("\n")
    const preview = lines[startLine - 1]?.trim() || ""

    // Compute file checksum
    const checksum = computeChecksum(refFile.getFullText())

    // Stable refId
    const refId = computeRefId(refFilePath, startLine, startCol, endLine, endCol)

    references.push({
      refId,
      file: refFilePath,
      range: [startLine, startCol, endLine, endCol],
      preview,
      checksum,
      selected: true,
    })
  }

  return references
}

/**
 * Find all symbols matching a pattern
 */
export function findSymbols(project: Project, pattern: RegExp): SymbolMatch[] {
  const matches: SymbolMatch[] = []
  const seen = new Set<string>()

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath().replace(process.cwd() + "/", "")
    if (filePath.includes("node_modules")) continue

    // Interfaces
    for (const intf of sourceFile.getInterfaces()) {
      const name = intf.getName()
      if (pattern.test(name)) {
        addMatch(intf.getNameNode(), "interface")
      }
      // Properties within interfaces
      for (const prop of intf.getProperties()) {
        const propName = prop.getName()
        if (pattern.test(propName)) {
          addMatch(prop.getNameNode(), "property")
        }
      }
    }

    // Type aliases
    for (const typeAlias of sourceFile.getTypeAliases()) {
      if (pattern.test(typeAlias.getName())) {
        addMatch(typeAlias.getNameNode(), "type")
      }
    }

    // Functions
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName()
      if (name && pattern.test(name)) {
        addMatch(func.getNameNode()!, "function")
      }
    }

    // Variables
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      if (pattern.test(varDecl.getName())) {
        addMatch(varDecl.getNameNode(), "variable")
      }
    }

    // Classes
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName()
      if (name && pattern.test(name)) {
        addMatch(cls.getNameNode()!, "class")
      }
    }
  }

  // Sort by reference count (most used first)
  return matches.sort((a, b) => b.refCount - a.refCount)

  function addMatch(node: Node, kind: string) {
    const name = node.getText()
    const startLine = node.getStartLineNumber()
    const sf = node.getSourceFile()
    const fp = sf.getFilePath().replace(process.cwd() + "/", "")
    const lineStart = sf.compilerNode.getPositionOfLineAndCharacter(startLine - 1, 0)
    const startCol = node.getStart() - lineStart + 1

    const key = `${fp}:${startLine}:${startCol}:${name}`
    if (seen.has(key)) return
    seen.add(key)

    const refCount = node.findReferencesAsNodes?.()?.length || 0
    matches.push({
      symbolKey: key,
      name,
      kind,
      file: fp,
      line: startLine,
      refCount,
    })
  }
}

/**
 * Rename a symbol and return the edits (without saving)
 */
export function renameSymbol(
  project: Project,
  symbolKey: string,
  newName: string
): { edits: Array<{ file: string; offset: number; length: number; replacement: string }> } {
  const [filePath, lineStr, colStr] = symbolKey.split(":")
  const line = parseInt(lineStr, 10)
  const column = parseInt(colStr, 10)

  const sourceFile = project.getSourceFile(filePath)
  if (!sourceFile) throw new Error(`File not found: ${filePath}`)

  const pos = sourceFile.compilerNode.getPositionOfLineAndCharacter(line - 1, column - 1)
  const node = findIdentifierAt(sourceFile, pos)
  if (!node) throw new Error(`Symbol not found at ${filePath}:${line}:${column}`)

  // Perform rename
  if (!Node.isRenameable(node)) {
    throw new Error("Node is not renameable")
  }
  node.rename(newName)

  // Collect edits from modified files
  const edits: Array<{ file: string; offset: number; length: number; replacement: string }> = []

  // Note: ts-morph doesn't expose individual edits easily.
  // For now, we track which files were modified.
  // In a full implementation, we'd use the LanguageService's findRenameLocations.

  return { edits }
}

// Helper functions

function findIdentifierAt(sourceFile: SourceFile, pos: number): Node | null {
  let result: Node | null = null

  sourceFile.forEachDescendant((node) => {
    if (node.getStart() <= pos && pos < node.getEnd()) {
      if (Node.isIdentifier(node)) {
        result = node
      }
    }
  })

  return result
}

function getSymbolKind(
  node: Node
): "variable" | "function" | "type" | "interface" | "property" | "class" | "method" | "parameter" {
  const parent = node.getParent()
  if (!parent) return "variable"

  if (Node.isInterfaceDeclaration(parent)) return "interface"
  if (Node.isTypeAliasDeclaration(parent)) return "type"
  if (Node.isFunctionDeclaration(parent)) return "function"
  if (Node.isClassDeclaration(parent)) return "class"
  if (Node.isMethodDeclaration(parent)) return "method"
  if (Node.isPropertySignature(parent)) return "property"
  if (Node.isPropertyDeclaration(parent)) return "property"
  if (Node.isParameter(parent)) return "parameter"
  if (Node.isVariableDeclaration(parent)) return "variable"

  return "variable"
}

export function computeChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12)
}

export function computeRefId(
  file: string,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number
): string {
  const input = `${file}:${startLine}:${startCol}:${endLine}:${endCol}`
  return createHash("sha256").update(input).digest("hex").slice(0, 8)
}

/**
 * Case-preserving replacement for terminology migrations
 */
export function computeNewName(oldName: string, pattern: RegExp, replacement: string): string {
  return oldName.replace(pattern, (match) => {
    // SCREAMING_CASE: entire match is uppercase
    if (match === match.toUpperCase() && match.length > 1) {
      return replacement.toUpperCase()
    }
    // PascalCase: first char is uppercase
    if (match[0] === match[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1)
    }
    // camelCase/lowercase
    return replacement.toLowerCase()
  })
}
