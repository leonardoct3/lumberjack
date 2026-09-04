export function DataTable({
  columns,
  rows,
  empty,
}: {
  columns: { key: string; header: React.ReactNode }[];
  rows: { id: string; cells: Record<string, React.ReactNode> }[];
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <table className="data-table data-table--cards">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            {columns.map((c) => (
              <td key={c.key}>
                <span className="data-table__card-label">{c.header}</span>
                {row.cells[c.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
