import React, { ErrorInfo, ReactNode, useState } from "react";
import { AlertTriangle, RefreshCcw, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as Sentry from "@sentry/react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  componentName?: string;
  onRetry?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

function reportError(error: Error, errorInfo: ErrorInfo, componentName?: string) {
  console.error("ErrorBoundary caught an error:", error, errorInfo);
  Sentry.captureException(error, {
    tags: {
      componentName: componentName || 'unknown',
    },
    extra: {
      componentStack: errorInfo.componentStack?.substring(0, 1000),
    }
  });
}

function ErrorFallback({ 
  error, 
  componentName, 
  onRetry 
}: { 
  error?: Error; 
  componentName?: string;
  onRetry?: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const errorText = `
Error: ${error?.message}
Component: ${componentName || 'Unknown'}
Time: ${new Date().toISOString()}
URL: ${window.location.href}
    `.trim();
    
    await navigator.clipboard.writeText(errorText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full flex flex-col items-center justify-center p-8 md:p-12 bg-card rounded-2xl border border-destructive/20 shadow-lg overflow-hidden relative min-h-[400px]">
      <div className="absolute inset-0 bg-gradient-to-br from-destructive/5 to-transparent pointer-events-none" />
      
      <div className="relative z-10 p-4 bg-destructive/10 rounded-full mb-6">
        <AlertTriangle className="w-10 h-10 text-destructive" strokeWidth={1.5} />
      </div>
      
      <h2 className="text-xl font-bold mb-2 text-foreground z-10 text-center">
        Something went wrong
      </h2>
      
      <p className="text-muted-foreground text-center max-w-md mb-6 z-10 text-sm">
        {error?.message || "An unexpected error occurred."}
      </p>

      {componentName && (
        <p className="text-muted-foreground/50 text-center mb-4 z-10 text-xs">
          in {componentName}
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-3 z-10">
        <Button 
          variant="default"
          size="sm"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-6 flex items-center gap-2"
          onClick={() => {
            if (onRetry) {
              onRetry();
            } else {
              window.location.reload();
            }
          }}
        >
          <RefreshCcw className="w-4 h-4" />
          Try Again
        </Button>

        <Button 
          variant="outline"
          size="sm"
          className="rounded-full px-6 flex items-center gap-2"
          onClick={handleCopy}
        >
          <Copy className="w-4 h-4" />
          {copied ? "Copied!" : "Copy Error"}
        </Button>
      </div>

      <button
        onClick={() => setShowDetails(!showDetails)}
        className="mt-4 text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1 z-10"
      >
        {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {showDetails ? "Hide" : "Show"} details
      </button>

      {showDetails && (
        <pre className="mt-4 p-4 bg-muted/50 rounded-lg text-xs text-muted-foreground overflow-auto max-w-full max-h-40 w-full z-10">
          {error?.stack || error?.message || "No error details available"}
        </pre>
      )}
    </div>
  );
}

// Class component is intentional: React 19 still requires class components for
// error boundaries (getDerivedStateFromError / componentDidCatch are not available in hooks).
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, errorInfo, this.props.componentName);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorFallback
          error={this.state.error}
          componentName={this.props.componentName}
          onRetry={this.props.onRetry}
        />
      );
    }
    return this.props.children;
  }
}

// Wrapper component for functional components
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  componentName?: string
) {
  return function ErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary componentName={componentName}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
