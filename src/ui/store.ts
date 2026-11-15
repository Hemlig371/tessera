import { create } from 'zustand';
interface UiState {
  libraryId: string | null;
  collectionId: string | null;
  editor: 'library' | 'collection' | 'entry' | 'move' | 'fields' | 'form' | 'card' | 'list' | 'csv' | null;
  editingId: string | null;
  text: string;
  search: string;
  scope: 'collection' | 'library' | 'all';
  navOpen: boolean;
  select: (libraryId: string, collectionId?: string) => void;
  openEditor: (editor: UiState['editor'], text?: string, id?: string) => void;
  setText: (text: string) => void;
  searchFor: (search: string, scope?: UiState['scope']) => void;
  toggleNav: () => void;
}
export const useUi = create<UiState>((set) => ({
  libraryId: null,
  collectionId: null,
  editor: null,
  editingId: null,
  text: '',
  search: '',
  scope: 'collection',
  navOpen: false,
  select: (libraryId, collectionId) =>
    set({
      libraryId,
      collectionId: collectionId ?? null,
      scope: 'collection',
      search: '',
      ...(collectionId ? { navOpen: false } : {}),
    }),
  openEditor: (editor, text = '', id) => set({ editor, text, editingId: id ?? null }),
  setText: (text) => set({ text }),
  searchFor: (search, scope) => set({ search, ...(scope ? { scope } : {}) }),
  toggleNav: () => set((old) => ({ navOpen: !old.navOpen })),
}));
