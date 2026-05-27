import { Component, type ErrorInfo, type ReactNode } from 'react'

interface CapturedError {
  source: string
  message: string
  stack?: string
  componentStack?: string
}

interface State {
  error: CapturedError | null
}

/**
 * TEMPORARY debugging aid: renders any crash (React render error, global
 * window error, or unhandled promise rejection) as an on-screen stack trace
 * instead of a white screen, so errors can be read on a real mobile device.
 * Remove once the album crash is diagnosed.
 */
export default class DebugErrorOverlay extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return {
      error: {
        source: 'React render',
        message: error?.message ?? String(error),
        stack: error?.stack,
      },
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState(prev => ({
      error: { ...(prev.error ?? { source: 'React render', message: String(error) }), componentStack: info.componentStack ?? undefined },
    }))
  }

  componentDidMount() {
    window.addEventListener('error', this.onWindowError)
    window.addEventListener('unhandledrejection', this.onRejection)
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.onWindowError)
    window.removeEventListener('unhandledrejection', this.onRejection)
  }

  onWindowError = (e: ErrorEvent) => {
    this.capture({
      source: 'window.onerror',
      message: e.message || String(e.error),
      stack: e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`,
    })
  }

  onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason
    this.capture({
      source: 'unhandledrejection',
      message: reason?.message ?? String(reason),
      stack: reason?.stack,
    })
  }

  capture(error: CapturedError) {
    // Don't clobber an already-shown error with a later cascading one.
    this.setState(prev => (prev.error ? prev : { error }))
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div style={styles.overlay}>
        <div style={styles.header}>⚠️ Album crashed — {error.source}</div>
        <div style={styles.message}>{error.message}</div>
        {error.stack && (
          <>
            <div style={styles.label}>Stack</div>
            <pre style={styles.pre}>{error.stack}</pre>
          </>
        )}
        {error.componentStack && (
          <>
            <div style={styles.label}>Component stack</div>
            <pre style={styles.pre}>{error.componentStack}</pre>
          </>
        )}
        <button style={styles.btn} onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 99999,
    background: '#fff',
    color: '#111',
    padding: '1rem',
    overflow: 'auto',
    font: '13px/1.5 ui-monospace, Menlo, Consolas, monospace',
    WebkitOverflowScrolling: 'touch',
  },
  header: { fontWeight: 700, fontSize: '15px', color: '#b00020', marginBottom: '0.75rem' },
  message: { fontWeight: 700, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '1rem' },
  label: { fontWeight: 700, marginTop: '0.75rem', marginBottom: '0.25rem', color: '#555' },
  pre: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: '#f4f4f4',
    padding: '0.6rem',
    borderRadius: '4px',
    margin: 0,
  },
  btn: {
    marginTop: '1.25rem',
    padding: '0.7rem 1.5rem',
    border: '1px solid #888',
    background: '#fff',
    borderRadius: '4px',
    font: 'inherit',
  },
}
