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
const PRODUCTS_STORAGE_KEY = 'chatz-products-v1';

function loadProducts(): Product[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PRODUCTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Product =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.price === 'number' &&
        Array.isArray(p.optionGroups) &&
        typeof p.description === 'string' &&
        typeof p.sellingPoints === 'string' &&
        typeof p.imageEmoji === 'string' &&
        typeof p.aiReady === 'boolean',
    );
  } catch {
    return [];
  }
}

function persistProducts(list: Product[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — silently ignore */
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

interface ShowcaseProduct {
  id: string;
  family: string;
  name: string;
  subtitle: string;
  fromPrice: number;
  badge?: string;
  tone: string;
}

const SHOWCASE_PRODUCTS: ShowcaseProduct[] = [
  {
    id: 'macbook-neo',
    family: 'Mac',
    name: 'MacBook Neo',
    subtitle: 'เบา พกง่าย แบตอึดสำหรับทำงานทั้งวัน',
    fromPrice: 19900,
    badge: 'NEW',
    tone: 'from-[#f0f7c8] via-[#d6ef7f] to-[#b7df4a]',
  },
  {
    id: 'macbook-air',
    family: 'Mac',
    name: 'MacBook Air',
    subtitle: 'ชิปแรงขึ้น จอสวย พร้อมใช้งานในทุกวัน',
    fromPrice: 36900,
    tone: 'from-[#d7e6f8] via-[#a8c9f2] to-[#7aa9ea]',
  },
  {
    id: 'macbook-pro',
    family: 'Mac',
    name: 'MacBook Pro',
    subtitle: 'ประสิทธิภาพระดับโปรสำหรับงานหนัก',
    fromPrice: 56900,
    tone: 'from-[#2f2f37] via-[#23232b] to-[#16161d]',
  },
  {
    id: 'imac-air',
    family: 'Mac',
    name: 'iMac Air',
    subtitle: 'เดสก์ท็อปดีไซน์บางเฉียบ สีสวยทุกมุม',
    fromPrice: 43900,
    tone: 'from-[#dbe8ff] via-[#c5d9ff] to-[#9fbefd]',
  },
  {
    id: 'mac-mini',
    family: 'Mac',
    name: 'Mac mini',
    subtitle: 'เล็กแต่แรง คุ้มสุดสำหรับเริ่มต้นใช้งาน',
    fromPrice: 22900,
    tone: 'from-[#f1f3f8] via-[#d9dfea] to-[#bfc9db]',
  },
  {
    id: 'studio-pro',
    family: 'Mac',
    name: 'Mac Studio Pro',
    subtitle: 'เครื่องตั้งโต๊ะสำหรับครีเอเตอร์และทีมโปร',
    fromPrice: 74900,
    tone: 'from-[#505566] via-[#383d4e] to-[#222737]',
  },
];

export function ShopBrainView() {
  const [products, setProducts] = useState<Product[]>(loadProducts);
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
  const showcaseFamilies = Array.from(new Set(SHOWCASE_PRODUCTS.map((p) => p.family)));

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
        templates={templates}
        onApplyTemplate={(tpl) =>
          setForm((f) => ({
            ...f,
            optionGroups:
              tpl.optionGroups.length > 0
                ? tpl.optionGroups.map((g) => ({
                    id: newId('og'),
                    label: g.label,
                    valuesInput: g.values.join(', '),
                  }))
                : f.optionGroups,
          }))
        }
        onManageTemplates={() => setMode('templates')}
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
        <div className="space-y-5">
          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2 px-1">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Mac</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">ไอเดียหน้าโชว์สินค้าแบบสั้น กระชับ และอ่านง่าย</p>
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500">
                {showcaseFamilies.join(' · ')} showcase
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SHOWCASE_PRODUCTS.map((item) => (
                <article
                  key={item.id}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-[#f5f5f7] p-4 transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-950/60"
                >
                  {item.badge && (
                    <span className="absolute left-3 top-3 rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white dark:bg-brand-500">
                      {item.badge}
                    </span>
                  )}
                  <div
                    className={
                      'mx-auto mt-5 grid h-28 w-full max-w-[220px] place-items-center rounded-xl bg-gradient-to-br text-[44px] shadow-sm ' +
                      item.tone
                    }
                  >
                    💻
                  </div>
                  <div className="mt-4 text-center">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{item.subtitle}</p>
                    <div className="mt-3 text-xs font-medium text-slate-600 dark:text-slate-300">
                      From ฿{item.fromPrice.toLocaleString()}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {products.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-6 text-center dark:border-slate-600 dark:bg-slate-900">
              <div className="text-2xl">🛍️</div>
              <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">ยังไม่มีสินค้าในร้านของคุณ</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                กดปุ่มเพิ่มสินค้า เพื่อใส่ชื่อสินค้า ราคา และรายละเอียดสั้น ๆ ให้ AI ช่วยขายได้ทันที
              </p>
              <button
                type="button"
                onClick={openAdd}
                disabled={!canAddProduct}
                className="btn-primary mt-4 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <I.Plus className="h-4 w-4" />
                เพิ่มสินค้า
              </button>
            </div>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 px-1">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">สินค้าที่คุณเพิ่มเอง</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">รายการนี้ใช้ข้อมูลจริงของร้านคุณสำหรับตอบแชทลูกค้า</p>
              </div>
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
            </section>
          )}
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

/** Friendly card section — emoji + title + optional sub. Replaces the old numbered list look. */
function ProductCard({
  emoji,
  title,
  sub,
  children,
}: {
  emoji: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
        <div className="flex items-baseline gap-2">
          <span className="text-base leading-none">{emoji}</span>
          <h3 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h3>
        </div>
        {sub && <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{sub}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** Quick-add presets for common variant types. Click → fills the first empty option group. */
const VARIANT_PRESETS: { emoji: string; label: string; values: string[] }[] = [
  { emoji: '🎨', label: 'สี', values: ['ดำ', 'ขาว', 'เทา'] },
  { emoji: '📏', label: 'ไซส์', values: ['S', 'M', 'L', 'XL'] },
  { emoji: '🍓', label: 'รสชาติ', values: [] },
  { emoji: '🥤', label: 'ความจุ', values: [] },
  { emoji: '⚖️', label: 'น้ำหนัก', values: [] },
];

function AddForm({
  form,
  setForm,
  isEdit,
  onSave,
  onBack,
  slotsRemaining,
  slotLimit,
  usedSlots,
  templates,
  onApplyTemplate,
  onManageTemplates,
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
  templates: ProductTemplate[];
  onApplyTemplate: (tpl: ProductTemplate) => void;
  onManageTemplates: () => void;
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

  const totalProgress = [
    Boolean(form.name.trim()),
    Boolean(form.price),
    optionsHaveContent,
    Boolean(form.description.trim()),
    Boolean(form.sellingPoints.trim()),
  ];
  const progressPct = Math.round((totalProgress.filter(Boolean).length / totalProgress.length) * 100);

  const fillEmptyVariant = (label: string, values: string[]) => {
    const empty = form.optionGroups.find((g) => !g.label.trim() && !g.valuesInput.trim());
    if (empty) {
      updateOptionRow(empty.id, { label, valuesInput: values.join(', ') });
    } else {
      setForm((f) => ({
        ...f,
        optionGroups: [...f.optionGroups, { id: newId('og'), label, valuesInput: values.join(', ') }],
      }));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-gradient-to-b from-brand-50/40 via-slate-50 to-slate-50 dark:from-brand-950/20 dark:via-slate-950 dark:to-slate-950">
      {/* ── Sticky header with progress bar ── */}
      <div className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
          <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100" aria-label="ปิด">
            <I.X className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                {isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}
              </h2>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">
                {progressPct}%
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
              {isEdit ? 'แก้แล้วกดบันทึกได้เลย' : 'ใส่ข้อมูล = สอน AI ขายของแทนคุณ 🤖'}
              <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
              <span className={slotsRemaining > 0 ? 'text-slate-500 dark:text-slate-400' : 'font-semibold text-amber-600 dark:text-amber-400'}>
                เหลือ {slotsRemaining}/{slotLimit}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onSave}
            disabled={!hasValidCore || (!isEdit && slotsRemaining <= 0)}
            className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isEdit ? 'บันทึก' : '✨ บันทึก'}
          </button>
        </div>
        <div className="h-1 overflow-hidden bg-slate-100 dark:bg-slate-800">
          <div className="h-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all duration-500" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-xl space-y-4">
          {/* ── Templates: friendly chip strip ── */}
          {templates.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-brand-200/60 bg-gradient-to-br from-brand-50 to-white p-4 dark:border-brand-800/50 dark:from-brand-950/40 dark:to-slate-900">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-brand-700 dark:text-brand-300">
                  ⚡ ใช้แม่แบบเร็ว
                </span>
                <button type="button" onClick={onManageTemplates} className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-300">
                  จัดการ →
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => onApplyTemplate(tpl)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-brand-200/80 transition hover:bg-brand-50 hover:ring-brand-400 dark:bg-slate-800 dark:text-slate-200 dark:ring-brand-800/60 dark:hover:bg-slate-700"
                    title={tpl.optionGroups.map((g) => `${g.label}: ${g.values.join(' ')}`).join(' · ')}
                  >
                    <span>{tpl.emoji}</span>
                    <span>{tpl.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ── 📸 Image ── */}
          <ProductCard emoji="📸" title="รูปสินค้า" sub="ใช้รูปสวย ๆ ลูกค้าจะเห็นรูปนี้ก่อนเสมอ">
            <button
              type="button"
              className="group relative flex h-44 w-full flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-slate-300 bg-gradient-to-br from-slate-50 to-white text-slate-400 transition hover:border-brand-400 hover:from-brand-50/70 hover:to-white hover:text-brand-600 dark:border-slate-700 dark:from-slate-800/40 dark:to-slate-900 dark:hover:border-brand-500 dark:hover:from-brand-950/30 dark:hover:text-brand-400"
            >
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 transition group-hover:ring-brand-300 dark:bg-slate-800 dark:ring-slate-700 dark:group-hover:ring-brand-700">
                <I.Image className="h-5 w-5" />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium">คลิกเลือกรูป หรือลากมาวางที่นี่</div>
                <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">PNG, JPG ขนาดไม่เกิน 5 MB</div>
              </div>
            </button>
          </ProductCard>

          {/* ── ✨ Basic info ── */}
          <ProductCard emoji="✨" title="ข้อมูลหลัก" sub="ชื่อกับราคา — ลูกค้ากับ AI ใช้ทั้งคู่">
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">ชื่อสินค้า</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="เช่น เสื้อ Oversize Cotton"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">ราคาขาย</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">฿</span>
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="350"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-base font-bold tabular-nums text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
                  />
                </div>
              </div>
            </div>
          </ProductCard>

          {/* ── 🎨 Variants ── */}
          <ProductCard emoji="🎨" title="ตัวเลือกสินค้า" sub="ให้ลูกค้าเลือกได้เอง เช่น สี ไซส์ รสชาติ">
            {/* Quick presets */}
            <div className="mb-4 flex flex-wrap gap-1.5">
              <span className="self-center text-[11px] text-slate-400 dark:text-slate-500">เพิ่มเร็ว:</span>
              {VARIANT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => fillEmptyVariant(p.label, p.values)}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-brand-100 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-900/40 dark:hover:text-brand-300"
                >
                  <span>{p.emoji}</span> {p.label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {form.optionGroups.map((g) => {
                const parsed = parseValuesInput(g.valuesInput);
                return (
                  <div key={g.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 transition focus-within:border-brand-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/40 dark:focus-within:border-brand-600 dark:focus-within:bg-slate-900 dark:focus-within:ring-brand-900/40">
                    <div className="mb-2 flex items-center gap-2">
                      <input
                        value={g.label}
                        onChange={(e) => updateOptionRow(g.id, { label: e.target.value })}
                        placeholder="ชื่อตัวเลือก (เช่น สี)"
                        className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 placeholder:font-medium placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                      />
                      {form.optionGroups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeOptionRow(g.id)}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
                          aria-label="ลบ"
                        >
                          <I.X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <input
                      value={g.valuesInput}
                      onChange={(e) => updateOptionRow(g.id, { valuesInput: e.target.value })}
                      placeholder="ค่าตัวเลือก คั่นด้วยลูกน้ำ เช่น ดำ, ขาว, เทา"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-900 dark:focus:border-brand-500 dark:focus:ring-brand-900/30"
                    />
                    {parsed.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {parsed.map((v, idx) => (
                          <span
                            key={idx}
                            className="inline-flex items-center rounded-md bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addOptionRow}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-brand-400 hover:bg-brand-50/50 hover:text-brand-600 dark:border-slate-700 dark:hover:border-brand-500 dark:hover:bg-brand-950/30 dark:hover:text-brand-400"
              >
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
                title={optionsHaveContent ? 'บันทึกชุดตัวเลือกนี้เป็นแม่แบบ' : 'กรอกตัวเลือกก่อน'}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-brand-950/40 dark:text-brand-300 dark:hover:bg-brand-900/50"
              >
                💾 บันทึกเป็นแม่แบบ
              </button>
            </div>

            {saveTplOpen && (
              <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-800 dark:bg-brand-950/40">
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
          </ProductCard>

          {/* ── 📝 Description + selling points ── */}
          <ProductCard emoji="📝" title="อธิบายสินค้า" sub="ให้ AI เล่าให้ลูกค้าฟังได้">
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  คำอธิบาย <span className="font-normal text-slate-400">— สินค้านี้คืออะไร</span>
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="เช่น เสื้อยืดผ้า Cotton 100% ทรงโอเวอร์ไซส์ ใส่สบาย ไม่ร้อน ใส่ได้ทั้งชายและหญิง..."
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                  จุดขาย ✨ <span className="font-normal text-slate-400">— ให้ AI ใช้ตอนปิดการขาย</span>
                </label>
                <textarea
                  value={form.sellingPoints}
                  onChange={(e) => setForm((f) => ({ ...f, sellingPoints: e.target.value }))}
                  placeholder="เช่น ผ้านุ่ม ไม่ยับ, ส่งไว 1-2 วัน, สีไม่ตก, ใส่ออกกำลังกายได้"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
                />
              </div>
            </div>
          </ProductCard>

          {/* ── 📦 Stock ── */}
          <ProductCard emoji="📦" title="สต๊อก" sub="ไม่บังคับ — ใส่ถ้ามีก็ได้">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">จำนวนในสต๊อก</label>
              <div className="relative max-w-[220px]">
                <input
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                  placeholder="120"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 pr-12 text-sm tabular-nums text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:bg-slate-900 dark:focus:ring-brand-900/40"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">ชิ้น</span>
              </div>
            </div>
          </ProductCard>

          {/* Bottom spacing */}
          <div className="h-4" />
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
              <div className="border-b border-slate-100 pb-2 dark:border-slate-800">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  ตัวเลือก
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  ตั้งชื่อเองได้ เช่น สี / ไซส์ / ความจุ / ทรง — ค่าแต่ละตัวคั่นด้วยจุลภาคหรือเว้นวรรค
                </p>
              </div>
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
