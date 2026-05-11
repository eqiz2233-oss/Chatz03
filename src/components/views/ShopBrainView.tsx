import { useEffect, useState } from 'react';
import { I } from '../Icons';

export interface ProductOptionGroup {
  label: string;
  values: string[];
}

interface Product {
  id: string;
  name: string;
  price: number;
  optionGroups: ProductOptionGroup[];
  description: string;
  sellingPoints: string;
  stock?: number;
  imageEmoji: string;
  aiReady: boolean;
}

/** แม่แบบสินค้า — user สร้างเองแทนการ preset แบบตายตัว */
export interface ProductTemplate {
  id: string;
  name: string;
  emoji: string;
  optionGroups: ProductOptionGroup[];
}

const TEMPLATE_EMOJI_OPTIONS = ['👕', '👖', '👗', '🧢', '👜', '👟', '🧴', '💄', '🍱', '🍩', '☕', '🥤', '🔋', '🎧', '📱', '💻', '🪑', '🏠', '🐶', '📦'];

const TEMPLATES_STORAGE_KEY = 'chatz-product-templates-v1';

/** Push the entire product list to the server. Used after add/edit/delete so
 *  catalog persists across devices and survives container restarts. */
async function syncProductToServer(p: Product) {
  try {
    await fetch('/api/products', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: p }),
    });
  } catch {
    /* offline ok — local list still has it */
  }
}

