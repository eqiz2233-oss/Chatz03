import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { I } from '../Icons';
import { compressImage } from '../../lib/imageCompress';

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
  /** Data URL or remote URL from user upload */
  imageUrl?: string;
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

function persistProducts(list: Product[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota / private mode — silently ignore */
  }
}

function loadProducts(): Product[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PRODUCTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Product[]) : [];
  } catch {
    return [];
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
  /** Data URL from file picker / drag-drop */
  imageUrl: string;
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
    imageUrl: p.imageUrl ?? '',
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
  imageUrl: '',
};

/** ตัวอย่างสำหรับดู mockup หน้าร้าน — ไม่ sync ขึ้น server จนกว่าจะกดบันทึก */
const SEED_DEMO_PRODUCTS: Product[] = [
  {
    id: 'demo-p1',
    name: 'เสื้อ Oversize Cotton',
    price: 350,
    imageEmoji: '👕',
    imageUrl: 'https://picsum.photos/seed/chatz-shop-1/400/400',
    description: 'ผ้าฝ้าย 100% นุ่ม ระบายอากาศดี ใส่สบายทุกวัน',
    sellingPoints: 'ไม่ย้ว ไม่หด · ซักเครื่องได้ · คละสีได้',
    stock: 48,
    optionGroups: [
      { label: 'สี', values: ['ดำ', 'ขาว', 'เทา', 'กรม'] },
      { label: 'ไซส์', values: ['S', 'M', 'L', 'XL'] },
    ],
    aiReady: true,
  },
  {
    id: 'demo-p2',
    name: 'กางเกงขายาว Unisex',
    price: 590,
    imageEmoji: '👖',
    imageUrl: 'https://picsum.photos/seed/chatz-shop-2/400/400',
    description: 'ทรงสบาย เอวยางยืด ใส่ได้ทั้งชายหญิง',
    sellingPoints: 'ผ้าแห้งเร็ว · มีกระเป๋า 2 ข้าง',
    stock: 22,
    optionGroups: [{ label: 'ไซส์', values: ['28', '30', '32', '34'] }],
    aiReady: true,
  },
  {
    id: 'demo-p3',
    name: 'รองเท้าผ้าใบ Everyday',
    price: 1290,
    imageEmoji: '👟',
    imageUrl: 'https://picsum.photos/seed/chatz-shop-3/400/400',
    description: 'น้ำหนักเบา พื้นกันลื่น เดินสบาย',
    sellingPoints: 'รองรับแรงกระแทก · ใส่ทำงานได้',
    stock: 15,
    optionGroups: [{ label: 'ไซส์', values: ['38', '39', '40', '41', '42'] }],
    aiReady: true,
  },
  {
    id: 'demo-p4',
    name: 'กระเป๋าสะพาย Canvas',
    price: 450,
    imageEmoji: '👜',
    imageUrl: 'https://picsum.photos/seed/chatz-shop-4/400/400',
    description: 'ผ้าแคนวาส ทนทาน สายสะพายปรับได้',
    sellingPoints: 'ใส่โน้ตบุ๊ก 13 นิ้วได้ · มีซิปภายใน',
    stock: 12,
    optionGroups: [{ label: 'สี', values: ['ครีม', 'น้ำตาล', 'ดำ'] }],
    aiReady: false,
  },
  {
    id: 'demo-p5',
    name: 'หมวกแก๊ป Minimal',
    price: 290,
    imageEmoji: '🧢',
    imageUrl: 'https://picsum.photos/seed/chatz-shop-5/400/400',
    description: 'ทรงเรียบ ปีกหมวกโค้ง ปรับขนาดได้',
    sellingPoints: 'ปักโลโก้ได้ · ของขวัญได้',
    stock: 30,
    optionGroups: [],
    aiReady: false,
  },
];

