import Link from 'next/link';
import { currentShopper } from '@/lib/shopper-actions';
import { AccountShell } from '@/components/store/account-shell';

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const me = await currentShopper();

  return (
    <AccountShell active="dashboard">
      {me ? <Dashboard me={me} /> : null}
    </AccountShell>
  );
}

function Dashboard({ me }: { me: { fullName: string | null; phone: string; counts: { orders: number; addresses: number; wishlist: number } } }) {
  const cards = [
    {
      href: '/account/orders',
      title: 'سفارش‌ها',
      desc: 'رهگیری و تاریخچه‌ی خرید',
      count: me.counts.orders,
      iconClass: 'acct__card-icon--orders',
      icon: '📦',
    },
    {
      href: '/account/addresses',
      title: 'نشانی‌ها',
      desc: 'نشانی‌هایِ ذخیره‌شده برای ارسال',
      count: me.counts.addresses,
      iconClass: 'acct__card-icon--addresses',
      icon: '📍',
    },
    {
      href: '/account/wishlist',
      title: 'علاقه‌مندی‌ها',
      desc: 'کالاهایی که نشان کرده‌اید',
      count: me.counts.wishlist,
      iconClass: 'acct__card-icon--wishlist',
      icon: '❤️',
    },
  ];

  return (
    <>
      <div className="acct__head">
        <h1 className="acct__title">سلام{me.fullName ? `، ${me.fullName}` : ''} 👋</h1>
        <p className="acct__sub">به پیشخوانِ حسابتان خوش آمدید</p>
      </div>

      <div className="acct__cards">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} className="acct__card">
            <span className={`acct__card-icon ${c.iconClass}`} aria-hidden>
              {c.icon}
            </span>
            <div className="acct__card-info">
              <div className="acct__card-title">{c.title}</div>
              <div className="acct__card-desc">{c.desc}</div>
            </div>
            <span className="acct__card-count num">{c.count}</span>
          </Link>
        ))}
      </div>
    </>
  );
}