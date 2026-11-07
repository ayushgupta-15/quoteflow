import Link from "next/link";

export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Not found</h1>
        <p className="muted" style={{ margin: "8px 0 16px" }}>
          That page does not exist, or you do not have access to it.
        </p>
        <Link className="btn primary" href="/rfqs">
          Back to RFQs
        </Link>
      </div>
    </div>
  );
}