const DEMO_NEW_PRODUCT_FORM: FormState = {
  name: 'เสื้อ Oversize Cotton',
  price: '350',
  optionGroups: [
    { id: 'demo-og-1', label: 'สี', valuesInput: 'ดำ, ขาว, เทา, กรม' },
    { id: 'demo-og-2', label: 'ไซส์', valuesInput: 'S, M, L, XL' },
  ],
  description: 'ผ้าฝ้าย 100% นุ่ม ระบายอากาศดี ใส่สบายทุกวัน',
  sellingPoints: 'ไม่ย้ว ไม่หด · ซักเครื่องได้ · คละสีได้',
  stock: '48',
  imageUrl: 'https://picsum.photos/seed/chatz-shop-demo-form/400/400',
};

/** Extensions often seen from iOS / Android / desktop (MIME may be empty on some devices). */
const PRODUCT_IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'pjpeg',
  'webp',
  'gif',
  'bmp',
  'avif',
  'heic',
  'heif',
  'tif',
  'tiff',
  'svg',
]);

// Reject anything above 15 MB outright — that's the *upload* limit. After
// the file passes this check we still client-side compress to JPEG ≤ 1600px
// so the value stored in the DB is typically 50–250 KB regardless of the
// original size. The cap is generous enough for modern phone photos and
// strict enough that a single malicious upload can't OOM the page.
const PRODUCT_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const PRODUCT_IMAGE_MAX_MB = 15;

function productImageFileExtension(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** True for common image uploads across web / iOS / Android. */
function isAcceptedProductImageFile(file: File): boolean {
  const type = file.type.trim().toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type === '' || type === 'application/octet-stream') {
    return PRODUCT_IMAGE_EXTENSIONS.has(productImageFileExtension(file.name));
  }
  return false;
}

function formatOptionSummary(groups: ProductOptionGroup[]): string {
  return groups.map((g) => `${g.label}: ${g.values.join(' ')}`).join(' · ');
}

type ShopMode = 'shop' | 'templates';

