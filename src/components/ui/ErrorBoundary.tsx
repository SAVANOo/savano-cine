import { Component, type ErrorInfo, type ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

/** Prevents raw React/framework error stacks from leaking to the user. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Intentionally silent in production UI to avoid leaking internal component traces
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#08090d] px-6 text-center text-[#f5f5f7]">
          <div className="max-w-md space-y-4 rounded-2xl border border-white/15 bg-[#11131b] p-8 shadow-2xl">
            <h1 className="m-0 text-xl font-bold">Algo deu errado</h1>
            <p className="m-0 text-sm text-[#b4b8c5]">
              Ocorreu um erro inesperado ao exibir esta tela. Recarregue para continuar.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-[#e50914] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#f40612] cursor-pointer"
            >
              Recarregar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
