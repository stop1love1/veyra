// Shared seller product form — reused by the 2D Seller Dashboard AND the
// diegetic "Manage shop" glass panel. It is *stateless* re: the API: it never
// calls api.* itself, it only converts its local state into an API `ProductDto`
// and hands it to the caller's onSubmit. Both hosts own optimistic insert /
// error handling.
import React from 'react';
import { Btn, Ic } from '../ui';
import type { ProductDto, I18nField } from '../../lib/api/client';

/** The form's local (UI-shaped) value. Colors are hex strings here. */
export interface ProductFormValue {
  name: { vi: string; en: string };
  description: { vi: string; en: string };   // → maps to blurb on submit
  imageUrls: string[];                         // 1..n URL strings
  link: string;                                // external buy URL
  price: number;
  stock: number;                               // inventory count (default 100)
  colors: string[];                            // hex strings '#rrggbb' in UI
  sizes: string[];
  tags: { vi: string; en: string }[];
}

export interface ProductFormProps {
  /** Present = edit mode (pre-fills the form). */
  value?: Partial<ProductFormValue>;
  /** Owning shop id (caller supplies). */
  shopId: string;
  /** Called with the API-shaped DTO; caller does the network call. */
  onSubmit(dto: ProductDto): void | Promise<void>;
  onCancel(): void;
  /** Pass g.t. */
  t: (k: string) => string;
  lang: 'vi' | 'en';
}

const blank: ProductFormValue = {
  name: { vi: '', en: '' },
  description: { vi: '', en: '' },
  imageUrls: [''],
  link: '',
  price: 0,
  stock: 100,
  colors: [],
  sizes: ['One'],
  tags: [],
};

function hexToInt(hex: string): number {
  const h = hex.replace('#', '');
  return parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16) || 0;
}

function merge(value?: Partial<ProductFormValue>): ProductFormValue {
  if (!value) return { ...blank, imageUrls: [''] };
  return {
    name: { ...blank.name, ...(value.name || {}) },
    description: { ...blank.description, ...(value.description || {}) },
    imageUrls: value.imageUrls && value.imageUrls.length ? [...value.imageUrls] : [''],
    link: value.link ?? '',
    price: typeof value.price === 'number' ? value.price : 0,
    stock: typeof value.stock === 'number' ? value.stock : 100,
    colors: value.colors ? [...value.colors] : [],
    sizes: value.sizes && value.sizes.length ? [...value.sizes] : ['One'],
    tags: value.tags ? value.tags.map((x) => ({ ...x })) : [],
  };
}

/** Live image preview that falls back to a neutral placeholder on error. */
function ImgPreview({ url }: { url: string }) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [url]);
  const box: React.CSSProperties = {
    width: 56, height: 56, borderRadius: 12, flex: '0 0 auto',
    border: '1.5px solid var(--line)', background: 'var(--paper-2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', color: 'var(--muted)',
  };
  if (!url || broken) return <div style={box}><Ic name="hanger" size={20} /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <div style={box}>
      <img
        src={url}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setBroken(true)}
      />
    </div>
  );
}

