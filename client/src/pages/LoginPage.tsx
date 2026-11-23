import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not log in');
      setSubmitting(false);
    }
  };

  return (
    <main className="login">
      <form className="card login-card" onSubmit={(event) => void submit(event)}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          OrderPulse
        </div>
        <p className="muted">Real-time order tracking. Log in to see the live dashboard.</p>

        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoFocus
          />
        </label>

        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button primary" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>

        <p className="muted hint">
          Seeded demo users: <code>admin@orderpulse.dev</code> and <code>member@orderpulse.dev</code>
          , password <code>orderpulse-demo</code>.
        </p>
      </form>
    </main>
  );
}
