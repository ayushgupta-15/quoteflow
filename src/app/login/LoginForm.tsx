"use client";

import { useActionState } from "react";
import { loginAction, type ActionState } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, {});
  return (
    <form action={action} noValidate>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error ? (
        <div className="notice bad" role="alert" style={{ marginBottom: 14 }}>
          {state.error}
        </div>
      ) : null}
      <button className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
