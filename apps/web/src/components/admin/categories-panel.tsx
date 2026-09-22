'use client';

import { useEffect, useMemo, useState } from 'react';

import { faDigits } from '@/lib/format';

import {
  createCategory,
  deleteCategory,
  loadAllCategories,
  moveCategory,
  renameCategory,
  toggleCategoryActive,
  type Category,
} from '@/lib/category-actions';

/**
 * پنلِ دسته‌بندی.
 *
 * سه تصمیمِ رابط اینجا مستقیم به یک خطر جواب می‌دهد:
 *
 *  ۱. **درخت تورفته نشان داده می‌شود، نه فهرستی تخت**. اگر ژرفا دیده نشود،
 *     فروشنده نمی‌فهمد کدام «شارژر» زیرِ «شارژر و آداپتور» است و کدام خود
 *     یک ریشه.
 *  ۲. **جابه‌جایی، مقصد را از یک آبشار می‌گیرد**. نوشتنِ شناسه یا جست‌وجویِ
 *     دسته در فهرستی بلند یعنی اشتباه؛ آبشار همه‌یِ دسته‌ها را با مسیرشان
 *     نشان می‌دهد («شارژر و آداپتور › شارژرِ دیواری»).
 *  ۳. **حذف، پیش از پاک کردن می‌پرسد مقصدِ کالاها کجاست**. پاک کردنِ دسته‌ای
 *     که کالا دارد، کالاها را از همه‌یِ مسیرهایِ پیدا کردن بیرون می‌اندازد؛
 *     پس یا مقصد می‌گیریم یا اصلاً اجازه نمی‌دهیم.
 */

type Status = { tone: 'ok' | 'bad'; text: string } | null;

