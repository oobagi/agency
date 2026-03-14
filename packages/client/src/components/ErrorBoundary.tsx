import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallbackLabel: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    color: '#e2e8f0',
    fontFamily: 'monospace',
    fontSize: '13px',
    background: '#1e1e2e',
    borderRadius: '8px',
    border: '1px solid #4a4a6a',
    margin: '8px',
    minHeight: '120px',
  },
  label: {
    fontSize: '15px',
    fontWeight: 600 as const,
    marginBottom: '8px',
    color: '#f87171',
  },
  message: {
    color: '#a0aec0',
    marginBottom: '12px',
    textAlign: 'center' as const,
    maxWidth: '400px',
    wordBreak: 'break-word' as const,
  },
  button: {
    padding: '6px 16px',
    background: '#4a4a6a',
    color: '#e2e8f0',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '13px',
  },
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.fallbackLabel}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.label}>{this.props.fallbackLabel} crashed</div>
          <div style={styles.message}>{this.state.error?.message ?? 'Unknown error'}</div>
          <button
            style={styles.button}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
