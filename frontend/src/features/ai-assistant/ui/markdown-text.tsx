
import "@assistant-ui/react-markdown/styles/dot.css";

import {
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import React, { type FC, memo, useRef, useState, useEffect } from "react";
import { Highlight } from "@/components/ui/perspective-highlight";
import { CopyIcon, PlayIcon, RefreshCwIcon, DownloadIcon, ShareIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { CursorBlinker } from "./CursorBlinker";
import { useBotStatus } from "./useBotStatus";
import { useAuiState } from "@assistant-ui/react";
import { NotebookPaper } from "./NotebookPaper";

// @ts-expect-error - react-syntax-highlighter module interop
import { Prism } from "react-syntax-highlighter";
// @ts-expect-error - react-syntax-highlighter CJS style interop
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { toast } from "sonner";
import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactActions,
  ArtifactAction,
  ArtifactContent,
} from "@/components/ui/artifact";

const MarkdownTextImpl = () => {
  const { isStreaming } = useBotStatus();
  const role = useAuiState((s) => s.message.role);

  return (
    <span className="aui-md-wrapper relative">
      <MarkdownTextPrimitive
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        className="aui-md"
        components={defaultComponents}
      />
      {isStreaming && role === "assistant" && <CursorBlinker />}
    </span>
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeBlockScrollFade: FC<{ children: React.ReactNode }> = ({ children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const check = () => setCanScrollRight(el.scrollWidth > el.clientWidth + 1);
    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative overflow-x-auto">
      {children}
      {canScrollRight && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 right-0 h-full w-12"
          style={{
            background: "linear-gradient(to left, #1e1e1e 0%, transparent 100%)",
          }}
        />
      )}
    </div>
  );
};





const CustomSyntaxHighlighter: FC<{ language: string; code: string }> = memo(({ language, code }) => {
  if (language === "solution") {
    return <NotebookPaper content={code} />;
  }

  const getExtension = (lang: string) => {
    const map: Record<string, string> = {
      javascript: "js",
      js: "js",
      typescript: "ts",
      ts: "ts",
      tsx: "tsx",
      jsx: "jsx",
      python: "py",
      py: "py",
      html: "html",
      css: "css",
      json: "json",
      markdown: "md",
      md: "md",
      cpp: "cpp",
      c: "c",
      go: "go",
      rust: "rs",
      sql: "sql",
      shell: "sh",
      bash: "sh",
    };
    return map[lang.toLowerCase()] || lang || "txt";
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      toast.success("Copied code to clipboard");
    });
  };

  const handleDownload = () => {
    const extension = getExtension(language);
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `code.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded code.${extension}`);
  };

  const handleRun = () => {
    toast.info(`Running ${language} code...`);
    setTimeout(() => {
      toast.success("Code execution simulated successfully!");
    }, 1000);
  };

  const handleRegenerate = () => {
    toast.success("Regeneration requested");
  };

  const handleShare = () => {
    navigator.clipboard.writeText(code).then(() => {
      toast.success("Shared: Code snippet link copied to clipboard");
    });
  };

  return (
    <Artifact className="my-4 border-zinc-800 bg-[#1e1e1e] text-white shadow-md" dir="ltr" style={{ direction: "ltr", textAlign: "left" }}>
      <ArtifactHeader className="border-zinc-800 bg-zinc-900/80 px-4 py-2" dir="ltr" style={{ direction: "ltr" }}>
        <div className="flex flex-col gap-0.5" style={{ direction: "ltr", textAlign: "left" }}>
          <ArtifactTitle className="text-xs font-semibold capitalize text-zinc-200" style={{ direction: "ltr", textAlign: "left" }}>
            {language}
          </ArtifactTitle>
          <ArtifactDescription className="text-[10px] text-zinc-400" style={{ direction: "ltr", textAlign: "left" }}>
            Code Snippet
          </ArtifactDescription>
        </div>
        <ArtifactActions className="flex items-center gap-1" style={{ direction: "ltr" }}>
          <ArtifactAction
            icon={PlayIcon}
            tooltip="Run code"
            onClick={handleRun}
            className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          />
          <ArtifactAction
            icon={CopyIcon}
            tooltip="Copy to clipboard"
            onClick={handleCopy}
            className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          />
          <ArtifactAction
            icon={RefreshCwIcon}
            tooltip="Regenerate"
            onClick={handleRegenerate}
            className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          />
          <ArtifactAction
            icon={DownloadIcon}
            tooltip="Download"
            onClick={handleDownload}
            className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          />
          <ArtifactAction
            icon={ShareIcon}
            tooltip="Share"
            onClick={handleShare}
            className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          />
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent className="p-0 overflow-hidden bg-[#1e1e1e]" dir="ltr" style={{ direction: "ltr", textAlign: "left" }}>
        <CodeBlockScrollFade>
          <Prism
            language={language}
            style={vscDarkPlus}
            showLineNumbers={true}
            wrapLines={true}
            lineNumberStyle={{
              color: "#858585",
              minWidth: "2.25rem",
              textAlign: "right",
              paddingRight: "1rem",
              userSelect: "none",
            }}
            customStyle={{
              margin: 0,
              width: "100%",
              background: "transparent",
              padding: "1rem",
              fontSize: "0.85rem",
              lineHeight: "1.5",
              fontFamily: "var(--font-mono, monospace)",
              direction: "ltr",
              textAlign: "left",
            }}
          >
            {code}
          </Prism>
        </CodeBlockScrollFade>
      </ArtifactContent>
    </Artifact>
  );
});

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mb-3 scroll-m-20 font-semibold text-xl first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-4 mb-2 scroll-m-20 font-semibold text-lg first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-3 mb-1.5 scroll-m-20 font-semibold text-base first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-2 mb-1 scroll-m-20 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn(
        "aui-md-h5 mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn(
        "aui-md-h6 mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn(
        "aui-md-p my-3 leading-8 first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "aui-md-a text-primary underline underline-offset-2 hover:text-primary/80",
        className,
      )}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote my-2.5 border-muted-foreground/30 border-l-2 pl-3 text-muted-foreground italic",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul my-2 ml-4 list-disc marker:text-muted-foreground [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol my-2 ml-4 list-decimal marker:text-muted-foreground [&>li]:mt-1",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr
      className={cn("aui-md-hr my-2 border-muted-foreground/20", className)}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <table
      className={cn(
        "aui-md-table my-2 w-full border-separate border-spacing-0 overflow-y-auto",
        className,
      )}
      {...props}
    />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-muted px-2 py-1 text-left font-medium first:rounded-tl-lg last:rounded-tr-lg [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-muted-foreground/20 border-b border-l px-2 py-1 text-left last:border-r [[align=center]]:text-center [[align=right]]:text-right",
        className,
      )}
      {...props}
    />
  ),
  tr: ({ className, ...props }) => (
    <tr
      className={cn(
        "aui-md-tr m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-bl-lg [&:last-child>td:last-child]:rounded-br-lg",
        className,
      )}
      {...props}
    />
  ),
  li: ({ className, ...props }) => (
    <li className={cn("aui-md-li leading-8", className)} {...props} />
  ),
  strong: (() => {
    // Cycle through highlight colors across bold phrases within a render
    const COLORS = ["red", "purple", "green"] as const;
    let counter = 0;
    return function StrongHighlight({ children }: any) {
      // Each render of this component picks the next color in sequence
      const color = COLORS[counter % COLORS.length];
      counter++;
      return <Highlight color={color}>{children}</Highlight>;
    };
  })(),
  sup: ({ className, ...props }) => (
    <sup
      className={cn("aui-md-sup [&>a]:text-xs [&>a]:no-underline", className)}
      {...props}
    />
  ),
  pre: ({ className, children, ...props }: any) => {
    // Check if children contain a code block with language-solution
    const isSolution = React.Children.toArray(children).some(
      (child: any) => child?.props?.className?.includes("language-solution")
    );
    if (isSolution) {
      return <div className="aui-md-notebook-wrapper">{children}</div>;
    }
    return (
      <pre
        className={cn(
          "aui-md-pre overflow-x-auto rounded-t-none rounded-b-lg border border-border/50 border-t-0 bg-muted/30 p-4 text-sm leading-relaxed",
          className,
        )}
        dir="ltr"
        {...props}
      >{children}</pre>
    );
  },
  code: function Code({ className, children, ...props }: any) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    if (isCodeBlock && className?.includes("language-solution")) {
      return <NotebookPaper content={String(children)} />;
    }
    return (
      <code
        className={cn(
          !isCodeBlock &&
          "aui-md-inline-code rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        dir="ltr"
        {...props}
      >{children}</code>
    );
  },
  SyntaxHighlighter: CustomSyntaxHighlighter,
  CodeHeader: () => null,
});