export function ShopBrainView() {
  const [products, setProducts] = useState<Product[]>(loadProducts);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [mode, setMode] = useState<ShopMode>('shop');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [templates, setTemplates] = useState<ProductTemplate[]>(loadTemplates);
  const [search, setSearch] = useState('');

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

  const resetForm = () => {
    setForm(BLANK);
    setEditingId(null);
  };

  const loadDemoMockup = () => {
    setProducts(SEED_DEMO_PRODUCTS);
    setEditingId(null);
    setForm({
      ...DEMO_NEW_PRODUCT_FORM,
      optionGroups: DEMO_NEW_PRODUCT_FORM.optionGroups.map((g) => ({ ...g, id: newId('og') })),
    });
    setSearch('');
  };

  const handleSave = () => {
    const body = buildProductBody(form);
    if (!body) {
      setSaveHint('กรุณากรอกชื่อสินค้าและราคา');
      return;
    }
    if (!Number.isFinite(body.price) || body.price <= 0) {
      setSaveHint('ราคาต้องมากกว่า 0');
      return;
    }

    if (editingId) {
      let updated: Product | null = null;
      setProducts((list) =>
        list.map((p) => {
          if (p.id !== editingId) return p;
          updated = {
            ...body,
            id: editingId,
            imageEmoji: p.imageEmoji,
            imageUrl: form.imageUrl.trim() ? form.imageUrl.trim() : undefined,
          };
          return updated;
        }),
      );
      if (updated) void syncProductToServer(updated);
      setSaveHint('บันทึกการแก้ไขแล้ว');
    } else {
      if (products.length >= SHOP_PRODUCT_SLOT_LIMIT) {
        setSaveHint(`เพิ่มได้สูงสุด ${SHOP_PRODUCT_SLOT_LIMIT} ชิ้น`);
        return;
      }
      const fresh: Product = {
        ...body,
        id: 'p' + Date.now(),
        imageEmoji: '📦',
        imageUrl: form.imageUrl.trim() ? form.imageUrl.trim() : undefined,
      };
      setProducts((prev) => [...prev, fresh]);
      void syncProductToServer(fresh);
      setSaveHint('เพิ่มสินค้าแล้ว');
    }
    resetForm();
    window.setTimeout(() => setSaveHint(null), 2500);
  };

  const openEdit = (p: Product) => {
    setEditingId(p.id);
    setForm(productToFormState(p));
  };

  const confirmDelete = (id: string, name: string) => {
    const ok = window.confirm(`ลบสินค้า “${name}” ใช่หรือไม่?\nการลบจะทำทันทีและย้อนกลับไม่ได้`);
    if (!ok) return;
    setProducts((prev) => prev.filter((p) => p.id !== id));
    void deleteProductOnServer(id);
    if (editingId === id) resetForm();
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.sellingPoints.toLowerCase().includes(q),
    );
  }, [products, search]);

  if (mode === 'templates') {
    return (
      <TemplatesView
        templates={templates}
        onCreate={(name, emoji, optionGroups) =>
          setTemplates((prev) => [...prev, { id: newId('tpl'), name, emoji, optionGroups }])
        }
        onUpdate={updateTemplate}
        onDelete={deleteTemplate}
        onBack={() => setMode('shop')}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#f4f3f8] dark:bg-slate-950">
      {/* Top bar */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 text-lg shadow-md shadow-brand-500/25" aria-hidden>
            🛍️
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">ร้านของฉัน</h1>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {products.length} ชิ้น · เหลือ {slotsRemaining} / {SHOP_PRODUCT_SLOT_LIMIT}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMode('templates')}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-300 ease-out hover:-translate-y-[1px] hover:border-brand-300 hover:text-brand-700 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-700"
          title="จัดการแม่แบบสินค้า"
        >
          แม่แบบ
          {templates.length > 0 && (
            <span className="ml-1 rounded-full bg-brand-100 px-1.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
              {templates.length}
            </span>
          )}
        </button>
      </header>

      {saveHint && (
        <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-6 py-2 text-center text-sm font-medium text-emerald-800 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200">
          {saveHint}
        </div>
      )}

      {/* 2-pane: ซ้ายรายการ · ขวาฟอร์ม (ไม่สลับหน้า) */}
      <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
        {/* LEFT — product list, on a warm tinted background so it reads
            as the "your shop" panel, distinct from the right-side editor. */}
        <aside className="flex min-h-0 w-[min(100%,300px)] shrink-0 flex-col border-r border-slate-200/60 bg-gradient-to-b from-violet-50/70 via-white to-rose-50/40 dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-slate-950 sm:w-[300px] lg:w-[340px]">
          <div className="shrink-0 border-b border-slate-200/60 bg-white/60 px-4 py-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <span aria-hidden>📦</span> รายการสินค้า
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <I.Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นหาสินค้า"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 transition-all duration-300 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              <button
                type="button"
                onClick={resetForm}
                disabled={editingId === null && !form.name && !form.price}
                title="เริ่มเพิ่มสินค้าใหม่"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-pink-500 text-white shadow-md shadow-brand-500/30 transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-lg hover:shadow-brand-500/40 active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                aria-label="เพิ่มสินค้าใหม่"
              >
                <I.Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {editingId === null && (
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-brand-50/90 via-pink-50/80 to-brand-50/90 px-3 py-2.5 text-sm font-semibold text-brand-800 shadow-sm motion-safe:animate-[fadeUp_300ms_ease-out] dark:from-brand-950/50 dark:via-pink-950/40 dark:to-brand-950/50 dark:text-brand-200">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl border-2 border-dashed border-brand-300/70 dark:border-brand-700/60"
                />
                <span className="relative">+ เพิ่มสินค้าใหม่</span>
              </div>
            )}
            {filteredProducts.length === 0 ? (
              <div className="grid h-full min-h-[200px] place-items-center rounded-2xl border border-dashed border-slate-200 bg-white/60 p-6 text-center motion-safe:animate-[fadeUp_400ms_ease-out] dark:border-slate-700 dark:bg-slate-900/60">
                <div>
                  <I.Box className="mx-auto h-9 w-9 text-slate-300 motion-safe:animate-pulse dark:text-slate-600" />
                  <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                    {search ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้า'}
                  </p>
                  {!search && (
                    <button
                      type="button"
                      onClick={loadDemoMockup}
                      className="mt-4 rounded-full bg-gradient-to-r from-brand-500 to-pink-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-brand-500/30 transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-lg hover:shadow-brand-500/40"
                    >
                      โหลดตัวอย่าง
                    </button>
                  )}
                </div>
              </div>
            ) : (
              filteredProducts.map((p) => (
                <ShopListCard
                  key={p.id}
                  product={p}
                  isActive={editingId === p.id}
                  onClick={() => openEdit(p)}
                  onDelete={() => confirmDelete(p.id, p.name)}
                />
              ))
            )}
          </div>
        </aside>

        {/* RIGHT — add/edit form. No outer white card so each inner section
             reads as its own card (the layered look from the reference). */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AddForm
            key={editingId ?? 'new'}
            form={form}
            setForm={setForm}
            isEdit={editingId !== null}
            onSave={handleSave}
            onCancel={resetForm}
            slotsRemaining={slotsRemaining}
            onSaveAsTemplate={saveCurrentAsTemplate}
            onLoadDemo={products.length === 0 ? loadDemoMockup : undefined}
          />
        </main>
      </div>
    </div>
  );
}

function ShopListCard({
  product: p,
  isActive,
  onClick,
  onDelete,
}: {
  product: Product;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  const optLine = formatOptionSummary(p.optionGroups);
  const [thumbOk, setThumbOk] = useState(true);

  useEffect(() => {
    setThumbOk(true);
  }, [p.imageUrl, p.id]);

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={
        'group flex cursor-pointer gap-3 rounded-xl border p-3 text-left transition-all duration-300 ease-out ' +
        (isActive
          ? 'border-brand-400 bg-gradient-to-r from-brand-50/80 to-pink-50/60 shadow-md shadow-brand-500/10 ring-2 ring-brand-200/60 dark:border-brand-500 dark:from-brand-950/50 dark:to-pink-950/30 dark:ring-brand-900/60'
          : 'border-slate-200 bg-white hover:-translate-y-[1px] hover:border-brand-200 hover:bg-brand-50/30 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-brand-700 dark:hover:bg-brand-950/20')
      }
    >
      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50 text-xl ring-1 ring-slate-100 dark:bg-slate-800 dark:ring-slate-700">
        {p.imageUrl && thumbOk ? (
          <img
            src={p.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setThumbOk(false)}
          />
        ) : (
          p.imageEmoji
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{p.name}</h3>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-200">
            ฿{p.price.toLocaleString()}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {optLine ? (
            <span className="min-w-0 flex-1 truncate">{optLine}</span>
          ) : (
            <span className="text-slate-400 dark:text-slate-500">ยังไม่มีตัวเลือก</span>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          {p.aiReady ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 shadow-[0_0_0_2px_rgba(16,185,129,0.08)] dark:bg-emerald-900/40 dark:text-emerald-300">
              <span className="relative grid h-2 w-2 place-items-center" aria-hidden>
                <span className="absolute inset-0 rounded-full bg-emerald-400/60 motion-safe:animate-ping" />
                <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              AI พร้อมตอบ
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
              ขาดข้อมูล
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="ลบสินค้า"
            title="ลบ"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 opacity-0 transition-all duration-300 group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400"
          >
            <I.Trash2 className="h-3.5 w-3.5" />
          </button>
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
  onCancel,
  slotsRemaining,
  onSaveAsTemplate,
  onLoadDemo,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  isEdit: boolean;
  onSave: () => void;
  onCancel: () => void;
  slotsRemaining: number;
  onSaveAsTemplate: (name: string, emoji: string) => void;
  onLoadDemo?: () => void;
}) {
  const imageInputId = useId();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewOk, setPreviewOk] = useState(true);

  useEffect(() => {
    setPreviewOk(true);
  }, [form.imageUrl]);

  const [compressing, setCompressing] = useState(false);

  const applyImageFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isAcceptedProductImageFile(file)) {
      setImageError('รองรับเฉพาะไฟล์รูป (เช่น JPEG, PNG, WebP, GIF, HEIC, AVIF, SVG …)');
      return;
    }
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      setImageError(`ไฟล์ใหญ่เกิน ${PRODUCT_IMAGE_MAX_MB} MB`);
      return;
    }
    setImageError(null);
    setCompressing(true);
    try {
      // Resize + JPEG-compress before storing. A 6 MB phone photo typically
      // ends up ~120 KB after this — saves DB rows and page-load bandwidth.
      const out = await compressImage(file);
      setForm((f) => ({ ...f, imageUrl: out.dataUrl }));
    } catch {
      setImageError('อ่านไฟล์ไม่สำเร็จ');
    } finally {
      setCompressing(false);
    }
  };

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

  // Premium-looking input style: rounded-2xl, soft purple focus ring with
  // a gentle "halo" shadow on focus — matches the auth shell aesthetic so
  // the whole app feels like one product.
  const inputClass =
    'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 ' +
    'shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all duration-300 ease-out ' +
    'focus:border-brand-400 focus:outline-none focus:shadow-[0_0_0_4px_rgba(139,92,246,0.12)] ' +
    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-500 dark:focus:shadow-[0_0_0_4px_rgba(139,92,246,0.22)]';

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

  const priceNum = Number(form.price);
  const hasValidCore = Boolean(form.name.trim() && form.price && Number.isFinite(priceNum) && priceNum > 0);

  const hasAnyContent =
    form.name.trim() ||
    form.price ||
    form.description.trim() ||
    form.sellingPoints.trim() ||
    form.stock.trim() ||
    form.imageUrl.trim() ||
    optionsHaveContent;

  /** Hidden file input — same element shared by the image card. */
  const hiddenFileInput = (
    <input
      ref={imageInputRef}
      id={imageInputId}
      type="file"
      accept="image/*"
      className="sr-only"
      onChange={(e) => {
        void applyImageFile(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  return (
    <>
      {/* ── Header: title + Cancel / Save (Save is the gradient hero) ──── */}
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-slate-200/70 bg-white/70 px-6 py-5 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/70 md:px-8 md:py-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white md:text-[28px]">
            {isEdit ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}
          </h1>
          {onLoadDemo && !hasAnyContent && (
            <button
              type="button"
              onClick={onLoadDemo}
              className="mt-2 text-xs font-medium text-brand-600 transition-colors duration-300 underline-offset-2 hover:underline dark:text-brand-400"
            >
              โหลดตัวอย่าง
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={!isEdit && !hasAnyContent}
            className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 transition-all duration-300 ease-out hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!hasValidCore || (!isEdit && slotsRemaining <= 0)}
            className="rounded-full bg-gradient-to-r from-brand-600 to-pink-600 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-600/25 transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-xl hover:shadow-brand-600/35 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-md disabled:hover:translate-y-0"
          >
            บันทึก
          </button>
        </div>
      </header>

      {/* ── Body: 2-column (left rail + main form). Cool slate tint so the
           white cards pop, contrasting with the warm tinted product list. */}
      <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-slate-50/80 to-[#f1f1f6] dark:from-slate-950 dark:to-slate-950">
        {hiddenFileInput}
        <div className="flex flex-col gap-5 px-6 py-6 md:px-8 md:py-7 lg:flex-row lg:gap-6">

          {/* ── Left rail: media + status + stock ─────────────────── */}
          <aside className="flex w-full shrink-0 flex-col gap-5 lg:w-[260px]">

            {/* Thumbnail card */}
            <FormCard title="รูปสินค้า">
              <div
                role="button"
                tabIndex={0}
                aria-label="อัปโหลดรูปสินค้า ลากมาวางหรือคลิก"
                onClick={() => imageInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    imageInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void applyImageFile(e.dataTransfer.files?.[0]);
                }}
                className="flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 text-slate-400 transition-all duration-500 ease-out hover:border-brand-300 hover:bg-gradient-to-br hover:from-brand-50/50 hover:to-pink-50/40 hover:text-brand-600 hover:shadow-[0_0_0_4px_rgba(139,92,246,0.08)] dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-brand-500 dark:hover:from-brand-950/30 dark:hover:to-pink-950/20 dark:hover:text-brand-300"
              >
                {compressing ? (
                  <div className="flex flex-col items-center gap-2 px-3 text-center text-brand-600 dark:text-brand-400">
                    <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500 dark:border-brand-900 dark:border-t-brand-400" aria-hidden />
                    <span className="text-xs font-medium">กำลังบีบอัดรูป…</span>
                  </div>
                ) : form.imageUrl ? (
                  previewOk ? (
                    <img
                      src={form.imageUrl}
                      alt=""
                      className="h-full w-full object-contain"
                      onError={() => setPreviewOk(false)}
                    />
                  ) : (
                    <div className="flex max-w-full flex-col items-center gap-2 px-3 text-center">
                      <I.Image className="h-8 w-8 shrink-0 opacity-60" />
                      <span className="text-xs font-medium leading-snug text-slate-600 dark:text-slate-300">
                        บันทึกรูปได้ แต่เบราว์เซอร์นี้ไม่แสดงตัวอย่าง
                      </span>
                    </div>
                  )
                ) : (
                  <div className="flex flex-col items-center gap-2 px-3 text-center">
                    <I.Image className="h-9 w-9 opacity-70" />
                    <span className="text-xs font-medium">ลากมาวาง หรือคลิก</span>
                  </div>
                )}
              </div>
              {form.imageUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setImageError(null);
                    setForm((f) => ({ ...f, imageUrl: '' }));
                  }}
                  className="mt-2 block w-full text-center text-xs font-medium text-slate-500 transition hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400"
                >
                  ลบรูป
                </button>
              )}
              {imageError && (
                <p className="mt-2 text-center text-[11px] text-rose-600 dark:text-rose-400">{imageError}</p>
              )}
            </FormCard>

            <FormCard title="ราคา">
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">ราคาขาย (บาท)</label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="350"
                className={inputClass}
              />
            </FormCard>

            {/* Stock card — single field, mirrors reference's "Product Details > Categories" */}
            <FormCard title="สต๊อก">
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                จำนวนคงเหลือ <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
              </label>
              <input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                placeholder="เช่น 120"
                className={inputClass}
              />
            </FormCard>
          </aside>

          {/* ── Main form column ──────────────────────────────────── */}
          <div className="flex-1 space-y-5">

            {/* General */}
            <FormCard title="ข้อมูลทั่วไป" padding="lg">
              <div className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">ชื่อสินค้า</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="เช่น เสื้อ Oversize Cotton"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">รายละเอียด</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="เช่น ผ้านุ่ม ใส่สบาย ระบายอากาศดี"
                    rows={4}
                    className={'resize-none ' + inputClass}
                  />
                </div>
              </div>
            </FormCard>

            {/* Variants */}
            <FormCard
              title="ตัวเลือกสินค้า"
              padding="lg"
              accessory={
                <button
                  type="button"
                  onClick={() => {
                    if (!optionsHaveContent) return;
                    setSaveTplOpen(true);
                  }}
                  disabled={!optionsHaveContent}
                  title={optionsHaveContent ? 'บันทึกชุดตัวเลือกนี้เป็นแม่แบบ' : 'กรอกตัวเลือกก่อน'}
                  className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 transition-all duration-300 ease-out hover:-translate-y-[1px] hover:border-brand-300 hover:text-brand-600 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-brand-500"
                >
                  บันทึกเป็นแม่แบบ
                </button>
              }
            >
              <div className="space-y-3">
                {form.optionGroups.map((g, i) => (
                  <div key={g.id} className="rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/40 via-white to-pink-50/30 p-4 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-brand-900/60 dark:from-brand-950/30 dark:via-slate-900 dark:to-pink-950/20">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">ชุดที่ {i + 1}</span>
                      {form.optionGroups.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeOptionRow(g.id)}
                          className="text-xs font-medium text-slate-400 transition-colors duration-300 hover:text-rose-600 dark:hover:text-rose-400"
                        >
                          ลบ
                        </button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">ชื่อ</label>
                        <input
                          value={g.label}
                          onChange={(e) => updateOptionRow(g.id, { label: e.target.value })}
                          placeholder="สี"
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">ตัวเลือก</label>
                        <input
                          value={g.valuesInput}
                          onChange={(e) => updateOptionRow(g.id, { valuesInput: e.target.value })}
                          placeholder="ดำ, ขาว, เทา"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addOptionRow}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-500 transition-all duration-300 ease-out hover:border-brand-400 hover:bg-gradient-to-r hover:from-brand-50/40 hover:to-pink-50/30 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:from-brand-950/30 dark:hover:to-pink-950/20 dark:hover:text-brand-300"
              >
                <I.Plus className="h-4 w-4" />
                เพิ่มตัวเลือก
              </button>

              {saveTplOpen && (
                <div className="mt-4 rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/70 to-pink-50/40 p-4 motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-brand-800 dark:from-brand-950/40 dark:to-pink-950/20">
                  <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-200">ตั้งชื่อแม่แบบ</label>
                  <input
                    autoFocus
                    value={tplDraftName}
                    onChange={(e) => setTplDraftName(e.target.value)}
                    placeholder="เช่น เสื้อยืดของฉัน"
                    className={'mb-3 ' + inputClass}
                  />
                  <label className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-200">ไอคอน</label>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {TEMPLATE_EMOJI_OPTIONS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setTplDraftEmoji(em)}
                        className={
                          'grid h-10 w-10 place-items-center rounded-xl border text-lg transition-all duration-300 ease-out ' +
                          (tplDraftEmoji === em
                            ? 'border-brand-400 bg-gradient-to-br from-brand-50 to-pink-50 ring-2 ring-brand-200 dark:border-brand-500 dark:from-brand-950/50 dark:to-pink-950/30 dark:ring-brand-900'
                            : 'border-slate-200 bg-white hover:-translate-y-[1px] hover:border-brand-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900')
                        }
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeSaveTpl}
                      className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 transition-all duration-300 hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      onClick={submitSaveTpl}
                      disabled={!tplDraftName.trim()}
                      className="rounded-full bg-gradient-to-r from-brand-600 to-pink-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-brand-600/25 transition-all duration-300 ease-out hover:-translate-y-[1px] hover:shadow-lg hover:shadow-brand-600/35 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                    >
                      บันทึก
                    </button>
                  </div>
                </div>
              )}
            </FormCard>

            {/* Selling points */}
            <FormCard title="จุดเด่นของสินค้า" padding="lg">
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">อะไรที่ทำให้ลูกค้าอยากซื้อ?</label>
              <textarea
                value={form.sellingPoints}
                onChange={(e) => setForm((f) => ({ ...f, sellingPoints: e.target.value }))}
                placeholder="เช่น ส่งไว, ผ้านุ่ม, กันน้ำ"
                rows={3}
                className={'resize-none ' + inputClass}
              />
            </FormCard>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Reusable card shell for the product editor — matches the Circlue
 * reference style: rounded-2xl, subtle border, title + optional right-side
 * accessory at top, divider, then the content.
 */
function FormCard({
  title,
  accessory,
  padding = 'md',
  children,
}: {
  title: string;
  accessory?: React.ReactNode;
  padding?: 'md' | 'lg';
  children: React.ReactNode;
}) {
  const bodyPad = padding === 'lg' ? 'px-6 py-5' : 'px-5 py-4';
  const headPad = padding === 'lg' ? 'px-6 py-4' : 'px-5 py-3.5';
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-shadow duration-500 ease-out hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.12)] motion-safe:animate-[fadeUp_300ms_ease-out] dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <header className={'flex items-center justify-between border-b border-slate-100 ' + headPad + ' dark:border-slate-800'}>
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
        {accessory}
      </header>
      <div className={bodyPad}>{children}</div>
    </section>
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
