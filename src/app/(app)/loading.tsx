export default function Loading() {
  return (
    <div className="stack" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 32, width: 260 }} />
      <div className="skeleton" style={{ height: 40 }} />
      <div className="skeleton" style={{ height: 256 }} />
    </div>
  );
}
