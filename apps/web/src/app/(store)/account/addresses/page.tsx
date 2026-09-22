import Link from 'next/link';
import { currentShopper, shopperAddresses, saveAddress, deleteAddress } from '@/lib/shopper-actions';
import { AccountShell } from '@/components/store/account-shell';

export const dynamic = 'force-dynamic';

export default async function AddressesPage() {
  return (
    <AccountShell active="addresses" next="/account/addresses">
      <AddressesContent />
    </AccountShell>
  );
}

async function AddressesContent() {
  const addresses = await shopperAddresses();

  return (
    <>
      <div className="acct__head">
        <h1 className="acct__title">نشانی‌ها</h1>
        <p className="acct__sub">نشانی‌هایِ ذخیره‌شده برای ارسالِ سفارش‌ها</p>
      </div>

      {addresses.length > 0 ? (
        <div style={{ display: 'grid', gap: 'var(--st-3)', marginBottom: 'var(--st-5)' }}>
          {addresses.map((a) => (
            <div key={a.id} className="acct__addr-card">
              <div className="acct__addr-info">
                <div className="acct__addr-name">
                  {a.receiverName}
                  {a.isDefault ? (
                    <span className="acct__badge acct__badge--default" style={{ marginInlineStart: 8 }}>پیش‌فرض</span>
                  ) : null}
                </div>
                <div className="acct__addr-detail">
                  {a.province}، {a.city}، {a.address}
                </div>
                <div className="acct__addr-meta">
                  <span className="num">{a.phone}</span> · کدِ پستی <span className="num">{a.postalCode ?? '—'}</span>
                </div>
              </div>
              <div className="acct__addr-actions">
                <form action={deleteAddress}>
                  <input type="hidden" name="id" value={a.id} />
                  <button className="btn-p btn-p--outline" type="submit" style={{ fontSize: '1.2rem', height: 36 }}>
                    حذف
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="acct__empty" style={{ marginBottom: 'var(--st-5)' }}>
          <div className="acct__empty-icon" aria-hidden>📍</div>
          <div className="acct__empty-title">نشانی‌ای ذخیره نشده است</div>
          <p className="acct__empty-desc">
            نشانیِ نخست را همین پایین اضافه کنید تا در صفحه‌ی پرداخت دوباره تایپ نشود.
          </p>
        </div>
      )}

      {/* فرمِ افزودن */}
      <section className="acct__section">
        <h2 className="acct__section-title">
          <span className="acct__section-icon" aria-hidden>➕</span>
          نشانیِ تازه
        </h2>
        <AddressForm />
      </section>
    </>
  );
}

function AddressForm() {
  return (
    <form
      action={async (formData: FormData) => { 'use server'; await saveAddress(null, formData); }}
      className="acct__form"
    >
      <div className="acct__form-grid">
        <Field name="receiverName" label="نامِ گیرنده" required placeholder="مثال: سارا کریمی" />
        <Field name="phone" label="شمارهٔ همراه" required dir="ltr" placeholder="۰۹۱۲۳۴۵۶۷۸۹" />
        <Field name="province" label="استان" required placeholder="مثال: تهران" />
        <Field name="city" label="شهر" required placeholder="مثال: تهران" />
        <Field name="postalCode" label="کدِ پستی (۱۰ رقم)" required dir="ltr" placeholder="1234567890" />
      </div>

      <div className="acct__field">
        <label htmlFor="address" className="acct__label">نشانیِ دقیق</label>
        <textarea
          id="address"
          name="address"
          required
          rows={3}
          className="acct__input acct__textarea"
          placeholder="خیابان، کوچه، پلاک، واحد..."
        />
      </div>

      <label className="acct__checkbox">
        <input type="checkbox" name="isDefault" defaultChecked />
        این نشانی پیش‌فرضِ من باشد
      </label>

      <div>
        <button className="btn-p btn-p--primary" type="submit">ذخیره‌ی نشانی</button>
      </div>
    </form>
  );
}

function Field({ name, label, required, dir, placeholder }: {
  name: string;
  label: string;
  required?: boolean;
  dir?: 'ltr' | 'rtl';
  placeholder?: string;
}) {
  return (
    <div className="acct__field">
      <label htmlFor={name} className="acct__label">{label}</label>
      <input
        id={name}
        name={name}
        required={required}
        dir={dir}
        placeholder={placeholder}
        className={`acct__input${dir === 'ltr' ? ' acct__input--ltr' : ''}`}
      />
    </div>
  );
}