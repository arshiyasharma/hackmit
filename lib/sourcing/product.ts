/** Loose shape of a SerpAPI Google Lens `visual_matches` item. */
export type SerpVisualMatch = {
  title?: string | null;
  link?: string | null;
  thumbnail?: string | null;
  source?: string | null;
  price?: string | { value?: string; extracted_value?: number } | null;
};

/** Loose shape of a SerpAPI Google Shopping `shopping_results` item. */
export type SerpShoppingResult = {
  title?: string | null;
  link?: string | null;
  product_link?: string | null;
  thumbnail?: string | null;
  source?: string | null;
  price?: string | null;
  extracted_price?: number | null;
  immersive_product_page_token?: string | null;
  serpapi_immersive_product_api?: string | null;
};

export type SerpImmersiveStore = {
  name?: string | null;
  link?: string | null;
  direct_link?: string | null;
  details_and_offers?: string[] | null;
};

export type SerpImmersiveFeature = {
  title?: string | null;
  value?: string | null;
};

export type SerpImmersiveProduct = {
  stores: SerpImmersiveStore[];
  title?: string | null;
  features: SerpImmersiveFeature[];
};
