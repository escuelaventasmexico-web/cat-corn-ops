import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PieceSalesErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('PieceSales Error:', error);
    console.error('Error Info:', info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-2xl flex flex-col items-start gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-300 mb-1">Ocurrió un error en Venta por pieza</h3>
              <p className="text-sm text-red-200">
                {this.state.error?.message || 'Error desconocido'}
              </p>
              <details className="mt-2 text-xs text-red-300 opacity-75">
                <summary className="cursor-pointer font-semibold">Detalles técnicos</summary>
                <pre className="mt-1 bg-black/20 p-2 rounded overflow-auto text-xs whitespace-pre-wrap">
                  {this.state.error?.stack}
                </pre>
              </details>
            </div>
          </div>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg text-sm font-semibold transition-colors"
          >
            Volver a intentar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
