/**
 * TtydServer factory - manages ttyd process lifecycle
 *
 * Features:
 * - Port retry on EADDRINUSE (avoids TOCTOU race with orphaned ttyd processes)
 * - Ready detection (monitors stderr for "Listening on port")
 * - Graceful shutdown (SIGTERM → wait → SIGKILL)
 * - AsyncDisposable support (works with `await using`)
 */

import { spawn, type ChildProcess } from "child_process"

export interface TtydServerOptions {
  command: string[]
  env?: Record<string, string>
  portRange?: [number, number]
  cwd?: string
}

export interface TtydServer {
  url: string
  port: number
  ready: Promise<void>
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

const DEFAULT_PORT_RANGE: [number, number] = [7700, 7999]
const MAX_PORT_RETRIES = 10

export function createTTY(options: TtydServerOptions): TtydServer {
  const { command, env = {}, portRange = DEFAULT_PORT_RANGE, cwd } = options

  let process: ChildProcess | null = null
  let port = 0
  let url = ""

  const ready = (async () => {
    const [cmd, ...args] = command
    if (!cmd) throw new Error("Empty command array")

    // Try ports sequentially — spawn ttyd directly, retry on EADDRINUSE
    let lastError: Error | null = null
    const startPort = portRange[0]
    const endPort = Math.min(startPort + MAX_PORT_RETRIES - 1, portRange[1])

    for (let tryPort = startPort; tryPort <= endPort; tryPort++) {
      try {
        const result = await trySpawnTtyd(tryPort, cmd, args, env, cwd)
        process = result.process
        port = tryPort
        url = `http://127.0.0.1:${port}`
        return
      } catch (err) {
        lastError = err as Error
        if ((err as Error).message.includes("EADDRINUSE")) {
          continue // Try next port
        }
        throw err // Non-port error, don't retry
      }
    }

    throw (
      lastError ?? new Error(`No free port in range ${startPort}-${endPort}`)
    )
  })()

  async function close(): Promise<void> {
    if (!process) return

    const p = process
    process = null

    // Try graceful shutdown first
    p.kill("SIGTERM")

    // Wait up to 2 seconds for process to exit
    const exited = await Promise.race([
      new Promise<boolean>((resolve) => {
        p.once("exit", () => resolve(true))
      }),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 2000)
      }),
    ])

    // Force kill if still running
    if (!exited) {
      p.kill("SIGKILL")
      await new Promise<void>((resolve) => {
        p.once("exit", () => resolve())
      })
    }
  }

  return {
    get url() {
      return url
    },
    get port() {
      return port
    },
    ready,
    close,
    [Symbol.asyncDispose]: close,
  }
}

/** Spawn ttyd on a specific port. Rejects with EADDRINUSE message if port is taken. */
function trySpawnTtyd(
  port: number,
  cmd: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): Promise<{ process: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ttyd", ["-W", "-p", String(port), cmd, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...globalThis.process.env, FORCE_COLOR: "1", ...env },
      cwd,
    })

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL")
      reject(new Error("ttyd startup timeout (10s)"))
    }, 10000)

    const outputChunks: string[] = []

    const onData = (data: Buffer) => {
      const text = data.toString()
      outputChunks.push(text)

      // Detect EADDRINUSE early — ttyd logs this before exiting
      if (text.includes("EADDRINUSE")) {
        cleanup()
        clearTimeout(timeout)
        proc.kill("SIGKILL")
        reject(new Error(`EADDRINUSE: port ${port} already in use`))
        return
      }

      if (text.includes("Listening on") || text.includes(`port: ${port}`)) {
        cleanup()
        clearTimeout(timeout)
        // Brief delay for WebSocket to be ready
        setTimeout(() => resolve({ process: proc }), 100)
      }
    }

    const onError = (err: Error) => {
      cleanup()
      clearTimeout(timeout)
      reject(new Error(`ttyd failed to start: ${err.message}`))
    }

    const onExit = (code: number | null) => {
      cleanup()
      clearTimeout(timeout)
      const output = outputChunks.join("").trim()
      if (output.includes("EADDRINUSE")) {
        reject(new Error(`EADDRINUSE: port ${port} already in use`))
      } else {
        const details = output ? `\nOutput: ${output.slice(0, 500)}` : ""
        reject(new Error(`ttyd exited with code ${code}${details}`))
      }
    }

    proc.stdout?.on("data", onData)
    proc.stderr?.on("data", onData)
    proc.once("error", onError)
    proc.once("exit", onExit)

    function cleanup() {
      proc.stdout?.off("data", onData)
      proc.stderr?.off("data", onData)
      proc.off("error", onError)
      proc.off("exit", onExit)
    }
  })
}
