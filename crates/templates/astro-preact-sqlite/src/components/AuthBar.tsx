type User = { email: string; name: string };

type Props = {
  user: User | null;
  configured: boolean;
  authError?: string | null;
};

export function AuthBar({ user, configured, authError }: Props) {
  if (!configured && !authError) return null;
  return (
    <div class="flex flex-wrap items-center justify-end gap-3 px-4 py-3 text-sm">
      {authError && <span class="text-error">{authError}</span>}
      {configured && user && (
        <>
          <span class="text-base-content/80">{user.name || user.email}</span>
          <a href="/api/auth/logout" class="btn btn-ghost btn-sm">
            Se déconnecter
          </a>
        </>
      )}
      {configured && !user && (
        <a href="/api/auth/login" class="btn btn-primary btn-sm">
          Se connecter avec Pocket ID
        </a>
      )}
    </div>
  );
}
