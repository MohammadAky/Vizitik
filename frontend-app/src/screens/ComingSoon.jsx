export default function ComingSoon({ title }) {
  return (
    <>
      <header className="topbar"><h1>{title}</h1></header>
      <div className="content">
        <div className="placeholder">
          بخش «{title}» در ادامهٔ پورتِ آفلاین روی همین معماری اضافه می‌شود.
        </div>
      </div>
    </>
  );
}
