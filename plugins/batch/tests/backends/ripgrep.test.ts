import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { execSync } from "child_process"

// Import to trigger registration
import { RipgrepBackend, findPatterns, createPatternReplaceProposal } from "../../tools/lib/backends/ripgrep"
import { getBackendByName, getBackends } from "../../tools/lib/backend"

describe("ripgrep backend", () => {
  describe("registration", () => {
    test("registers with correct name", () => {
      const backend = getBackendByName("ripgrep")
      expect(backend).not.toBeNull()
      expect(backend?.name).toBe("ripgrep")
    })

    test("registers with wildcard extension", () => {
      expect(RipgrepBackend.extensions).toContain("*")
    })

    test("has lowest priority (fallback)", () => {
      const backends = getBackends()
      const ripgrep = backends.find((b) => b.name === "ripgrep")
      const others = backends.filter((b) => b.name !== "ripgrep")

      expect(ripgrep).toBeDefined()
      for (const other of others) {
        expect(ripgrep!.priority).toBeLessThan(other.priority)
      }
    })

    test("implements findPatterns", () => {
      expect(typeof RipgrepBackend.findPatterns).toBe("function")
    })

    test("implements createPatternReplaceProposal", () => {
      expect(typeof RipgrepBackend.createPatternReplaceProposal).toBe("function")
    })
  })

  describe("findPatterns", () => {
    let tempDir: string

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), "ripgrep-test-"))
      // Create test files
      writeFileSync(join(tempDir, "test.md"), "# Hello World\n\nThis is a widget example.\n")
      writeFileSync(join(tempDir, "test2.txt"), "Another widget here.\n")
    })

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    test("finds text patterns in files", () => {
      try {
        // Check if rg is available
        execSync("which rg", { stdio: "pipe" })
      } catch {
        // Skip test if rg not installed
        console.log("Skipping test: ripgrep (rg) not installed")
        return
      }

      const cwd = process.cwd()
      try {
        process.chdir(tempDir)
        const refs = findPatterns("widget")
        expect(refs.length).toBeGreaterThanOrEqual(2)
        expect(refs.some((r) => r.file.includes("test.md"))).toBe(true)
        expect(refs.some((r) => r.file.includes("test2.txt"))).toBe(true)
      } finally {
        process.chdir(cwd)
      }
    })

    test("respects glob filter", () => {
      try {
        execSync("which rg", { stdio: "pipe" })
      } catch {
        console.log("Skipping test: ripgrep (rg) not installed")
        return
      }

      const cwd = process.cwd()
      try {
        process.chdir(tempDir)
        const refs = findPatterns("widget", "*.md")
        expect(refs.every((r) => r.file.endsWith(".md"))).toBe(true)
      } finally {
        process.chdir(cwd)
      }
    })
  })

  describe("createPatternReplaceProposal", () => {
    let tempDir: string

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), "ripgrep-replace-test-"))
      writeFileSync(join(tempDir, "doc.md"), "The widget is great.\nWidgets are useful.\n")
    })

    afterAll(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    test("creates editset with correct structure", () => {
      try {
        execSync("which rg", { stdio: "pipe" })
      } catch {
        console.log("Skipping test: ripgrep (rg) not installed")
        return
      }

      const cwd = process.cwd()
      try {
        process.chdir(tempDir)
        const editset = createPatternReplaceProposal("widget", "gadget")

        expect(editset.operation).toBe("rename")
        expect(editset.from).toBe("widget")
        expect(editset.to).toBe("gadget")
        expect(Array.isArray(editset.refs)).toBe(true)
        expect(Array.isArray(editset.edits)).toBe(true)
        expect(editset.createdAt).toBeDefined()

        // Should find at least one match
        expect(editset.refs.length).toBeGreaterThanOrEqual(1)
      } finally {
        process.chdir(cwd)
      }
    })

    test("generates correct edits for replacement", () => {
      try {
        execSync("which rg", { stdio: "pipe" })
      } catch {
        console.log("Skipping test: ripgrep (rg) not installed")
        return
      }

      const cwd = process.cwd()
      try {
        process.chdir(tempDir)
        const editset = createPatternReplaceProposal("widget", "gadget")

        for (const edit of editset.edits) {
          expect(edit.file).toBeDefined()
          expect(typeof edit.offset).toBe("number")
          expect(typeof edit.length).toBe("number")
          expect(edit.replacement).toBe("gadget")
        }
      } finally {
        process.chdir(cwd)
      }
    })
  })
})
