/**
 * Playwright TTY MCP Backend - manages sessions and implements tool handlers
 *
 * Robustness features:
 * - Per-tool timeouts prevent hanging on stale sessions
 * - Browser auto-recovery on disconnect
 * - Dead session auto-cleanup
 */

import type { Browser } from "playwright"
import { chromium } from "playwright"
import { createSession, type TtySession } from "./session.js"
import {
  waitForContent,
  waitForText,
  waitForStable,
  getTerminalText,
} from "./wait-helpers.js"
import {
  TtyStartInputSchema,
  TtyResetInputSchema,
  TtyStopInputSchema,
  TtyPressInputSchema,
  TtyTypeInputSchema,
  TtyScreenshotInputSchema,
  TtyTextInputSchema,
  TtyWaitInputSchema,
  TtyListInputSchema,
  type TtyStartOutput,
  type TtyResetOutput,
  type TtyListOutput,
  type TtyStopOutput,
  type TtyPressOutput,
  type TtyTypeOutput,
  type TtyScreenshotOutput,
  type TtyTextOutput,
  type TtyWaitOutput,
} from "./types.js"
import { writeFile } from "fs/promises"

// Per-tool timeout in ms. Prevents any tool from hanging forever.
// tty_start, tty_reset, tty_wait derive timeout from their args (see callTool).
const TOOL_TIMEOUTS: Record<string, number> = {
  tty_list: 2_000,
  tty_stop: 10_000,
  tty_press: 5_000,
  tty_type: 5_000,
  tty_screenshot: 10_000,
  tty_text: 5_000,
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      )
    }),
  ]).finally(() => clearTimeout(timer!))
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

type ToolOutput =
  | TtyStartOutput
  | TtyResetOutput
  | TtyListOutput
  | TtyStopOutput
  | TtyPressOutput
  | TtyTypeOutput
  | TtyScreenshotOutput
  | TtyTextOutput
  | TtyWaitOutput

export class PlaywrightTtyBackend {
  private sessions = new Map<string, TtySession>()
  private browser: Browser | null = null

