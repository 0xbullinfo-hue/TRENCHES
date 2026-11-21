'use client';

import React from 'react';

type Props = {
  panelName: string;
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  error?: Error;
};

/** Isolates panel rendering failures and lets the user retry locally. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (typeof window !== 'undefined') {
      console.error(`[${this.props.panelName}] panel crashed`, error, info);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface-card p-6 text-center">
        <p className="text-sm text-muted">
          {this.props.panelName} failed to load
        </p>
        <p className="text-xs text-dim">
          {this.state.error?.message ?? 'Unknown error'}
        </p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="rounded-md border border-line bg-canvas px-4 py-2 text-sm text-ink hover:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Retry
        </button>
      </div>
    );
  }
}