async function deleteProductOnServer(id: string) {
  try {
    await fetch(`/api/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    /* ignore */
  }
}

async function fetchServerProducts(): Promise<Product[] | null> {
  try {
    const r = await fetch('/api/products', { credentials: 'include' });
    if (!r.ok) return null;
    const j = (await r.json()) as { items: Product[] };
    return Array.isArray(j.items) ? j.items : null;
  } catch {
    return null;
  }
}

function loadTemplates(): ProductTemplate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is ProductTemplate =>
          t &&
          typeof t.id === 'string' &&
          typeof t.name === 'string' &&
          typeof t.emoji === 'string' &&
          Array.isArray(t.optionGroups),
      )
      .map((t) => ({
        ...t,
        optionGroups: t.optionGroups
          .filter((g) => g && typeof g.label === 'string' && Array.isArray(g.values))
          .map((g) => ({ label: g.label, values: g.values.filter((v) => typeof v === 'string') })),
      }));
  } catch {
    return [];
  }
}

function persistTemplates(list: ProductTemplate[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — silently ignore */
  }
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

/** จำนวนรายการสินค้าสูงสุดต่อร้าน (โควต้า UI) */
const SHOP_PRODUCT_SLOT_LIMIT = 50;

interface OptionGroupFormRow {
  id: string;
  label: string;
  valuesInput: string;
}

interface FormState {
  name: string;
  price: string;
  optionGroups: OptionGroupFormRow[];
  description: string;
  sellingPoints: string;
  stock: string;
}

const emptyOptionRow = (): OptionGroupFormRow => ({ id: newId('og'), label: '', valuesInput: '' });

function productToFormState(p: Product): FormState {
  const ogs =
    p.optionGroups.length > 0
      ? p.optionGroups.map((g) => ({
          id: newId('og'),
          label: g.label,
          valuesInput: g.values.join(', '),
        }))
      : [emptyOptionRow()];
  return {
    name: p.name,
    price: String(p.price),
    optionGroups: ogs,
    description: p.description,
    sellingPoints: p.sellingPoints,
    stock: p.stock != null ? String(p.stock) : '',
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
};

function formatOptionSummary(groups: ProductOptionGroup[]): string {
  return groups.map((g) => `${g.label}: ${g.values.join(' ')}`).join(' · ');
}

type ShopMode = 'list' | 'add' | 'edit' | 'templates';

export function ShopBrainView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [mode, setMode] = useState<ShopMode>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [templates, setTemplates] = useState<ProductTemplate[]>(loadTemplates);

  useEffect(() => {
    persistTemplates(templates);
  }, [templates]);

  useEffect(() => {
    persistProducts(products);
  }, [products]);

  // On mount, hydrate from server. Server is source of truth — localStorage is
  // just a fast path for instant render. If server has data, replace local.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const remote = await fetchServerProducts();
      if (!cancelled && remote && remote.length > 0) {
        setProducts(remote);
      } else if (!cancelled && remote && remote.length === 0 && products.length > 0) {
        // First-time migration: push existing localStorage catalog to the server.
        for (const p of products) await syncProductToServer(p);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const saveCurrentAsTemplate = (name: string, emoji: string) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const optionGroups: ProductOptionGroup[] = form.optionGroups
      .map((g) => ({ label: g.label.trim(), values: parseValuesInput(g.valuesInput) }))
      .filter((g) => g.label && g.values.length > 0);
    if (optionGroups.length === 0) return;
    setTemplates((prev) => [
      ...prev,
      { id: newId('tpl'), name: cleanName, emoji: emoji || '📦', optionGroups },
    ]);
  };

  const updateTemplate = (id: string, patch: Partial<Omit<ProductTemplate, 'id'>>) =>
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const deleteTemplate = (id: string) => setTemplates((prev) => prev.filter((t) => t.id !== id));

  const slotsRemaining = Math.max(0, SHOP_PRODUCT_SLOT_LIMIT - products.length);
  const canAddProduct = slotsRemaining > 0;

  const handleSave = () => {
    const body = buildProductBody(form);
    if (!body) return;

    if (editingId) {
      let updated: Product | null = null;
      setProducts((list) =>
        list.map((p) => {
          if (p.id !== editingId) return p;
          updated = { ...body, id: editingId, imageEmoji: p.imageEmoji };
          return updated;
        }),
      );
      if (updated) void syncProductToServer(updated);
    } else {
      if (products.length >= SHOP_PRODUCT_SLOT_LIMIT) return;
      const fresh: Product = {
        ...body,
        id: 'p' + Date.now(),
        imageEmoji: '📦',
      };
      setProducts((prev) => [...prev, fresh]);
      void syncProductToServer(fresh);
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
    void deleteProductOnServer(id);
  };

  if (mode === 'templates') {
    return (
      <TemplatesView
        templates={templates}
        onCreate={(name, emoji, optionGroups) =>
          setTemplates((prev) => [...prev, { id: newId('tpl'), name, emoji, optionGroups }])
        }
        onUpdate={updateTemplate}
        onDelete={deleteTemplate}
        onBack={() => setMode(editingId !== null || form.name || form.price ? 'add' : 'list')}
      />
    );
  }

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
        onSaveAsTemplate={saveCurrentAsTemplate}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">ร้านของฉัน</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('templates')}
              className="btn-secondary text-sm"
              title="จัดการแม่แบบสินค้า"
            >
              📋 แม่แบบ
              {templates.length > 0 && (
                <span className="ml-1 rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                  {templates.length}
                </span>
              )}
            </button>
            <button onClick={openAdd} disabled={!canAddProduct} className="btn-primary gap-2 disabled:cursor-not-allowed disabled:opacity-40">
              <I.Plus className="h-4 w-4" />
              เพิ่มสินค้า
            </button>
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
  const heading = n.trim() ? `${n} ${title}` : title;
  return (
    <div className="border-b border-slate-100 pb-2 dark:border-slate-800">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {heading}
      </div>
      {sub && (
        <p className="mt-1 whitespace-pre-line text-xs text-slate-500 dark:text-slate-400">{sub}</p>
      )}
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
  onSaveAsTemplate,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  isEdit: boolean;
  onSave: () => void;
  onBack: () => void;
  slotsRemaining: number;
  slotLimit: number;
  usedSlots: number;
  onSaveAsTemplate: (name: string, emoji: string) => void;
}) {
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplDraftName, setTplDraftName] = useState('');
  const [tplDraftEmoji, setTplDraftEmoji] = useState('👕');

  const optionsHaveContent = form.optionGroups.some(
    (g) => g.label.trim() && parseValuesInput(g.valuesInput).length > 0,
  );

  const closeSaveTpl = () => {
    setSaveTplOpen(false);
    setTplDraftName('');
    setTplDraftEmoji('👕');
  };

  const submitSaveTpl = () => {
    if (!tplDraftName.trim() || !optionsHaveContent) return;
    onSaveAsTemplate(tplDraftName, tplDraftEmoji);
    closeSaveTpl();
  };

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
        <div className="w-full space-y-6">
          {/* ข้อมูลสินค้า */}
          <section className="space-y-4">
            <SectionTitle n="" title="ข้อมูลสินค้า" />
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
              n=""
              title="มีแบบไหนให้ลูกค้าเลือกบ้าง? (ถ้ามี)"
              sub={'พิมพ์เองได้ทั้งหมด เช่น\n\nสี\nน้ำหนัก\nรสชาติ\nความจุ'}
            />
            <div className="grid gap-3 lg:grid-cols-2">
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
                  <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">ประเภทตัวเลือก (พิมพ์เอง)</label>
                  <input
                    value={g.label}
                    onChange={(e) => updateOptionRow(g.id, { label: e.target.value })}
                    placeholder="เช่น สี, น้ำหนัก, รสชาติ, ความจุ"
                    className={'mb-2 ' + inputClass}
                  />
                  <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">ค่าที่ลูกค้าเลือกได้ (พิมพ์เอง)</label>
                  <input
                    value={g.valuesInput}
                    onChange={(e) => updateOptionRow(g.id, { valuesInput: e.target.value })}
                    placeholder="เช่น ดำ, ขาว, เทา หรือ 250g, 500g"
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={addOptionRow} className="btn-secondary flex-1 text-xs">
                <I.Plus className="h-3.5 w-3.5" />
                เพิ่มตัวเลือก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!optionsHaveContent) return;
                  setSaveTplOpen(true);
                }}
                disabled={!optionsHaveContent}
                title={optionsHaveContent ? 'บันทึกชุดตัวเลือกนี้เป็นแม่แบบเพื่อใช้ซ้ำ' : 'กรอกชื่อตัวเลือกและค่าก่อน'}
                className="btn-secondary flex-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                💾 บันทึกเป็นแม่แบบ
              </button>
            </div>
            {saveTplOpen && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-800 dark:bg-brand-950/40">
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">ตั้งชื่อแม่แบบ</label>
                <input
                  autoFocus
                  value={tplDraftName}
                  onChange={(e) => setTplDraftName(e.target.value)}
                  placeholder="เช่น เสื้อยืดของฉัน"
                  className={'mb-2 ' + inputClass}
                />
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">เลือกไอคอน</label>
                <div className="mb-3 flex flex-wrap gap-1">
                  {TEMPLATE_EMOJI_OPTIONS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setTplDraftEmoji(em)}
                      className={
                        'grid h-8 w-8 place-items-center rounded-lg border text-lg transition ' +
                        (tplDraftEmoji === em
                          ? 'border-brand-400 bg-white ring-2 ring-brand-200 dark:border-brand-500 dark:bg-slate-800 dark:ring-brand-900'
                          : 'border-slate-200 bg-white hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900')
                      }
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={closeSaveTpl} className="btn-secondary text-xs">
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={submitSaveTpl}
                    disabled={!tplDraftName.trim()}
                    className="btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    บันทึก
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* รายละเอียดสินค้า */}
          <section className="space-y-2">
            <SectionTitle
              n=""
              title="รายละเอียดสินค้า"
              sub={'อธิบายสั้นๆ ให้ลูกค้ารู้ว่าสินค้าคืออะไร\n\nตัวอย่าง:\n\nผ้านุ่ม ใส่สบาย ระบายอากาศดี'}
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="เช่น ผ้านุ่ม ใส่สบาย ระบายอากาศดี"
              rows={3}
              className={'resize-none ' + inputClass}
            />
          </section>

          {/* จุดเด่นสินค้า */}
          <section className="space-y-2">
            <SectionTitle
              n=""
              title="จุดเด่นสินค้า"
              sub={'อะไรที่ทำให้ลูกค้าอยากซื้อ?\n\nเช่น:\n\nส่งไว, ผ้านุ่ม, กันน้ำ'}
            />
            <textarea
              value={form.sellingPoints}
              onChange={(e) => setForm((f) => ({ ...f, sellingPoints: e.target.value }))}
              placeholder="เช่น ส่งไว, ผ้านุ่ม, กันน้ำ"
              rows={2}
              className={'resize-none ' + inputClass}
            />
          </section>

          {/* สต๊อก */}
          <section className="space-y-2">
            <SectionTitle n="" title="สต๊อก (ถ้ามี)" sub="จำนวนชิ้น หรือปล่อยว่างได้" />
            <input
              type="number"
              value={form.stock}
              onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
              placeholder="เช่น 120 (ไม่บังคับ)"
              className={inputClass}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

interface TplDraft {
  id: string | null;
  name: string;
  emoji: string;
  optionGroups: OptionGroupFormRow[];
}

const blankTplDraft = (): TplDraft => ({
  id: null,
  name: '',
  emoji: '👕',
  optionGroups: [emptyOptionRow()],
});

function templateToDraft(tpl: ProductTemplate): TplDraft {
  return {
    id: tpl.id,
    name: tpl.name,
    emoji: tpl.emoji,
    optionGroups:
      tpl.optionGroups.length > 0
        ? tpl.optionGroups.map((g) => ({
            id: newId('og'),
            label: g.label,
            valuesInput: g.values.join(', '),
          }))
        : [emptyOptionRow()],
  };
}

function draftToTemplateBody(d: TplDraft): { name: string; emoji: string; optionGroups: ProductOptionGroup[] } | null {
  const name = d.name.trim();
  if (!name) return null;
  const optionGroups = d.optionGroups
    .map((g) => ({ label: g.label.trim(), values: parseValuesInput(g.valuesInput) }))
    .filter((g) => g.label && g.values.length > 0);
  if (optionGroups.length === 0) return null;
  return { name, emoji: d.emoji || '📦', optionGroups };
}

function TemplatesView({
  templates,
  onCreate,
  onUpdate,
  onDelete,
  onBack,
}: {
  templates: ProductTemplate[];
  onCreate: (name: string, emoji: string, optionGroups: ProductOptionGroup[]) => void;
  onUpdate: (id: string, patch: Partial<Omit<ProductTemplate, 'id'>>) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<TplDraft | null>(null);
  const inputClass =
    'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-500 dark:focus:ring-brand-900/40';

  const updateGroup = (id: string, patch: Partial<OptionGroupFormRow>) =>
    setDraft((d) =>
      d ? { ...d, optionGroups: d.optionGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)) } : d,
    );
  const removeGroup = (id: string) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            optionGroups: d.optionGroups.length <= 1 ? d.optionGroups : d.optionGroups.filter((g) => g.id !== id),
          }
        : d,
    );
  const addGroup = () =>
    setDraft((d) => (d ? { ...d, optionGroups: [...d.optionGroups, emptyOptionRow()] } : d));

  const submitDraft = () => {
    if (!draft) return;
    const body = draftToTemplateBody(draft);
    if (!body) return;
    if (draft.id) {
      onUpdate(draft.id, body);
    } else {
      onCreate(body.name, body.emoji, body.optionGroups);
    }
    setDraft(null);
  };

  if (draft) {
    const isEdit = draft.id !== null;
    const valid = Boolean(draftToTemplateBody(draft));
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={() => setDraft(null)} className="btn-ghost -ml-1 p-1.5">
            <I.X className="h-4 w-4" />
          </button>
          <div className="flex-1">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">
              {isEdit ? 'แก้ไขแม่แบบ' : 'สร้างแม่แบบใหม่'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              ตั้งค่าตัวเลือกครั้งเดียว — ใช้ซ้ำกับสินค้าหลายชิ้น
            </div>
          </div>
          <button
            type="button"
            onClick={submitDraft}
            disabled={!valid}
            className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            บันทึก
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="w-full space-y-6">
            <section className="space-y-3">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">ชื่อแม่แบบ</label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="เช่น เสื้อยืดของฉัน, พาวเวอร์แบงก์"
                className={inputClass}
              />
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">ไอคอน</label>
              <div className="flex flex-wrap gap-1">
                {TEMPLATE_EMOJI_OPTIONS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setDraft({ ...draft, emoji: em })}
                    className={
                      'grid h-9 w-9 place-items-center rounded-lg border text-lg transition ' +
                      (draft.emoji === em
                        ? 'border-brand-400 bg-white ring-2 ring-brand-200 dark:border-brand-500 dark:bg-slate-800 dark:ring-brand-900'
                        : 'border-slate-200 bg-white hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900')
                    }
                  >
                    {em}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <SectionTitle
                n=""
                title="ตัวเลือก"
                sub="ตั้งชื่อเองได้ เช่น สี / ไซส์ / ความจุ / ทรง — ค่าแต่ละตัวคั่นด้วยจุลภาคหรือเว้นวรรค"
              />
              <div className="grid gap-3 lg:grid-cols-2">
                {draft.optionGroups.map((g, i) => (
                  <div
                    key={g.id}
                    className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-400">ชุดที่ {i + 1}</span>
                      {draft.optionGroups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeGroup(g.id)}
                          className="text-xs text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                        >
                          ลบชุดนี้
                        </button>
                      )}
                    </div>
                    <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">ชื่อตัวเลือก</label>
                    <input
                      value={g.label}
                      onChange={(e) => updateGroup(g.id, { label: e.target.value })}
                      placeholder="เช่น ทรง, ไซส์, ความจุ"
                      className={'mb-2 ' + inputClass}
                    />
                    <label className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">ตัวเลือกย่อย</label>
                    <input
                      value={g.valuesInput}
                      onChange={(e) => updateGroup(g.id, { valuesInput: e.target.value })}
                      placeholder="เช่น คอปก, คอกลม, คอวี"
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
              <button type="button" onClick={addGroup} className="btn-secondary w-full text-xs">
                <I.Plus className="h-3.5 w-3.5" />
                เพิ่มชุดตัวเลือก
              </button>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3.5 dark:border-slate-800 dark:bg-slate-900">
        <button type="button" onClick={onBack} className="btn-ghost -ml-1 p-1.5">
          <I.X className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">แม่แบบสินค้า</div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            สร้างครั้งเดียว — ใช้ซ้ำได้กับสินค้าทุกชิ้นที่มีโครงสร้างเหมือนกัน
          </div>
        </div>
        <button type="button" onClick={() => setDraft(blankTplDraft())} className="btn-primary text-sm">
          <I.Plus className="h-4 w-4" />
          สร้างใหม่
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="w-full">
          {templates.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
              <div className="text-3xl">📋</div>
              <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">ยังไม่มีแม่แบบ</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                สร้างแม่แบบ เช่น “เสื้อยืดของฉัน” ที่มีตัวเลือก ทรง · ไซส์ · สี
                <br />
                แล้วใช้กดเดียวเวลาเพิ่มสินค้าใหม่
              </p>
              <button
                type="button"
                onClick={() => setDraft(blankTplDraft())}
                className="btn-primary mt-4 text-sm"
              >
                <I.Plus className="h-4 w-4" />
                สร้างแม่แบบแรก
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-50 text-2xl ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
                    {tpl.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100">
                      {tpl.name}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {tpl.optionGroups
                        .map((g) => `${g.label}: ${g.values.join(' ')}`)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-slate-100/90 p-0.5 ring-1 ring-slate-200/80 dark:bg-slate-800/80 dark:ring-slate-600">
                    <button
                      type="button"
                      onClick={() => setDraft(templateToDraft(tpl))}
                      aria-label="แก้ไขแม่แบบ"
                      title="แก้ไข"
                      className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-white hover:text-brand-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-brand-400"
                    >
                      <I.Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`ลบแม่แบบ “${tpl.name}” ใช่หรือไม่?\nสินค้าที่สร้างจากแม่แบบนี้จะไม่ได้รับผลกระทบ`)) {
                          onDelete(tpl.id);
                        }
                      }}
                      aria-label="ลบแม่แบบ"
                      title="ลบ"
                      className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400"
                    >
                      <I.Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
