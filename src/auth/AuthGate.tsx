/** Shows the sign-in screen until there's a session, on deployments that have accounts. */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authClient, detectBackend, type Backend } from './client.ts';
import { AppSkeleton } from '../app/Skeleton.tsx';
import { SignIn } from './SignIn.tsx';

export interface Account {
  readonly name: string;
  readonly email: string;
  readonly image?: string | null;
  signOut(): Promise<void>;
}

const AccountContext = createContext<Account | null>(null);

/** The signed-in user, or null where there are no accounts (local dev server). */
export function useAccount(): Account | null {
  return useContext(AccountContext);
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  useEffect(() => {
    void detectBackend().then(setBackend);
  }, []);
  if (!backend) return <AppSkeleton />;
  if (!backend.auth) return <>{children}</>;
  return <Session providers={backend.providers}>{children}</Session>;
}

function Session({ providers, children }: { providers: readonly string[]; children: ReactNode }) {
  const { data, isPending, refetch } = authClient.useSession();
  if (isPending) return <AppSkeleton />;
  if (!data) return <SignIn providers={providers} />;
  const account: Account = {
    name: data.user.name,
    email: data.user.email,
    image: data.user.image,
    signOut: async () => {
      await authClient.signOut();
      await refetch();
    },
  };
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}
