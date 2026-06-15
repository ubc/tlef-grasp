import { Component } from "react";

// Catches render-time crashes so a bug in one page doesn't white-screen the app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-8">
        <div className="max-w-md rounded-2xl bg-white p-10 text-center shadow-sm">
          <i className="fas fa-exclamation-triangle mb-4 text-4xl text-warning" />
          <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">
            An unexpected error occurred. Reloading the page usually fixes this; if it
            keeps happening, please contact support.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg bg-primary px-5 py-2.5 font-medium text-white transition-colors hover:bg-primary-dark"
          >
            <i className="fas fa-sync mr-2" />
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
