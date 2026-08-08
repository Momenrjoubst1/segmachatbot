import { cn } from "@/lib/cn";
import "./notebook.css";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

interface NotebookPaperProps {
  content: string;
  className?: string;
}

export function NotebookPaper({ content, className }: NotebookPaperProps) {
  return (
    <div className={cn("notebook-page mt-4 mb-4", className)}>
      <div className="notebook-margin"></div>
      <div className="notebook-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => <p>{children}</p>,
            h1: ({ children }) => <h1>{children}</h1>,
            h2: ({ children }) => <h2>{children}</h2>,
            h3: ({ children }) => <h3>{children}</h3>,
            ul: ({ children }) => <ul>{children}</ul>,
            ol: ({ children }) => <ol>{children}</ol>,
            li: ({ children }) => <li>{children}</li>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
