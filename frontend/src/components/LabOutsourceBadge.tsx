// 外注に出す検査項目の印。外注先の名称はツールチップで見せる。院内の項目には何も出さない。
export function LabOutsourceBadge({ organizations }: { organizations: { id: string; name: string }[] }) {
  if (organizations.length === 0) return null;
  const names = organizations.map((organization) => organization.name).filter(Boolean);
  return (
    <span className="dose-conversion__badge" title={names.join("・") || undefined}>
      外注
    </span>
  );
}
