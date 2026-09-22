'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ADMIN_NAV_GROUPS, isAdminRouteActive, visibleAdminItems } from '@/lib/admin-navigation';
import { IconGrid, IconCart, IconUser, IconPay, IconShield, IconSearch } from '@/components/store/icons';

const GROUP_ICONS = [IconGrid, IconUser, IconCart, IconPay, IconGrid, IconShield];

/** فیلتر فقط روی پیوندهای مجاز؛ هیچ دسترسی‌ای با جستجو آشکار نمی‌شود. */
export function AdminNav({ permissions = [] }: { permissions?: string[] }) {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const visible = visibleAdminItems(permissions, query);

  return (
    <div className="admin-navigation">
      <button type="button" className="admin-navigation__toggle" aria-expanded={open}
        aria-controls="admin-navigation-links" onClick={() => setOpen(!open)}>
        <IconGrid size={18} /> {open ? 'بستن منوی مدیریت' : 'منوی مدیریت'}
      </button>
      <nav id="admin-navigation-links" className={`nav admin-navigation__links${open ? ' is-open' : ''}`}
        aria-label="بخش‌های پنل" onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            event.currentTarget.parentElement?.querySelector('button')?.focus();
          }
        }}>
        <label className="admin-nav-search">
          <IconSearch size={17} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="پیدا کردن بخش‌ها…" aria-label="جستجو در منوی مدیریت" />
        </label>
        {ADMIN_NAV_GROUPS.map((group, index) => {
          const items = group.paths.flatMap((path) => visible.filter((item) => item.href === path));
          if (items.length === 0) return null;
          const Icon = GROUP_ICONS[index];
          return (
            <div className="admin-nav-group" key={group.label}>
              <p className="admin-nav-group__title">{group.label}</p>
              {items.map((item) => {
                const active = isAdminRouteActive(pathname, item.href);
                return (
                  <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                    className={`nav__item${active ? ' nav__item--active' : ''}`}
                    aria-current={active ? 'page' : undefined} title={item.hint}>
                    <Icon size={18} />
                    <span className="nav__copy"><span className="nav__label">{item.label}</span>
                      <span className="nav__hint">{item.hint}</span></span>
                    <span className="nav__arrow" aria-hidden>‹</span>
                  </Link>
                );
              })}
            </div>
          );
        })}
        {visible.length === 0 && <p className="admin-nav-empty" role="status">بخشی پیدا نشد.</p>}
      </nav>
    </div>
  );
}
