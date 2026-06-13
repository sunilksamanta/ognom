import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Bumping this value (e.g. the active tab id) clears a previous error. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

/**
 * Stops a render-time throw in one pane from blanking the whole app. Shows the
 * error and lets the user recover instead of staring at a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    // Auto-clear when the surrounding context changes (e.g. switching tabs).
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-lg rounded-lg border border-destructive/40 bg-destructive/5 p-5 text-sm">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="font-medium">Something broke in this view</span>
          </div>
          <p className="mt-2 text-muted-foreground">
            The rest of the app is fine — you can retry or switch tabs.
          </p>
          {error.message && (
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-card p-2.5 font-mono text-[11px] text-muted-foreground">
              {error.message}
            </pre>
          )}
          <div className="mt-4 flex gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => this.setState({ error: null })}>
              <RotateCcw className="h-3.5 w-3.5" />
              Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload app
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
