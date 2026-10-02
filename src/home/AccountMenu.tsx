/**
 * The signed-in person at the top of the sidebar, and their menu: profile, theme, sign out.
 * Without accounts (local workspace) it shows the local profile and the same menu.
 */
import { ChevronDown, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react';
import { useState } from 'react';
import { navigate } from '../app/router.ts';
import { setTheme, useTheme, type ThemeChoice } from '../app/theme.ts';
import { useAccount } from '../auth/AuthGate.tsx';
import { Logo } from '../app/Logo.tsx';
import type { Profile } from '../serialization/storage.ts';
import { Avatar } from './Avatar.tsx';
import { MenuDivider, MenuItem, useDismiss } from './Menu.tsx';

const THEMES: readonly { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function displayName(profile: Profile | null, accountName?: string): string {
  return profile?.name || accountName || 'Plastic';
}

export function AccountMenu({ profile }: { profile: Profile | null }) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const theme = useTheme();
  const name = displayName(profile, account?.name);
  const handle = profile?.username ? `@${profile.username}` : (profile?.email ?? account?.email ?? 'Local workspace');
  const hasPerson = !!(account || profile?.name);

  return (
    <div className="home-account-anchor" ref={ref}>
      <button type="button" className={`home-account${open ? ' is-open' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {hasPerson ? <Avatar name={name} fallback={profile?.email ?? account?.email} size={24} /> : <Logo size={24} />}
        <span className="home-account-name" title={handle}>
          {name}
        </span>
        <ChevronDown size={13} strokeWidth={1.75} className="home-account-chevron" />
      </button>
      {open && (
        <div className="home-menu home-account-menu" role="menu">
          <div className="home-account-card">
            {hasPerson ? <Avatar name={name} fallback={profile?.email ?? account?.email} size={32} /> : <Logo size={32} />}
            <div className="home-account-card-text">
              <div className="home-account-card-name">{name}</div>
              <div className="home-account-card-handle">{handle}</div>
            </div>
          </div>
          <MenuDivider />
          <MenuItem
            icon={<UserRound size={14} strokeWidth={1.75} />}
            onSelect={() => {
              setOpen(false);
              navigate('/profile');
            }}
          >
            Profile
          </MenuItem>
          <div className="home-menu-row">
            <span className="home-menu-label">Theme</span>
            <div className="home-theme" role="radiogroup" aria-label="Theme">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={theme === value}
                  title={label}
                  aria-label={label}
                  className={`home-theme-option${theme === value ? ' is-active' : ''}`}
                  onClick={() => setTheme(value)}
                >
                  <Icon size={13} strokeWidth={1.75} />
                </button>
              ))}
            </div>
          </div>
          {account && (
            <>
              <MenuDivider />
              <MenuItem icon={<LogOut size={14} strokeWidth={1.75} />} onSelect={() => void account.signOut()}>
                Sign out
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}
