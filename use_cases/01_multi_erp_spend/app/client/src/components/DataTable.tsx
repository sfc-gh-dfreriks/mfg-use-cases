interface Column {
  key: string;
  label: string;
  format?: (v: any) => string;
}

interface DataTableProps {
  columns: Column[];
  data: Record<string, any>[];
}

export default function DataTable({ columns, data }: DataTableProps) {
  if (!data || data.length === 0) {
    return <p className="py-4 text-center text-sm text-gray-400">No data available</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-sf-dark text-white">
            {columns.map((col) => (
              <th key={col.key} className="px-4 py-2.5 text-left font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className={i % 2 === 0 ? 'bg-white' : 'bg-sky-50/50'}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-2 text-gray-700">
                  {col.format ? col.format(row[col.key]) : String(row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
