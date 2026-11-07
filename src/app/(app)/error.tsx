"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card">
      <div className="empty">
        <strong>Something went wrong</strong>
        The page could not be loaded. Nothing you entered has been lost on the server.
        <div style={{ marginTop: 14 }}>
          <button className="btn" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
