'use client';
import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/** Stops a crash in the 3D engine (or any screen) from taking down the whole app. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('[Veyra] render error:', error, info);
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="v-error">
            <div className="v-error-title">Đã xảy ra lỗi</div>
            <button className="v-btn v-btn-primary v-btn-md" onClick={this.reset}>Thử lại</button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
