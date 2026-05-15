import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { View } from '../types';
import { useAppPreferences } from '../context/AppPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { I } from './Icons';

const MD_MIN = 768;
const W_COLLAPSED = 68;
const W_EXPANDED = 248;

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${MD_MIN - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MD_MIN - 1}px)`);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return mobile;
}

interface Item {
  key: View;
  labelKey: string;
  icon: React.ReactNode;
  badge?: number | string;
}

const items: Item[] = [
  { key: 'inbox',     labelKey: 'nav.inbox',     icon: <I.Inbox className="h-5 w-5" /> },
  { key: 'orders',    labelKey: 'nav.orders',    icon: <I.Box   className="h-5 w-5" /> },
  { key: 'shop',      labelKey: 'nav.shop',      icon: <I.Store className="h-5 w-5" /> },
  { key: 'autoReply', labelKey: 'nav.autoReply', icon: <I.Bot   className="h-5 w-5" /> },
];

interface Props {
  active: View;
  onChange: (view: View) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function labelStyle(expanded: boolean): React.CSSProperties {
  return {
    maxWidth:   expanded ? 180  : 0,
    opacity:    expanded ? 1    : 0,
    overflow:   'hidden',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    transition: expanded
      ? 'max-width 300ms cubic-bezier(0.4,0,0.2,1) 30ms, opacity 240ms ease-in 50ms'
      : 'max-width 260ms cubic-bezier(0.4,0,0.2,1), opacity 160ms ease-out',
  };
}

// ── Profile popup menu ─────────────────────────────────────────────────────────

interface MenuPos { bottom: number; left: number; width: number }

interface ProfileMenuProps {
  pos: MenuPos;
  onClose: () => void;
  onNavigate: (view: View) => void;
  active: View;
  displayName: string;
  username: string;
  shopName?: string | null;
  onLogout: () => void;
}

function ProfileMenu({ pos, onClose, onNavigate, active, displayName, username, shopName, onLogout }: ProfileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Trigger enter animation on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 180);
  }

  function nav(view: View) {
    onNavigate(view);
    handleClose();
  }

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: pos.bottom,
    left: pos.left,
    minWidth: Math.max(pos.width, 220),
    zIndex: 9999,
    transformOrigin: 'bottom left',
    transform: visible ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.97)',
    opacity: visible ? 1 : 0,
    transition: 'transform 180ms cubic-bezier(0.16,1,0.3,1), opacity 160ms ease',
    pointerEvents: visible ? 'auto' : 'none',
  };

  const avatarLetters = initials(displayName || username);

  return createPortal(
    <div
      ref={menuRef}
      style={menuStyle}
      role="menu"
      aria-label="บัญชีผู้ใช้"
      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-slate-900/60"
    >
      {/* Profile header */}
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-[12px] font-bold text-white ring-2 ring-white dark:bg-brand-500 dark:ring-slate-900">
          {avatarLetters}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {displayName || username}
          </div>
          {displayName && username !== displayName && (
            <div className="truncate text-xs text-slate-400 dark:text-slate-500">@{username}</div>
          )}
        </div>
      </div>

      {/* Active shop strip (Phase 1: display-only; shop switcher arrives in Phase 3) */}
      {shopName && (
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
          <I.Store className="h-4 w-4 text-slate-400 dark:text-slate-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">ร้านที่กำลังใช้งาน</div>
            <div className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{shopName}</div>
          </div>
        </div>
      )}

      {/* Menu items */}
      <div className="p-1.5">
        <MenuBtn
          icon={<I.Chart className="h-[18px] w-[18px]" />}
          label="วิเคราะห์"
          active={active === 'analytics'}
          onClick={() => nav('analytics')}
        />
        <MenuBtn
          icon={<I.Settings className="h-[18px] w-[18px]" />}
          label="ตั้งค่า"
          active={active === 'settings'}
          onClick={() => nav('settings')}
        />
      </div>

      {/* Divider + logout */}
      <div className="border-t border-slate-100 p-1.5 dark:border-slate-800">
        <MenuBtn
          icon={<I.LogOut className="h-[18px] w-[18px]" />}
          label="ออกจากระบบ"
          danger
          onClick={() => { onLogout(); handleClose(); }}
        />
      </div>
    </div>,
    document.body,
  );
}

function MenuBtn({
  icon,
  label,
  onClick,
  active = false,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'bg-brand-600 text-white dark:bg-brand-500'
          : danger
            ? 'text-rose-500 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
      ].join(' ')}
    >
      <span className={active ? 'text-white' : danger ? '' : 'opacity-70'}>{icon}</span>
      {label}
    </button>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

export function Sidebar({ active, onChange }: Props) {
  const { t } = useAppPreferences();
  const { user, logout, activeShop } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPos>({ bottom: 0, left: 0, width: 220 });
  const userBtnRef = useRef<HTMLButtonElement>(null);

  const expanded = isMobile ? mobileOpen : open;

  useEffect(() => {
    setOpen(false);
    setMobileOpen(false);
  }, [isMobile]);

  const lbl = labelStyle(expanded);

  const toggleSidebar = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isMobile) {
        setMobileOpen((v) => !v);
        return;
      }
      setOpen((v) => !v);
    },
    [isMobile],
  );

  function openProfileMenu() {
    if (!userBtnRef.current) return;
    const rect = userBtnRef.current.getBoundingClientRect();
    setMenuPos({
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left,
      width: Math.max(rect.width, 220),
    });
    setProfileMenuOpen(true);
    if (isMobile) setMobileOpen(false);
  }

  const aside = (
    <aside
      style={!isMobile ? { width: expanded ? W_EXPANDED : W_COLLAPSED } : undefined}
      className={[
        'flex h-screen shrink-0 flex-col overflow-hidden border-r border-slate-200/90 bg-white select-none',
        'dark:border-slate-800 dark:bg-slate-900',
        !isMobile ? 'transition-[width] duration-300 ease-in-out' : '',
        isMobile
          ? 'fixed left-0 top-0 z-[45] w-[248px] shadow-2xl transition-transform duration-300 ease-in-out ' +
            (expanded ? 'translate-x-0' : '-translate-x-full pointer-events-none')
          : '',
      ].filter(Boolean).join(' ')}
    >
      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-[14px] pt-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white shadow-sm ring-4 ring-brand-100 dark:bg-brand-500 dark:ring-brand-900/40">
            <I.Zap className="h-[18px] w-[18px]" />
          </div>
          <div style={lbl}>
            <div className="text-[17px] font-extrabold leading-none tracking-tight text-slate-900 dark:text-white">
              Chatz
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {t('sidebar.workspace')}
            </div>
          </div>
        </div>
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden overscroll-y-contain px-2 pb-2">
        {items.map((it) => {
          const isActive = active === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => {
                onChange(it.key);
                if (isMobile) setMobileOpen(false);
              }}
              title={!expanded ? t(it.labelKey) : undefined}
              className={[
                'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
              ].join(' ')}
            >
              <span
                className={
                  'shrink-0 ' +
                  (isActive
                    ? 'text-white'
                    : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300')
                }
              >
                {it.icon}
              </span>
              <span style={lbl}>{t(it.labelKey)}</span>
              {it.badge != null && (
                <span
                  style={lbl}
                  className={
                    'chip shrink-0 ' +
                    (isActive
                      ? 'bg-white/20 text-white'
                      : typeof it.badge === 'number'
                        ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200'
                        : 'bg-brand-600 text-white dark:bg-brand-500')
                  }
                >
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-slate-200 dark:border-slate-800">
        {/* Toggle button */}
        <div
          className={[
            'flex shrink-0 px-2 pt-2 pb-1',
            expanded ? 'justify-end' : 'justify-center',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={toggleSidebar}
            title={expanded ? 'เก็บเมนู' : 'เปิดเมนู'}
            aria-label={expanded ? 'เก็บเมนู' : 'เปิดเมนู'}
            aria-expanded={expanded}
            className={[
              'grid h-8 w-8 place-items-center rounded-xl transition',
              expanded
                ? 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-400'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
            ].join(' ')}
          >
            {expanded ? (
              <I.ChevronLeft className="h-4 w-4" />
            ) : (
              <I.ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* User row — click to open profile menu */}
        <button
          ref={userBtnRef}
          type="button"
          onClick={openProfileMenu}
          aria-haspopup="menu"
          aria-expanded={profileMenuOpen}
          title={!expanded ? (user?.displayName || user?.username || undefined) : undefined}
          className={[
            'group flex w-full items-center py-3 transition-[padding,gap,background] duration-300',
            expanded ? 'gap-2.5 px-4' : 'justify-center px-2',
            'rounded-none hover:bg-slate-50 dark:hover:bg-slate-800/60',
            profileMenuOpen ? 'bg-slate-50 dark:bg-slate-800/60' : '',
          ].join(' ')}
        >
          {/* Avatar */}
          <div
            className={[
              'grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ring-2 ring-white transition dark:ring-slate-900',
              profileMenuOpen
                ? 'bg-brand-700 dark:bg-brand-400'
                : 'bg-brand-600 dark:bg-brand-500',
            ].join(' ')}
            aria-hidden
          >
            {user ? initials(user.displayName || user.username) : '??'}
          </div>

          {/* Name */}
          <div
            style={{ ...lbl, flex: 1, minWidth: 0, maxWidth: expanded ? 140 : 0 }}
          >
            <div className="truncate text-left text-sm font-semibold text-slate-900 dark:text-slate-100">
              {user?.displayName || user?.username || '—'}
            </div>
            <div className="text-left text-[11px] text-slate-400 dark:text-slate-500">
              บัญชีของฉัน
            </div>
          </div>

          {/* Chevron up indicator */}
          <div
            style={{
              maxWidth: expanded ? 20 : 0,
              opacity: expanded ? 1 : 0,
              overflow: 'hidden',
              flexShrink: 0,
              transition: lbl.transition,
            }}
          >
            <I.ChevronUp
              className={[
                'h-4 w-4 text-slate-400 transition-transform duration-200 dark:text-slate-500',
                profileMenuOpen ? 'rotate-0' : 'rotate-180',
              ].join(' ')}
            />
          </div>
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {isMobile ? (
        <div className="relative w-0 shrink-0 overflow-visible">
          {expanded && (
            <button
              type="button"
              aria-label="ปิดเมนู"
              className="fixed inset-0 z-[40] bg-slate-900/35 backdrop-blur-[1px]"
              onClick={() => setMobileOpen(false)}
            />
          )}
          {aside}
        </div>
      ) : (
        aside
      )}

      {profileMenuOpen && user && (
        <ProfileMenu
          pos={menuPos}
          onClose={() => setProfileMenuOpen(false)}
          onNavigate={(v) => { onChange(v); }}
          active={active}
          displayName={user.displayName || user.username}
          username={user.username}
          shopName={activeShop?.name || null}
          onLogout={() => void logout()}
        />
      )}
    </>
  );
}
