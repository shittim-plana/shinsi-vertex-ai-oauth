export interface GalleryItem {
  url: string;
  weight: number;
  tags: string[];
}

export interface Gallery {
  items: GalleryItem[];
}