export function ProductForm({ value, shopId, onSubmit, onCancel, t, lang }: ProductFormProps) {
  const [v, setV] = React.useState<ProductFormValue>(() => merge(value));
  const [busy, setBusy] = React.useState(false);
  const [colorDraft, setColorDraft] = React.useState('#7c5cff');
  const [sizeDraft, setSizeDraft] = React.useState('');
  const [tagDraft, setTagDraft] = React.useState<{ vi: string; en: string }>({ vi: '', en: '' });

  const set = <K extends keyof ProductFormValue>(k: K, val: ProductFormValue[K]) =>
    setV((s) => ({ ...s, [k]: val }));

  // ── validation (lightweight) ──
  const linkOk = !v.link.trim() || /^https?:\/\//i.test(v.link.trim());
  const valid = v.name.vi.trim().length > 0 && v.price >= 0 && linkOk && !busy;

  const submit = async () => {
    if (!valid) return;
    const cleanImages = v.imageUrls.map((u) => u.trim()).filter(Boolean);
    const cleanTags = v.tags
      .map((x) => ({ vi: x.vi.trim(), en: (x.en || x.vi).trim() }))
      .filter((x) => x.vi);
    const dto: ProductDto = {
      shopId,
      name: { vi: v.name.vi.trim(), en: (v.name.en || v.name.vi).trim() },
      blurb: { vi: v.description.vi.trim(), en: (v.description.en || v.description.vi).trim() },
      price: Number(v.price) || 0,
      stock: Number(v.stock) || 0,
      colors: v.colors.map(hexToInt),
      sizes: v.sizes.length ? v.sizes : ['One'],
      tags: cleanTags as I18nField[],
      images: cleanImages.map((url) => ({ url })),
      link: v.link.trim() || undefined,
    };
    setBusy(true);
    try {
      await onSubmit(dto);
    } finally {
      setBusy(false);
    }
  };

  // ── image url rows ──
  const setImage = (i: number, url: string) =>
    setV((s) => ({ ...s, imageUrls: s.imageUrls.map((x, j) => (j === i ? url : x)) }));
  const addImage = () => setV((s) => ({ ...s, imageUrls: [...s.imageUrls, ''] }));
  const removeImage = (i: number) =>
    setV((s) => {
      const next = s.imageUrls.filter((_, j) => j !== i);
      return { ...s, imageUrls: next.length ? next : [''] };
    });

  // ── colors ──
  const addColor = () =>
    setV((s) => (s.colors.includes(colorDraft) ? s : { ...s, colors: [...s.colors, colorDraft] }));
  const removeColor = (i: number) => setV((s) => ({ ...s, colors: s.colors.filter((_, j) => j !== i) }));

  // ── sizes ──
  const addSize = () => {
    const sz = sizeDraft.trim();
    if (!sz) return;
    setV((s) => (s.sizes.includes(sz) ? s : { ...s, sizes: [...s.sizes, sz] }));
    setSizeDraft('');
  };
  const removeSize = (i: number) => setV((s) => ({ ...s, sizes: s.sizes.filter((_, j) => j !== i) }));

  // ── tags ──
  const addTag = () => {
    const vi = tagDraft.vi.trim();
    if (!vi) return;
    setV((s) => ({ ...s, tags: [...s.tags, { vi, en: tagDraft.en.trim() || vi }] }));
    setTagDraft({ vi: '', en: '' });
  };
  const removeTag = (i: number) => setV((s) => ({ ...s, tags: s.tags.filter((_, j) => j !== i) }));

  const row: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center' };
  const two: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap' };
  const half: React.CSSProperties = { flex: 1, minWidth: 140 };

  return (
    <div className="v-form" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* name */}
      <div className="v-field">
        <span className="v-field-label">{t('productName')}</span>
        <div style={two}>
          <input className="v-input" style={half} placeholder="VI" aria-label={`${t('productName')} (VI)`} value={v.name.vi}
                 onChange={(e) => set('name', { ...v.name, vi: e.target.value })} />
          <input className="v-input" style={half} placeholder="EN" aria-label={`${t('productName')} (EN)`} value={v.name.en}
                 onChange={(e) => set('name', { ...v.name, en: e.target.value })} />
        </div>
      </div>

      {/* description */}
      <div className="v-field">
        <span className="v-field-label">{t('description')}</span>
        <div style={two}>
          <input className="v-input" style={half} placeholder="VI" aria-label={`${t('description')} (VI)`} value={v.description.vi}
                 onChange={(e) => set('description', { ...v.description, vi: e.target.value })} />
          <input className="v-input" style={half} placeholder="EN" aria-label={`${t('description')} (EN)`} value={v.description.en}
                 onChange={(e) => set('description', { ...v.description, en: e.target.value })} />
        </div>
      </div>

      {/* image urls + live preview */}
      <div className="v-field">
        <span className="v-field-label">{t('imageUrl')}</span>
        {v.imageUrls.map((url, i) => (
          <div key={i} style={row}>
            <ImgPreview url={url.trim()} />
            <input className="v-input" style={{ flex: 1 }} placeholder="https://…" value={url}
                   onChange={(e) => setImage(i, e.target.value)} />
            <button type="button" className="v-iconbtn" aria-label={t('cancel')}
                    onClick={() => removeImage(i)}><Ic name="close" size={16} /></button>
          </div>
        ))}
        <Btn variant="soft" size="sm" icon="plus" onClick={addImage}>{t('addImage')}</Btn>
      </div>

      {/* buy link */}
      <div className="v-field">
        <span className="v-field-label">{t('buyLink')}</span>
        <input className="v-input" placeholder="https://…" value={v.link}
               onChange={(e) => set('link', e.target.value)}
               style={!linkOk ? { borderColor: 'var(--danger, #e2554f)' } : undefined} />
      </div>

      {/* price */}
      <div className="v-field">
        <span className="v-field-label">{t('price')}</span>
        <input className="v-input" type="number" min={0} value={v.price}
               onChange={(e) => set('price', Math.max(0, Number(e.target.value) || 0))} />
      </div>

      {/* stock */}
      <div className="v-field">
        <span className="v-field-label">{t('stock')}</span>
        <input className="v-input" type="number" min={0} value={v.stock}
               onChange={(e) => set('stock', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      </div>

      {/* colors */}
      <div className="v-field">
        <span className="v-field-label">{t('color')}</span>
        <div className="v-swatches">
          {v.colors.map((c, i) => (
            <button key={i} type="button" className="v-swatch v-swatch-solid is-on"
                    style={{ background: c }} title={c} onClick={() => removeColor(i)} />
          ))}
        </div>
        <div style={row}>
          <input type="color" value={colorDraft} onChange={(e) => setColorDraft(e.target.value)}
                 style={{ width: 40, height: 40, border: 'none', background: 'none', padding: 0 }} />
          <input className="v-input" style={{ width: 120 }} value={colorDraft}
                 onChange={(e) => setColorDraft(e.target.value)} />
          <Btn variant="soft" size="sm" icon="plus" onClick={addColor}>{t('color')}</Btn>
        </div>
      </div>

      {/* sizes */}
      <div className="v-field">
        <span className="v-field-label">{t('size')}</span>
        <div className="v-chips">
          {v.sizes.map((s, i) => (
            <button key={i} type="button" className="v-chip" onClick={() => removeSize(i)}>
              {s} <Ic name="close" size={12} />
            </button>
          ))}
        </div>
        <div style={row}>
          <input className="v-input" style={{ width: 120 }} placeholder="S / M / L" value={sizeDraft}
                 onChange={(e) => setSizeDraft(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSize(); } }} />
          <Btn variant="soft" size="sm" icon="plus" onClick={addSize}>{t('size')}</Btn>
        </div>
      </div>

      {/* tags */}
      <div className="v-field">
        <span className="v-field-label">{t('tags')}</span>
        <div className="v-chips">
          {v.tags.map((tg, i) => (
            <button key={i} type="button" className="v-chip" onClick={() => removeTag(i)}>
              {tg[lang] || tg.vi} <Ic name="close" size={12} />
            </button>
          ))}
        </div>
        <div style={two}>
          <input className="v-input" style={half} placeholder="VI" aria-label={`${t('tags')} (VI)`} value={tagDraft.vi}
                 onChange={(e) => setTagDraft({ ...tagDraft, vi: e.target.value })} />
          <input className="v-input" style={half} placeholder="EN" aria-label={`${t('tags')} (EN)`} value={tagDraft.en}
                 onChange={(e) => setTagDraft({ ...tagDraft, en: e.target.value })} />
          <Btn variant="soft" size="sm" icon="plus" onClick={addTag}>{t('addTag')}</Btn>
        </div>
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <Btn variant="ghost-d" size="lg" onClick={onCancel}>{t('cancel')}</Btn>
        <Btn variant="primary" size="lg" icon="check"
             disabled={!valid}
             onClick={submit}>
          {t('save')}
        </Btn>
      </div>
    </div>
  );
}
