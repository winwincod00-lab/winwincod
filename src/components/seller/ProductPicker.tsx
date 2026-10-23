import ProductThumbnail from './ProductThumbnail';
export type PickerProduct = { productId: string; productName: string; productImage?: string; sku?: string };
// Native details + grouped radio buttons preserve keyboard and screen reader
// behavior without emulating an ARIA combobox. Selection logic stays with parent.
export default function ProductPicker({ products, value, onChange, name, label, placeholder, error }: {
  products: PickerProduct[]; value: string; onChange: (id: string) => void; name: string; label: string; placeholder: string; error?: string;
}) {
  const selected = products.find(product => product.productId === value);
  return <div><span id={name + '-label'} className="mb-2 block text-xs font-bold text-slate-600">{label}</span>
    <details className="group relative rounded-xl border border-slate-200 bg-white open:ring-2 open:ring-blue-100">
      <summary aria-labelledby={name + '-label ' + name + '-selected'} aria-describedby={error ? name + '-error' : undefined} className="flex min-h-16 cursor-pointer list-none items-center gap-3 p-3 focus-visible:outline-2 focus-visible:outline-blue-700">
        <ProductThumbnail src={selected?.productImage} name={selected?.productName ?? placeholder} />
        <span className="min-w-0 flex-1"><span id={name + '-selected'} className="block truncate text-sm font-semibold">{selected?.productName ?? placeholder}</span>{selected?.sku && <span className="block text-xs text-slate-500" dir="auto">{selected.sku}</span>}</span>
        <span aria-hidden="true" className="text-slate-400">⌄</span>
      </summary>
      <fieldset aria-labelledby={name + '-label'} className="max-h-64 space-y-1 overflow-y-auto border-t border-slate-100 p-2">
        {products.map(product => <label key={product.productId} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-blue-50 focus-within:ring-2 focus-within:ring-blue-600">
          <input type="radio" name={name} value={product.productId} checked={product.productId === value} onChange={event => {
            onChange(product.productId);
            const details = event.currentTarget.closest('details');
            if (details) { details.open = false; details.querySelector('summary')?.focus(); }
          }} className="size-4 shrink-0 accent-blue-600" />
          <ProductThumbnail src={product.productImage} name={product.productName} />
          <span className="min-w-0 text-sm"><span className="block break-words font-medium">{product.productName}</span>{product.sku && <span className="block text-xs text-slate-500" dir="auto">{product.sku}</span>}</span>
        </label>)}
      </fieldset>
    </details>{error && <p id={name + '-error'} className="mt-1 text-xs text-red-700">{error}</p>}
  </div>;
}
