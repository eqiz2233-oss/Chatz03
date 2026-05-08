import { useState } from 'react';
import { I } from '../Icons';

export interface ProductOptionGroup {
  label: string;
  values: string[];
}

export interface ProductCustomField {
  key: string;
  value: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  optionGroups: ProductOptionGroup[];
  description: string;
  sellingPoints: string;
  stock?: number;
  customFields: ProductCustomField[];
  imageEmoji: string;
  aiReady: boolean;
}

function parseValuesInput(raw: string): string[] {
  return raw
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const SEED: Product[] = [
  {
    id: 'p1',
    name: 'เสื้อ Oversize Cotton',
    price: 350,
    optionGroups: [
      { label: 'สี', values: ['ดำ', 'ขาว', 'เทา'] },
      { label: 'ไซส์', values: ['S', 'M', 'L', 'XL'] },
    ],
    description: 'ผ้า Cotton 100% นุ่ม ระบายอากาศดี ทรง Oversize ใส่สบาย',
    sellingPoints: 'Cotton 100%, ซักง่ายไม่ยับ, มีหลายสี',
    stock: 48,
    customFields: [{ key: 'วัสดุ', value: 'Cotton 100%' }],
    imageEmoji: '👕',
    aiReady: true,
  },
  {
    id: 'p2',
    name: 'Glow Serum SPF50+',
    price: 590,
    optionGroups: [{ label: 'ความจุ', values: ['30ml', '50ml'] }],
    description: 'เซรั่มบำรุงผิว ผสม SPF50+ กันแดดในตัว ซึมเร็ว ไม่มัน',
    sellingPoints: 'SPF50+, ไม่มัน, ซึมเร็ว, ไม่ทิ้งคราบขาว',
    stock: 23,
    customFields: [],
    imageEmoji: '🧴',
    aiReady: true,
  },
  {
    id: 'p3',
    name: 'กระเป๋า Canvas Tote',
    price: 280,
    optionGroups: [{ label: 'สี', values: ['ครีม', 'เขียว'] }],
    description: '',
    sellingPoints: '',
    stock: undefined,
    customFields: [],
    imageEmoji: '👜',
    aiReady: false,
  },
  {
    id: 'p4',
    name: 'หมวก Bucket ผ้าฝ้าย',
    price: 190,
    optionGroups: [
      { label: 'สี', values: ['ดำ', 'กรม'] },
      { label: 'ไซส์', values: ['Free Size'] },
    ],
    description: '',
    sellingPoints: '',
    stock: undefined,
    customFields: [],
    imageEmoji: '🪣',
    aiReady: false,
  },
];

/** จำนวนรายการสินค้าสูงสุดต่อร้าน (โควต้า UI) */
const SHOP_PRODUCT_SLOT_LIMIT = 50;

interface OptionGroupFormRow {
  id: string;
  label: string;
  valuesInput: string;
}

interface CustomFieldFormRow {
  id: string;
  key: string;
  value: string;
}

interface FormState {
  name: string;
  price: string;
  optionGroups: OptionGroupFormRow[];
  description: string;
  sellingPoints: string;
  stock: string;
  customFields: CustomFieldFormRow[];
}

const emptyOptionRow = (): OptionGroupFormRow => ({ id: newId('og'), label: '', valuesInput: '' });
const emptyCustomRow = (): CustomFieldFormRow => ({ id: newId('cf'), key: '', value: '' });

function productToFormState(p: Product): FormState {
  const ogs =
    p.optionGroups.length > 0
      ? p.optionGroups.map((g) => ({
          id: newId('og'),
          label: g.label,
          valuesInput: g.values.join(', '),
        }))
      : [emptyOptionRow()];
  const cfs = p.customFields.map((c) => ({
    id: newId('cf'),
    key: c.key,
    value: c.value,
  }));
  return {
    name: p.name,
    price: String(p.price),
    optionGroups: ogs,
    description: p.description,
    sellingPoints: p.sellingPoints,
    stock: p.stock != null ? String(p.stock) : '',
    customFields: cfs,
  };
}

/** ร่างสินค้าจากฟอร์ม (ยังไม่มี id / emoji สำหรับสร้างใหม่) */
function buildProductBody(form: FormState): Omit<Product, 'id' | 'imageEmoji'> | null {
  if (!form.name.trim() || !form.price) return null;

  const optionGroups: ProductOptionGroup[] = form.optionGroups
    .map((g) => ({
      label: g.label.trim(),
      values: parseValuesInput(g.valuesInput),
    }))
    .filter((g) => g.label && g.values.length > 0);

  const customFields: ProductCustomField[] = form.customFields
    .map((r) => ({ key: r.key.trim(), value: r.value.trim() }))
    .filter((r) => r.key);

  const isReady = Boolean(
    form.name.trim() &&
    form.price &&
    optionGroups.length > 0 &&
    form.description.trim() &&
    form.sellingPoints.trim(),
  );

  return {
    name: form.name.trim(),
    price: Number(form.price),
    optionGroups,
    description: form.description.trim(),
    sellingPoints: form.sellingPoints.trim(),
    stock: form.stock.trim() ? Number(form.stock) : undefined,
    customFields,
    aiReady: isReady,
  };
}

const BLANK: FormState = {
  name: '',
  price: '',
  optionGroups: [emptyOptionRow()],
  description: '',
  sellingPoints: '',
  stock: '',
  customFields: [],
};

function formatOptionSummary(groups: ProductOptionGroup[]): string {
  return groups.map((g) => `${g.label}: ${g.values.join(' ')}`).join(' · ');
}

type ShopMode = 'list' | 'add' | 'edit';

export function ShopBrainView() {
  const [products, setProducts] = useState<Product[]>(SEED);
  const [mode, setMode] = useState<ShopMode>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);

  const aiReady = products.filter((p) => p.aiReady).length;
  const pct = products.length === 0 ? 0 : Math.round((aiReady / products.length) * 100);
  const slotsRemaining = Math.max(0, SHOP_PRODUCT_SLOT_LIMIT - products.length);
  const canAddProduct = slotsRemaining > 0;

  const handleSave = () => {
    const body = buildProductBody(form);
    if (!body) return;

    if (editingId) {
      setProducts((list) =>
        list.map((p) =>
          p.id === editingId
            ? {
                ...body,
                id: editingId,
                imageEmoji: p.imageEmoji,
              }
            : p,
        ),
      );
    } else {
      if (products.length >= SHOP_PRODUCT_SLOT_LIMIT) return;
      setProducts((prev) => [
        ...prev,
        {
          ...body,
          id: 'p' + Date.now(),
          imageEmoji: '📦',
        },
      ]);
    }
    setForm(BLANK);
    setEditingId(null);
    setMode('list');
  };

  const openAdd = () => {
    if (!canAddProduct) return;
    setEditingId(null);
    setForm(BLANK);
    setMode('add');
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setForm(productToFormState(p));
    setMode('edit');
  };

  const confirmDelete = (id: string, name: string) => {
    const ok = window.confirm(`ลบสินค้า “${name}” ใช่หรือไม่?\nการลบจะทำทันทีและย้อนกลับไม่ได้`);
    if (!ok) return;
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  if (mode === 'add' || mode === 'edit') {
    return (
      <AddForm
        form={form}
        setForm={setForm}
        isEdit={mode === 'edit'}
        onSave={handleSave}
        onBack={() => {
          setForm(BLANK);
          setEditingId(null);
          setMode('list');
        }}
        slotsRemaining={slotsRemaining}
        slotLimit={SHOP_PRODUCT_SLOT_LIMIT}
        usedSlots={products.length}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">ร้านของฉัน</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ใส่สินค้า = สอนบอทขายของ — AI รู้จัก{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {aiReady}/{products.length} ชิ้น
              </span>
              <span className="text-slate-400 dark:text-slate-500"> · </span>
              <span className={canAddProduct ? 'text-slate-600 dark:text-slate-300' : 'font-semibold text-amber-600 dark:text-amber-400'}>
                เพิ่มสินค้าได้อีก {slotsRemaining} ชิ้น ({products.length}/{SHOP_PRODUCT_SLOT_LIMIT})
              </span>
            </p>
          </div>
          <button onClick={openAdd} disabled={!canAddProduct} className="btn-primary gap-2 disabled:cursor-not-allowed disabled:opacity-40">
            <I.Plus className="h-4 w-4" />
            เพิ่มสินค้า
          </button>
        </div>
        <div className="mt-3.5">
          <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-600 dark:text-slate-300">AI ครอบคลุม {pct}%</span>
            {products.length - aiReady > 0 && (
              <span className="text-amber-600 dark:text-amber-400">{products.length - aiReady} ชิ้นยังขาดข้อมูล</span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-brand-500 transition-all duration-700" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-2">
          {products.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              slotsRemaining={slotsRemaining}
              slotLimit={SHOP_PRODUCT_SLOT_LIMIT}
              usedSlots={products.length}
              onEdit={() => openEdit(p)}
              onDelete={() => confirmDelete(p.id, p.name)}
            />
          ))}
          <button
            onClick={openAdd}
            disabled={!canAddProduct}
            className="mt-1 flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 px-5 py-4 text-sm text-slate-400 transition hover:border-brand-300 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:hover:border-brand-600 dark:hover:text-brand-400"
          >
            <I.Plus className="h-4 w-4" />
            เพิ่มสินค้าใหม่ — สอน AI ให้ขายให้คุณ
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductRow({
  product: p,
  slotsRemaining,
  slotLimit,
  usedSlots,
  onEdit,
  onDelete,
}: {
  product: Product;
  slotsRemaining: number;
  slotLimit: number;
  usedSlots: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const optLine = formatOptionSummary(p.optionGroups);
  const customLine = p.customFields.map((c) => `${c.key}: ${c.value}`).join(' · ');

  return (
    <div className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-50 text-2xl ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
        {p.imageEmoji}
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">{p.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">฿{p.price.toLocaleString()}</span>
              {optLine && (
                <>
                  <span className="text-slate-300 dark:text-slate-600" aria-hidden>
                    ·
                  </span>
                  <span className="min-w-0 truncate">{optLine}</span>
                </>
              )}
              {p.stock != null && (
                <>
                  <span className="text-slate-300 dark:text-slate-600" aria-hidden>
                    ·
                  </span>
                  <span>สต๊อก {p.stock}</span>
                </>
              )}
              {customLine && (
                <>
                  <span className="text-slate-300 dark:text-slate-600" aria-hidden>
                    ·
                  </span>
                  <span className="min-w-0 truncate text-slate-400 dark:text-slate-500">{customLine}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-100/90 p-0.5 ring-1 ring-slate-200/80 dark:bg-slate-800/80 dark:ring-slate-600">
            <button
              type="button"
              onClick={onEdit}
              aria-label="แก้ไขสินค้า"
              title="แก้ไข"
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-brand-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-brand-400"
            >
              <I.Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="ลบสินค้า"
              title="ลบ"
              className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400"
            >
              <I.Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
          <span
            className={
              'text-[11px] leading-snug ' +
              (slotsRemaining > 0 ? 'text-slate-500 dark:text-slate-400' : 'font-medium text-amber-600 dark:text-amber-400')
            }
          >
            เพิ่มรายการได้อีก {slotsRemaining} ชิ้น ({usedSlots}/{slotLimit})
          </span>
          {p.aiReady ? (
            <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <I.Check className="h-3 w-3" />
              AI พร้อมตอบ
            </span>
          ) : (
            <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">⚠️ ขาดข้อมูล</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ n, title, sub }: { n: string; title: string; sub?: string }) {
  return (
    <div className="border-b border-slate-100 pb-2 dark:border-slate-800">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {n} {title}
      </div>
      {sub && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

function AddForm({
  form,
  setForm,
  isEdit,
  onSave,
  onBack,
  slotsRemaining,
  slotLimit,
  usedSlots,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  isEdit: boolean;
  onSave: () => void;
  onBack: () => void;
  slotsRemaining: number;
  slotLimit: number;
  usedSlots: number;
}) {
  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-500 dark:focus:ring-brand-900/40';

  const updateOptionRow = (id: string, patch: Partial<OptionGroupFormRow>) =>
    setForm((f) => ({
      ...f,
      optionGroups: f.optionGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));

  const removeOptionRow = (id: string) =>
    setForm((f) => ({
      ...f,
      optionGroups: f.optionGroups.length <= 1 ? f.optionGroups : f.optionGroups.filter((g) => g.id !== id),
    }));

  const addOptionRow = () => setForm((f) => ({ ...f, optionGroups: [...f.optionGroups, emptyOptionRow()] }));

  const updateCustomRow = (id: string, patch: Partial<CustomFieldFormRow>) =>
    setForm((f) => ({
      ...f,
      customFields: f.customFields.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));

  const removeCustomRow = (id: string) => setForm((f) => ({ ...f, customFields: f.customFields.filter((r) => r.id !== id) }));

  const addCustomRow = () => setForm((f) => ({ ...f, customFields: [...f.customFields, emptyCustomRow()] }));

  const hasValidCore =
    form.name.trim() &&
    form.price &&
    form.optionGroups.some((g) => g.label.trim() && parseValuesInput(g.valuesInput).length > 0);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900">
        <button type="button" onClick={onBack} className="btn-ghost -ml-1 p-1.5">
          <I.X className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {isEdit ? 'แก้แล้วกดบันทึก — ข้อมูลจะอัปเดตให้ AI' : 'กรอกข้อมูล = สอน AI ขายของให้คุณ'}
            <span className="text-slate-400 dark:text-slate-500"> · </span>
            <span className={slotsRemaining > 0 ? 'font-medium text-slate-600 dark:text-slate-300' : 'font-semibold text-amber-600 dark:text-amber-400'}>
              เพิ่มได้อีก {slotsRemaining} ชิ้น ({usedSlots}/{slotLimit})
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!hasValidCore || (!isEdit && slotsRemaining <= 0)}
          className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isEdit ? 'บันทึกการแก้ไข' : 'บันทึก'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-lg space-y-6">
          {/* 1 พื้นฐาน */}
          <section className="space-y-4">
            <SectionTitle n="1." title="พื้นฐาน (ต้องมี)" sub="รูป · ชื่อ · ราคา" />
            <button
              type="button"
              className="flex h-28 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-slate-200 bg-white text-sm text-slate-400 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-600 dark:hover:text-brand-400"
            >
              <I.Image className="h-5 w-5" />
              รูปสินค้า — ลากมาวาง หรือคลิกเพื่อเลือก
            </button>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">ชื่อสินค้า</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="เช่น เสื้อ Oversize Cotton"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">ราคา (฿)</label>
                <input
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="350"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* 2 ตัวเลือกสินค้า */}
          <section className="space-y-3">
            <SectionTitle
              n="2."
              title="ตัวเลือกสินค้า (สำคัญ)"
              sub="ตั้งชื่อเองได้ เช่น สี / ไซส์ / ความจุ / ความหวาน — ค่าแต่ละตัวคั่นด้วยจุลภาคหรือเว้นวรรค"
            />
            <div className="space-y-3">
              {form.optionGroups.map((g, i) => (
                <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-400">ชุดที่ {i + 1}</span>
                    {form.optionGroups.length > 1 && (
                      <button type="button" onClick={() => removeOptionRow(g.id)} className="text-xs text-slate-400 hover:text-rose-600 dark:hover:text-rose-400">
                        ลบชุดนี้
                      </button>
                    )}
                  </div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">ชื่อตัวเลือก</label>
                  <input
                    value={g.label}
                    onChange={(e) => updateOptionRow(g.id, { label: e.target.value })}
                    placeholder="เช่น สี, ไซส์, ความจุ"
                    className={'mb-2 ' + inputClass}
                  />
                  <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">ตัวเลือกย่อย</label>
                  <input
                    value={g.valuesInput}
                    onChange={(e) => updateOptionRow(g.id, { valuesInput: e.target.value })}
                    placeholder="เช่น ดำ, ขาว, เทา หรือ S M L XL"
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
            <button type="button" onClick={addOptionRow} className="btn-secondary w-full text-xs">
              <I.Plus className="h-3.5 w-3.5" />
              เพิ่มชุดตัวเลือก
            </button>
          </section>

          {/* 3 คำอธิบาย */}
          <section className="space-y-2">
            <SectionTitle n="3." title="คำอธิบาย" sub="อธิบายสั้นๆ ว่าสินค้าคืออะไร" />
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="สินค้านี้คืออะไร ใช้ยังไง โดดเด่นตรงไหน..."
              rows={3}
              className={'resize-none ' + inputClass}
            />
          </section>

          {/* 4 จุดขาย */}
          <section className="space-y-2">
            <SectionTitle n="4." title="จุดขาย" sub="ให้ AI ใช้ตอน “ขาย” เช่น ผ้านุ่ม / ส่งไว / แบตอึด" />
            <textarea
              value={form.sellingPoints}
              onChange={(e) => setForm((f) => ({ ...f, sellingPoints: e.target.value }))}
              placeholder="หลายข้อคั่นด้วยจุลภาคหรือขึ้นบรรทัดใหม่ได้"
              rows={2}
              className={'resize-none ' + inputClass}
            />
          </section>

          {/* 5 สต๊อก */}
          <section className="space-y-2">
            <SectionTitle n="5." title="สต๊อก (ถ้ามี)" sub="จำนวนชิ้น หรือปล่อยว่างได้" />
            <input
              type="number"
              value={form.stock}
              onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
              placeholder="เช่น 120 (ไม่บังคับ)"
              className={inputClass}
            />
          </section>

          {/* 6 ช่องเพิ่มเอง */}
          <section className="space-y-3">
            <SectionTitle n="6." title="ช่องเพิ่มเอง (ไม่บังคับ)" sub="ข้อมูลเฉพาะสินค้า เช่น วัสดุ, น้ำหนัก, แบตเตอรี่, แคลอรี่" />
            {form.customFields.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500">ยังไม่มีช่องเพิ่มเติม — กดปุ่มด้านล่างเพื่อเพิ่ม</p>
            ) : (
              <div className="space-y-2">
                {form.customFields.map((r) => (
                  <div key={r.id} className="flex gap-2">
                    <input
                      value={r.key}
                      onChange={(e) => updateCustomRow(r.id, { key: e.target.value })}
                      placeholder="ชื่อฟิลด์"
                      className={inputClass + ' flex-1'}
                    />
                    <input
                      value={r.value}
                      onChange={(e) => updateCustomRow(r.id, { value: e.target.value })}
                      placeholder="ค่า"
                      className={inputClass + ' flex-1'}
                    />
                    <button type="button" onClick={() => removeCustomRow(r.id)} className="btn-ghost shrink-0 px-2 text-slate-400 hover:text-rose-600" aria-label="ลบแถว">
                      <I.X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={addCustomRow} className="btn-secondary w-full text-xs">
              <I.Plus className="h-3.5 w-3.5" />
              เพิ่มช่อง
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