export function CategoriesPanel() {
  const [items, setItems] = useState<Category[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [deleteFor, setDeleteFor] = useState<Category | null>(null);
  const [moveProductsTo, setMoveProductsTo] = useState('');
  const [moveChildrenTo, setMoveChildrenTo] = useState('');

  useEffect(() => {
    void loadAllCategories().then((result) => {
      if (result.ok) setItems(result.data);
      else setStatus({ tone: 'bad', text: result.message });
    });
  }, []);

  /** درختِ مرتب‌شده بر پایه‌یِ مسیر، تا هر دسته زیرِ پدرش بیاید */
  const ordered = useMemo(
    () => [...items].sort((a, b) => a.path.localeCompare(b.path, 'fa') || a.sortOrder - b.sortOrder),
    [items],
  );

  const label = (item: Category): string => {
    const trail = item.path
      .split('/')
      .filter(Boolean)
      .slice(0, -1)
      .map((slug) => items.find((candidate) => candidate.slug === slug)?.name ?? slug);
    return trail.length > 0 ? `${trail.join(' › ')} › ${item.name}` : item.name;
  };

  /** برایِ آبشارِ مقصد: همه جز خودِ دسته و فرزندانش (که چرخه می‌سازد) */
  const moveOptions = (excludeId: string): Category[] => {
    const banned = new Set<string>([excludeId]);
    // فرزندان را هم بیرون می‌گذاریم: جابه‌جایی به زیرِ فرزند یعنی چرخه
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of items) {
        if (item.parentId && banned.has(item.parentId) && !banned.has(item.id)) {
          banned.add(item.id);
          grew = true;
        }
      }
    }
    return ordered.filter((item) => !banned.has(item.id));
  };

  async function reload() {
    const result = await loadAllCategories();
    if (result.ok) setItems(result.data);
  }

  async function add() {
    if (name.trim().length === 0) {
      setStatus({ tone: 'bad', text: 'نامِ دسته را بنویسید.' });
      return;
    }
    setBusy(true);
    const result = await createCategory({ name: name.trim(), parentId: parentId || null });
    setBusy(false);
    if (result.ok) {
      setName('');
      setStatus({ tone: 'ok', text: `${result.data.message} اکنون در منویِ فروشگاه می‌آید.` });
      await reload();
    } else setStatus({ tone: 'bad', text: result.message });
  }

  async function saveName(id: string) {
    if (editName.trim().length === 0) return;
    setBusy(true);
    const result = await renameCategory(id, editName.trim());
    setBusy(false);
    setEditing(null);
    if (result.ok) {
      setStatus({ tone: 'ok', text: result.data.message });
      await reload();
    } else setStatus({ tone: 'bad', text: result.message });
  }

  async function doMove(id: string) {
    setBusy(true);
    const result = await moveCategory(id, moveTarget || null);
    setBusy(false);
    setMoveFor(null);
    setMoveTarget('');
    if (result.ok) {
      setStatus({ tone: 'ok', text: result.data.message });
      await reload();
    } else setStatus({ tone: 'bad', text: result.message });
  }

  async function doDelete() {
    if (!deleteFor) return;
    setBusy(true);
    const result = await deleteCategory(deleteFor.id, {
      moveProductsTo: moveProductsTo || undefined,
      moveChildrenTo: moveChildrenTo || undefined,
    });
    setBusy(false);
    setDeleteFor(null);
    setMoveProductsTo('');
    setMoveChildrenTo('');
    if (result.ok) {
      setStatus({ tone: 'ok', text: result.data.message });
      await reload();
    } else setStatus({ tone: 'bad', text: result.message });
  }

  return (
    <div className="stack">
      {status ? (
        <div className={status.tone === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{status.text}</div>
      ) : null}

      {/* ── ساخت ──────────────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="card__title">دسته‌یِ تازه</h3>
        <div className="grid-2">
          <label className="field">
            <span className="field__label">نام</span>
            <input
              className="field__input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="شارژرِ بی‌سیم"
            />
          </label>
          <label className="field">
            <span className="field__label">زیرِ کدام دسته؟</span>
            <select className="field__input" value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">— ریشه (بالاترین سطح) —</option>
              {ordered
                .filter((item) => item.depth < 2)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {label(item)}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={() => void add()}>
            ساختن
          </button>
        </div>
        <p className="hint-cell">
          دسته‌یِ تازه بی‌کالا هم می‌تواند ساخته شود — در منویِ خریدار نمی‌آید تا
          کالایی در خودش یا زیردسته‌هایش باشد.
        </p>
      </div>

      {/* ── درخت ─────────────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="card__title">درختِ دسته‌ها ({items.length})</h3>
        {items.length === 0 ? (
          <p className="empty">هنوز دسته‌ای نیست.</p>
        ) : (
          <div className="stack u-gap-1" >
            {ordered.map((item) => (
              <div
                className={`ctree__row ${item.isActive ? '' : 'ctree__off'}`}
                key={item.id}
                style={{ paddingInlineStart: `${0.6 + item.depth * 1.6}rem` }}
              >
                {editing === item.id ? (
                  <>
                    <input
                      className="field__input u-max-w-18rem"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                    <button className="btn btn--xs" disabled={busy} onClick={() => void saveName(item.id)}>
                      ذخیره
                    </button>
                    <button className="btn btn--xs btn--ghost" onClick={() => setEditing(null)}>
                      انصراف
                    </button>
                  </>
                ) : (
                  <>
                    <span className="ctree__name">{item.name}</span>
                    <span className="ctree__slug">/c/{item.slug}</span>
                    <span className="ctree__counts">
                      {faDigits(item.ownCount)} کالا
                      {item.totalCount !== item.ownCount ? ` · با زیرشاخه ${faDigits(item.totalCount)}` : ''}
                    </span>

                    <span className="row-actions">
                      <button
                        className="btn btn--xs btn--ghost"
                        onClick={() => {
                          setEditing(item.id);
                          setEditName(item.name);
                        }}
                      >
                        تغییرِ نام
                      </button>
                      <button
                        className="btn btn--xs btn--ghost"
                        onClick={() => {
                          setMoveFor(item.id);
                          setMoveTarget('');
                        }}
                      >
                        جابه‌جایی
                      </button>
                      <button
                        className="btn btn--xs btn--ghost"
                        disabled={busy}
                        onClick={async () => {
                          const result = await toggleCategoryActive(item.id, !item.isActive);
                          if (result.ok) {
                            setStatus({ tone: 'ok', text: result.data.message });
                            await reload();
                          } else setStatus({ tone: 'bad', text: result.message });
                        }}
                      >
                        {item.isActive ? 'پنهان کن' : 'نمایان کن'}
                      </button>
                      <button
                        className="btn btn--xs btn--danger"
                        onClick={() => setDeleteFor(item)}
                      >
                        حذف
                      </button>
                    </span>
                  </>
                )}

                {moveFor === item.id ? (
                  <div className="stack stack-sm" >
                    <label className="field">
                      <span className="field__label">مقصدِ تازه</span>
                      <select
                        className="field__input"
                        value={moveTarget}
                        onChange={(event) => setMoveTarget(event.target.value)}
                      >
                        <option value="">— ریشه (بالاترین سطح) —</option>
                        {moveOptions(item.id)
                          .filter((candidate) => candidate.depth < 2)
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {label(candidate)}
                            </option>
                          ))}
                      </select>
                      <span className="field__help">
                        فرزندانِ این دسته در آبشار نمی‌آیند — جابه‌جایی به زیرِ فرزند، چرخه
                        می‌سازد و پایگاه آن را نمی‌پذیرد.
                      </span>
                    </label>
                    <div className="actions">
                      <button className="btn btn--sm" disabled={busy} onClick={() => void doMove(item.id)}>
                        جابه‌جا کن
                      </button>
                      <button className="btn btn--sm btn--ghost" onClick={() => setMoveFor(null)}>
                        انصراف
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── گفت‌وگویِ حذف ─────────────────────────────────────────────── */}
      {deleteFor ? (
        <div className="card">
          <h3 className="card__title">حذفِ «{deleteFor.name}»</h3>
          {deleteFor.ownCount > 0 ? (
            <label className="field">
              <span className="field__label">
                این دسته {faDigits(deleteFor.ownCount)} کالا دارد — به کدام دسته منتقل شوند؟
              </span>
              <select
                className="field__input"
                value={moveProductsTo}
                onChange={(event) => setMoveProductsTo(event.target.value)}
              >
                <option value="">— انتخاب نکرده‌ام —</option>
                {ordered
                  .filter((candidate) => candidate.id !== deleteFor.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {label(candidate)}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <p className="hint-cell">این دسته کالایی ندارد.</p>
          )}

          {items.some((candidate) => candidate.parentId === deleteFor.id) ? (
            <label className="field">
              <span className="field__label">زیردسته‌هایش به کدام دسته بروند؟</span>
              <select
                className="field__input"
                value={moveChildrenTo}
                onChange={(event) => setMoveChildrenTo(event.target.value)}
              >
                <option value="">— انتخاب نکرده‌ام —</option>
                {ordered
                  .filter((candidate) => candidate.id !== deleteFor.id && candidate.parentId !== deleteFor.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {label(candidate)}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}

          <div className="actions">
            <button className="btn btn--danger" disabled={busy} onClick={() => void doDelete()}>
              حذف
            </button>
            <button className="btn btn--ghost" onClick={() => setDeleteFor(null)}>
              انصراف
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
