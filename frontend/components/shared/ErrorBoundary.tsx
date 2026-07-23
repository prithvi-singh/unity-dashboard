'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const label = this.props.label ?? 'Tab';
    console.error(`[ErrorBoundary] ${label} render error:`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center space-y-3">
          <p className="text-sm font-semibold text-rose-700">
            Something went wrong loading {this.props.label ?? 'this section'}.
          </p>
          {this.state.message && (
            <p className="text-xs text-rose-500 font-mono bg-rose-100 rounded px-3 py-2 inline-block max-w-full truncate">
              {this.state.message}
            </p>
          )}
          <div>
            <button
              onClick={this.handleRetry}
              className="text-xs font-semibold text-rose-600 underline hover:text-rose-800 transition-colors"
            >
              Try again
            </button>
            <span className="text-xs text-rose-400 ml-2">or refresh the page</span>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
