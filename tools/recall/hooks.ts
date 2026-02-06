/**
 * Hook handlers for UserPromptSubmit and SessionEnd.
 * Called by Claude Code hooks, not directly by users.
 */

import * as path from "path"
import { hookRecall, remember } from "../lib/history/recall"

// ============================================================================
// Stdin reader
// ============================================================================

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

// ============================================================================
// Hook command — UserPromptSubmit
// ============================================================================

export async function cmdHook(): Promise<void> {
  const startTime = Date.now()
  try {
    const stdin = await readStdin()
    let input: { prompt?: string }
    try {
      input = JSON.parse(stdin) as { prompt?: string }
    } catch (e) {
      console.error(
        `[recall hook] FATAL: invalid JSON on stdin (${Date.now() - startTime}ms): ${String(e)}\nstdin was: ${stdin.slice(0, 200)}`,
      )
      process.exit(1)
      return
    }
    const prompt = input.prompt
    if (!prompt) {
      console.error(
        `[recall hook] no prompt in stdin (${Date.now() - startTime}ms)`,
      )
      process.exit(0)
    }
    const result = await hookRecall(prompt)
    const elapsed = Date.now() - startTime
    if (result.skipped) {
      console.error(
        `[recall hook] skipped: ${result.reason} (${elapsed}ms) prompt="${prompt.slice(0, 60)}"`,
      )
      process.exit(0)
    }
    const synthLen =
      result.hookOutput?.hookSpecificOutput.additionalContext.length ?? 0
    console.error(
      `[recall hook] OK: ${synthLen} chars synthesis (${elapsed}ms) prompt="${prompt.slice(0, 60)}"`,
    )
    console.log(JSON.stringify(result.hookOutput))
  } catch (e) {
    const elapsed = Date.now() - startTime
    console.error(
      `[recall hook] FATAL: unhandled error (${elapsed}ms): ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`,
    )
    process.exit(1)
  }
}

// ============================================================================
// Remember command — SessionEnd
// ============================================================================

export async function cmdRemember(opts: { json?: boolean }): Promise<void> {
  const startTime = Date.now()
  try {
    const stdin = await readStdin()
    let input: { transcript_path?: string; session_id?: string }
    try {
      input = JSON.parse(stdin) as {
        transcript_path?: string
        session_id?: string
      }
    } catch (e) {
      console.error(
        `[recall remember] FATAL: invalid JSON on stdin (${Date.now() - startTime}ms): ${String(e)}\nstdin was: ${stdin.slice(0, 200)}`,
      )
      process.exit(1)
      return
    }

    const transcriptPath = input.transcript_path
    const sessionId = input.session_id

    if (!transcriptPath || !sessionId) {
      console.error(
        `[recall remember] missing transcript_path or session_id in stdin (keys: ${Object.keys(input).join(", ")})`,
      )
      process.exit(0)
    }

    const projectDir =
      process.env.CLAUDE_PROJECT_DIR || path.dirname(transcriptPath)
    const memoryDir = path.join(projectDir, "memory", "sessions")

    const result = await remember({
      transcriptPath,
      sessionId,
      memoryDir,
    })
    const elapsed = Date.now() - startTime

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (result.skipped) {
      console.error(
        `[recall remember] skipped: ${result.reason} (${elapsed}ms) session=${sessionId.slice(0, 8)}`,
      )
    } else {
      console.error(
        `[recall remember] saved ${result.lessonsCount ?? 0} lessons to ${result.memoryFile} (${elapsed}ms)`,
      )
    }
  } catch (e) {
    const elapsed = Date.now() - startTime
    console.error(
      `[recall remember] FATAL: unhandled error (${elapsed}ms): ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`,
    )
    process.exit(1)
  }
}
