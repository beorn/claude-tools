import { Project, Node, SourceFile } from "ts-morph"
import type { SymbolInfo, SymbolMatch, Reference } from "../../core/types"
import { computeChecksum, computeRefId } from "../../core/apply"

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
 * Find ALL symbols in the codebase (for conflict detection)
 */
export function findAllSymbols(project: Project): SymbolMatch[] {
  return findSymbols(project, /.*/) // Match everything
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

    // Variables and parameters (including destructuring patterns)
    sourceFile.forEachDescendant((node) => {
      // Variable declarations: const foo = ... or const { foo } = ...
      if (Node.isVariableDeclaration(node)) {
        const nameNode = node.getNameNode()
        if (Node.isIdentifier(nameNode)) {
          const name = nameNode.getText()
          if (pattern.test(name)) {
            addMatch(nameNode, "variable")
          }
        } else if (Node.isObjectBindingPattern(nameNode) || Node.isArrayBindingPattern(nameNode)) {
          addBindingPatternMatches(nameNode)
        }
      }
      // Function/arrow parameters: (foo) => ... or ({ foo }) => ...
      else if (Node.isParameterDeclaration(node)) {
        const nameNode = node.getNameNode()
        if (Node.isIdentifier(nameNode)) {
          const name = nameNode.getText()
          if (pattern.test(name)) {
            addMatch(nameNode, "parameter")
          }
        } else if (Node.isObjectBindingPattern(nameNode) || Node.isArrayBindingPattern(nameNode)) {
          addBindingPatternMatches(nameNode)
        }
      }
    })

    // Helper to extract identifiers from destructuring patterns
    function addBindingPatternMatches(bindingPattern: Node) {
      bindingPattern.forEachDescendant((bindingNode) => {
        if (Node.isBindingElement(bindingNode)) {
          const bindingName = bindingNode.getNameNode()
          if (Node.isIdentifier(bindingName)) {
            const name = bindingName.getText()
            if (pattern.test(name)) {
              addMatch(bindingName, "variable")
            }
          }
        }
      })
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
