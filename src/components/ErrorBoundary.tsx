import { Component, ErrorInfo, ReactNode } from 'react';
 
type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };
 
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }
 
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }
 
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App error:', error, info);
  }
 
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
          <div className="text-center max-w-sm">
            <h2 className="text-slate-900 dark:text-white font-bold text-xl mb-2">Something went wrong</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
              The app encountered an error. Please try refreshing the page.
            </p>
            <button
              onClick={() => {
                localStorage.removeItem('chat_session_token');
                window.location.reload();
              }}
              className="bg-cyan-500 hover:bg-cyan-400 text-white font-medium px-6 py-2.5 rounded-xl transition-all"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }
 
    return this.props.children;
  }
}