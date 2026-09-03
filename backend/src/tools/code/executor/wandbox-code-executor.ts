const WANDBOX_API = "https://wandbox.org/api/compile.json";

const MAX_OUTPUT_CHARS = 50_000;

const COMPILER_MAPPING: Record<string, string> = {
  python: "cpython-3.13.8",
  javascript: "nodejs-head",
  typescript: "typescript-head",
  java: "openjdk-head",
  cpp: "gcc-head",
  c: "gcc-head-c",
  rust: "rust-head",
  go: "go-head",
  ruby: "ruby-head",
  php: "php-head",
  bash: "bash",
};

const HTML_LANGUAGES = new Set(["html", "htm", "web", "website", "page"]);

interface WandboxResponse {
  status: string;
  program_output?: string;
  program_error?: string;
  program_message?: string;
  compiler_output?: string;
  compiler_error?: string;
  compiler_message?: string;
  signal?: string;
}

export async function executeCode(
  code: string,
  language: string,
  stdin: string = "",
  ownerId?: string,
): Promise<{ status: string; output?: string; error?: string; language: string; artifact_id?: string; artifact_type?: string; title?: string }> {
  const normalizedLanguage = language.toLowerCase();

  if (HTML_LANGUAGES.has(normalizedLanguage)) {
    const { createArtifact } = await import("../../files/create-artifact/artifact-store.js");
    if (!ownerId) {
      return { status: "error", error: "Cannot create an HTML preview without a registered user.", language };
    }
    const artifact = await createArtifact({ ownerId, type: "html", title: "HTML Preview", content: code, language: "html", author: "assistant" });
    return { status: "success", output: "Interactive HTML preview created.", language: "html", artifact_id: artifact.id, artifact_type: artifact.type, title: artifact.title };
  }

  const compiler = COMPILER_MAPPING[normalizedLanguage];
  if (!compiler) {
    return { status: "error", error: `Language '${language}' is not supported.`, language };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(WANDBOX_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compiler, code, stdin }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return { status: "error", error: `Failed to connect to the execution service (Wandbox: ${res.status})`, language };
    }

    const data = (await res.json()) as WandboxResponse;

    if (data.compiler_error || (data.status && data.status !== "0" && !data.program_output && data.compiler_message)) {
      const errMsg = (data.compiler_error || data.compiler_message || "Compile / build error");
      const truncatedErr = errMsg.length > MAX_OUTPUT_CHARS
        ? errMsg.substring(0, MAX_OUTPUT_CHARS) + '... (truncated)'
        : errMsg;
      return { status: "compile_error", error: truncatedErr, language };
    }

    if (data.status && data.status !== "0") {
      const errMsg = (data.program_error || data.program_message || `Execution failed with status code: ${data.status}`);
      const truncatedErr = errMsg.length > MAX_OUTPUT_CHARS
        ? errMsg.substring(0, MAX_OUTPUT_CHARS) + '... (truncated)'
        : errMsg;
      return { status: "runtime_error", error: truncatedErr, language };
    }

    const output = (data.program_output || data.program_message || "(no output)");
    const truncated = output.length > MAX_OUTPUT_CHARS
      ? output.substring(0, MAX_OUTPUT_CHARS) + `\n\n... (output truncated — original ${output.length.toLocaleString()} characters)`
      : output;
    return { status: "success", output: truncated, language };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { status: "timeout", error: "Execution timed out (12 seconds)", language };
    }
    // Never leak internal error messages to the client
    return { status: "error", error: "Code execution failed. Please try again.", language };
  }
}