  async ensureBrowser(): Promise<Browser> {
    // Auto-recover if browser disconnected
    if (this.browser && !this.browser.isConnected()) {
      this.browser = null
    }
    if (!this.browser) {
      const launching = chromium.launch({ headless: true })
      try {
        this.browser = await withTimeout(launching, 15_000, "chromium.launch")
      } catch (err) {
        // If launch eventually succeeds after timeout, close it to avoid leaks
        launching.then((b) => b.close()).catch(() => {})
        throw err
      }
    }
    return this.browser
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close()
      } catch {
        // Browser may already be disconnected
      }
      this.browser = null
    }
  }

  getSession(sessionId: string): TtySession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      const active = Array.from(this.sessions.keys()).join(", ") || "none"
      throw new Error(
        `Session not found: ${sessionId}. Active sessions: ${active}`,
      )
    }
    // Auto-remove dead sessions
    if (!session.alive) {
      session.close().catch(() => {})
      this.sessions.delete(sessionId)
      throw new Error(
        `Session ${sessionId} is dead (page closed or process exited). It has been removed.`,
      )
    }
    return session
  }

  /** Remove sessions whose page or process has died */
  private cleanupStaleSessions(): void {
    for (const [id, session] of this.sessions) {
      if (!session.alive) {
        session.close().catch(() => {})
        this.sessions.delete(id)
      }
    }
  }

  async callTool(name: string, args: unknown): Promise<ToolOutput> {
    // Determine timeout for this tool
    let timeoutMs = TOOL_TIMEOUTS[name] ?? 10_000

    // Tools with user-specified timeouts: derive outer timeout from args
    if (name === "tty_start") {
      try {
        const parsed = TtyStartInputSchema.parse(args)
        timeoutMs = parsed.timeout + 10_000 // user timeout + overhead for browser/ttyd/nav
      } catch {
        timeoutMs = 15_000
      }
    } else if (name === "tty_reset") {
      timeoutMs = 15_000
    } else if (name === "tty_wait") {
      try {
        const parsed = TtyWaitInputSchema.parse(args)
        timeoutMs = parsed.timeout + 5_000
      } catch {
        timeoutMs = 35_000
      }
    }

    try {
      return await withTimeout(this.handleTool(name, args), timeoutMs, name)
    } catch (err) {
      // On timeout, clean up stale sessions so future calls don't hit dead sessions
      if (err instanceof Error && err.message.includes("timed out")) {
        this.cleanupStaleSessions()
      }
      throw err
    }
  }

  private async handleTool(name: string, args: unknown): Promise<ToolOutput> {
    switch (name) {
      case "tty_start": {
        const input = TtyStartInputSchema.parse(args)
        const id = generateId()

        // Try to create session, with retry on browser failure
        let lastError: Error | null = null
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const browser = await this.ensureBrowser()
            const session = await createSession(id, browser, {
              command: input.command,
              env: input.env as Record<string, string> | undefined,
              viewport: input.viewport,
              waitFor: input.waitFor,
              timeout: input.timeout,
            })
            this.sessions.set(id, session)
            return { sessionId: id, url: session.url }
          } catch (err) {
            lastError = err as Error
            // On first failure, try recreating the browser
            if (attempt === 0) {
              await this.closeBrowser()
            }
          }
        }
        throw lastError
      }

      case "tty_reset": {
        const input = TtyResetInputSchema.parse(args)
        const session = this.getSession(input.sessionId)
        const url = await session.reset({
          command: input.command,
          env: input.env as Record<string, string> | undefined,
        })
        return { url }
      }

      case "tty_list": {
        TtyListInputSchema.parse(args)
        // Clean up dead sessions first
        this.cleanupStaleSessions()
        const sessions = Array.from(this.sessions.values()).map((s) => ({
          id: s.id,
          url: s.url,
          command: s.command,
          createdAt: s.createdAt.toISOString(),
        }))
        return { sessions }
      }

      case "tty_stop": {
        const input = TtyStopInputSchema.parse(args)
        const session = this.getSession(input.sessionId)
        await session.close()
        this.sessions.delete(input.sessionId)

        // Close browser if no more sessions
        if (this.sessions.size === 0) {
          await this.closeBrowser()
        }

        return { success: true }
      }

      case "tty_press": {
        const input = TtyPressInputSchema.parse(args)
        const session = this.getSession(input.sessionId)
        await session.page.keyboard.press(input.key)
        return { success: true }
      }

      case "tty_type": {
        const input = TtyTypeInputSchema.parse(args)
        const session = this.getSession(input.sessionId)
        await session.page.keyboard.type(input.text)
        return { success: true }
      }

      case "tty_screenshot": {
        const input = TtyScreenshotInputSchema.parse(args)
        const session = this.getSession(input.sessionId)
        const buffer = await session.page.screenshot()

        if (input.outputPath) {
          await writeFile(input.outputPath, buffer)
          return { path: input.outputPath, mimeType: "image/png" }
        }

        return {
          data: buffer.toString("base64"),
          mimeType: "image/png",
        }
      }

      case "tty_text": {
        const input = TtyTextInputSchema.parse(args)
        const session = this.getSession(input.sessionId)
        const content = await getTerminalText(session.page)
        return { content }
      }

      case "tty_wait": {
        const input = TtyWaitInputSchema.parse(args)
        const session = this.getSession(input.sessionId)

        try {
          if (input.for) {
            await waitForText(session.page, input.for, {
              timeout: input.timeout,
            })
          } else if (input.stable) {
            await waitForStable(session.page, input.stable, {
              timeout: input.timeout,
            })
          } else {
            await waitForContent(session.page, { timeout: input.timeout })
          }
          return { success: true }
        } catch (err) {
          if (err instanceof Error && err.message.includes("Timeout")) {
            return { success: false, timedOut: true }
          }
          throw err
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  async shutdown(): Promise<void> {
    // Close all sessions
    for (const session of this.sessions.values()) {
      try {
        await session.close()
      } catch {
        // Best-effort cleanup
      }
    }
    this.sessions.clear()

    // Close browser
    await this.closeBrowser()
  }
}
