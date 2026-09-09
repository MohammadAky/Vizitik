import { useEffect, useState } from 'react';

/**
 * اسکلتون‌های داشبورد — همان الگوی js/dashboard.js نسخهٔ PHP:
 * المان هنگام لود خالی و با کلاس‌های skeleton-text + سایز (sm/md/lg) یا
 * skeleton-badge رندر می‌شود، مقدار واقعی در data-value می‌ماند و بعد از
 * ۷۰۰ms مقدار (به‌همراه <small> پسونج) جایگزین و کلاس‌های اسکلتون حذف،
 * و کلاس skeleton-done اضافه می‌شود.
 */
export function useSkeleton(deps = []) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    const t = setTimeout(() => setDone(true), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return done;
}

/**
 * @param {boolean} done  آیا داده پر شده است؟
 * @param {string} size   sm | md | lg
 * @param {string} kind   text | badge
 */
export function Skel({ done, size = 'md', kind = 'text', value, suffix, tag = 'span', className = '' }) {
  const loading = !done;
  const cls = [
    className,
    loading ? (kind === 'badge' ? 'skeleton-badge' : `skeleton-text skeleton-${size}`) : 'skeleton-done'
  ]
    .filter(Boolean)
    .join(' ');
  const Tag = tag;
  return (
    <Tag className={cls} data-value={value ?? ''}>
      {loading ? null : suffix ? (
        <>
          {value} <small>{suffix}</small>
        </>
      ) : (
        value
      )}
    </Tag>
  );
}
