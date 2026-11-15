import { create } from 'zustand';
interface UiState {
  libraryId: string | null;
  collectionId: string | null;
  profileId: string | null;
  editor: 'appearance' | 'library' | 'collection' | 'entry' | 'quick-entry' | 'quick' | 'move' | 'fields' | 'form' | 'card' | 'list' | 'csv' | 'profiles' | 'presets' | null;
  editingId: string | null;
  text: string;
  search: string;
  scope: 'collection' | 'library' | 'all';
  navOpen: boolean;
  constructorOpen: boolean;
  select: (libraryId: string, collectionId?: string) => void;
  openEditor: (editor: UiState['editor'], text?: string, id?: string) => void;
  setText: (text: string) => void;
  searchFor: (search: string, scope?: UiState['scope']) => void;
  toggleNav: () => void;
}
export const useUi = create<UiState>((set) => ({
  libraryId: null,
  collectionId: null,
  profileId: null,
  editor: null,
  editingId: null,
  text: '',
  search: '',
  scope: 'collection',
  navOpen: false,
  constructorOpen: false,
  select: (libraryId, collectionId) =>
    set({
      libraryId,
      collectionId: collectionId ?? null,
      profileId: null,
      scope: 'collection',
      search: '',
      ...(collectionId ? { navOpen: false } : {}),
    }),
  openEditor: (editor, text = '', id) => set({ editor, text, editingId: id ?? null }),
  setText: (text) => set({ text }),
  searchFor: (search, scope) => set({ search, ...(scope ? { scope } : {}) }),
  toggleNav: () => set((old) => ({ navOpen: !old.navOpen })),
}));
