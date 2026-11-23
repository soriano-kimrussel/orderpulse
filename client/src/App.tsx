import { useAuth } from './auth';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  const { session } = useAuth();
  // Keyed by user so a different login starts with fresh dashboard state.
  return session ? <DashboardPage key={session.user.id} session={session} /> : <LoginPage />;
}
