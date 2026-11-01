import type { Photo } from './api';

/** Hand-off of the photo set to the full-screen viewer route (M-19); signed URLs never go in route params. */
let current: Photo[] = [];
export const setViewerPhotos = (p: Photo[]) => {
  current = p;
};
export const getViewerPhotos = () => current;
