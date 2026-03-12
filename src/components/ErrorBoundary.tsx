import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="fixed inset-0 flex flex-col items-center justify-center gap-6 px-6"
          style={{ background: '#0b0f14', color: '#e5e7eb' }}
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="font-bold text-lg" style={{ color: '#ef4444' }}>
              Something went wrong
            </span>
            <span className="text-sm max-w-sm" style={{ color: '#6b7280' }}>
              {this.state.message || 'An unexpected error occurred.'}
            </span>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 rounded-xl font-bold text-sm"
            style={{ background: '#3b82f6', color: '#0b0f14' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
