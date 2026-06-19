// Diegetic "Manage shop" glass panel — available while a logged-in seller
// stands inside a shop they OWN. It reuses the shared <ProductForm/> and, on a
// successful create, hands the freshly-mapped product back to the host
// (StoreScreen) via onAdded so the shelf can reflect it optimistically.
//
// Offline/RBAC-safe: StoreScreen only mounts this when the seller owns the
// current shop. A failed create simply flashes a toast — guest browsing and the
// static catalog are never blocked.
import React from 'react';
import { Ic } from '../ui';
import { ProductForm } from '../forms/ProductForm';
import { api } from '../../lib/api/client';
import type { ProductDto, ApiProduct } from '../../lib/api/client';
import type { Game } from '../../lib/game/types';
import type { Product } from '../../data/types';

export interface ManagePanelProps {
  g: Game;
  shopId: string;
  /** Called with a client-mapped product after a successful create. */
  onAdded?: (p: Product) => void;
  onClose: () => void;
}

/** Map the API DTO we just sent (+ server echo) into a client Product so the
 *  shelf / product panel can render it without a full refetch. */
function toClientProduct(dto: ProductDto, created: ApiProduct | null): Product {
  const id =
    (created && (created.id || created._id)) ||
    `local-${Date.now().toString(36)}`;
  const colors = (dto.colors || []).map((c) => '#' + (c >>> 0).toString(16).padStart(6, '0'));
  return {
    id,
    shop: dto.shopId,
    price: dto.price || 0,
    rating: typeof created?.rating === 'number' ? created.rating : 0,
    sold: typeof created?.sold === 'number' ? created.sold : 0,
    name: dto.name,
    tag: dto.tags && dto.tags.length ? dto.tags[0] : undefined,
    desc: dto.blurb || { vi: '', en: '' },
    colors: colors.length ? colors : ['#cfd8d2'],
    sizes: dto.sizes && dto.sizes.length ? dto.sizes : ['One'],
    images: (dto.images || []).map((im) => im.url).filter(Boolean),
    link: dto.link,
  };
}

export function ManagePanel({ g, shopId, onAdded, onClose }: ManagePanelProps) {
  const submit = async (dto: ProductDto) => {
    let created: ApiProduct | null = null;
    try {
      created = await api.createProduct(dto);
    } catch {
      // Offline / RBAC reject — keep the world running, just flash a failure.
      g.flash(g.t('authFailed'));
      return;
    }
    const product = toClientProduct(dto, created);
    onAdded?.(product);
    g.flash(g.t('productAdded'));
    onClose();
  };

  return (
    <div className="v-overlay" onClick={onClose}>
      <div className="v-sheet v-product" onClick={(e) => e.stopPropagation()}>
        <div className="v-sheet-grab" />
        <button className="v-sheet-close v-iconbtn" onClick={onClose} aria-label={g.t('aClose')}>
          <Ic name="close" size={18} />
        </button>
        <div className="v-product-scroll">
          <div className="v-product-info">
            <h2 className="v-product-name" style={{ marginBottom: 14 }}>{g.t('manageShop')}</h2>
            <ProductForm
              shopId={shopId}
              onSubmit={submit}
              onCancel={onClose}
              t={g.t}
              lang={g.lang}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
